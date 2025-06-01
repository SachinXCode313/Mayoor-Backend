import db from "../config/db.js";
import { recalculateROScore } from "./reportOutcomesMapping.js";

const recalculateLOScore = async (connection, lo_id, studentIds) => {
    try {
        let warnings = [];
        const priorityValues = { h: 0.5, m: 0.3, l: 0.2 };

        const [mappings] = await connection.query(
            "SELECT ac, priority FROM lo_ac_mapping WHERE lo = ?",
            [lo_id]
        );

        if (!mappings || mappings.length === 0) {
            await connection.query("DELETE FROM lo_scores WHERE lo = ?", [lo_id]);
            warnings.push(`No LO-AC mappings found for LO ID: ${lo_id}. LO scores removed.`);
            return warnings;
        }

        const totalPriorityWeight = mappings.reduce((sum, { priority }) => {
            return sum + (priorityValues[priority] || 0);
        }, 0);

        if (totalPriorityWeight === 0) {
            warnings.push(`Total priority weight is 0 for LO ID: ${lo_id}. Skipping recalculation.`);
            return warnings;
        }

        const weights = mappings.map(({ ac, priority }) => ({
            ac,
            weight: (priorityValues[priority] || 0) / totalPriorityWeight
        }));

        for (const { ac, weight } of weights) {
            await connection.query(
                "UPDATE lo_ac_mapping SET weight = ? WHERE lo = ? AND ac = ?",
                [weight, lo_id, ac]
            );
        }

        if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
            warnings.push(`No student IDs provided for LO ID: ${lo_id}. Cannot recalculate scores.`);
            return warnings;
        }

        let hasScores = false;
        for (const { ac } of mappings) {
            const [scoreCheck] = await connection.query(
                "SELECT student FROM ac_scores WHERE ac = ? LIMIT 1",
                [ac]
            );
            if (scoreCheck.length > 0) {
                hasScores = true;
                break;
            }
        }

        if (!hasScores) {
            warnings.push(`LO ${lo_id} has mappings, but no AC scores found. Please add AC scores.`);
            return warnings;
        }

        for (const studentObj of studentIds) {
            if (!studentObj || !studentObj.student_id) {
                warnings.push(`Invalid student object: ${JSON.stringify(studentObj)}`);
                continue;
            }

            const student_id = studentObj.student_id;
            let weightedSum = 0;

            for (const { ac, weight } of weights) {
                const [acScoreRows] = await connection.query(
                    "SELECT value FROM ac_scores WHERE ac = ? AND student = ?",
                    [ac, student_id]
                );

                if (acScoreRows.length > 0) {
                    const acScore = acScoreRows[0].value || 0;
                    weightedSum += acScore * weight;
                } else {
                    warnings.push(`No AC score found for student ${student_id} and AC ${ac}`);
                }
            }

            await connection.query(
                "INSERT INTO lo_scores (lo, student, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = ?",
                [lo_id, student_id, weightedSum, weightedSum]
            );
        }

        return warnings;
    } catch (error) {
        console.error("Error recalculating LO score:", error);
        return [`Error occurred while recalculating LO score for LO ID: ${lo_id}`];
    }
};

// Get Learning Outcomes Mapping
const getLearningOutcomesMapping = async (req, res) => {
    try {
        const lo_id = req.headers["lo_id"];
        if (!lo_id) {
            return res.status(400).json({ error: "lo_id is required in the headers" });
        }
        const [rows] = await db.query(
            `SELECT ac, priority FROM lo_ac_mapping WHERE lo = ?`, 
            [lo_id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: "No ACs found for the given lo_id." });
        }
        res.status(200).json({
            message: "ACs and their priorities fetched successfully",
            data: rows
        });
    } catch (error) {
        console.error("Error fetching ACs mapping:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
};
const updateLearningOutcomeMapping = async (req, res) => {
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        const { lo_id } = req.query;
        const { year, quarter, classname, section, subject } = req.headers;
        const { data } = req.body;

        if (!lo_id || !year || !quarter || !classname || !section || !subject) {
            return res.status(400).json({ error: "Missing required headers or lo_id." });
        }

        if (!data || !Array.isArray(data) || data.length === 0) {
            return res.status(400).json({ error: "Invalid data format. Expected an array of objects with ac_id and priority." });
        }

        const validPriorities = { h: 0.5, m: 0.3, l: 0.2 };
        for (const item of data) {
            if (!validPriorities[item.priority]) {
                return res.status(400).json({ error: `Invalid priority '${item.priority}'. Must be 'h', 'm', or 'l'.` });
            }
        }

        const [roRows] = await connection.query(
            "SELECT ro FROM ro_lo_mapping WHERE lo = ?",
            [lo_id]
        );
        const roIds = roRows.map(row => row.ro);

        const [existingMappings] = await connection.query(
            "SELECT ac, priority FROM lo_ac_mapping WHERE lo = ?",
            [lo_id]
        );
        const currentPriorityMap = new Map(existingMappings.map(row => [row.ac, row.priority]));

        const [studentRows] = await connection.query(
            "SELECT student FROM students_records WHERE year = ? AND class = ? AND section = ?",
            [year, classname, section]
        );
        if (studentRows.length === 0) {
            return res.status(404).json({ error: "No students found in students_records for the given filters." });
        }
        const studentIds = studentRows.map(row => ({ student_id: row.student }));

        const inputAcIds = data.map(item => item.ac_id);
        const [validAcRows] = await connection.query(
            "SELECT id FROM assessment_criterias WHERE id IN (?)",
            [inputAcIds]
        );
        const validAcIds = validAcRows.map(row => row.id);
        if (validAcIds.length !== inputAcIds.length) {
            return res.status(404).json({ error: "Some provided ac_ids are invalid or do not exist." });
        }

        let priorityChanged = false;

        // Find old mappings to remap
        const [oldMappings] = await connection.query(
            "SELECT lo, ac FROM lo_ac_mapping WHERE ac IN (?) AND lo != ?",
            [inputAcIds, lo_id]
        );

        const loToRemovedAcs = {};
        for (const row of oldMappings) {
            if (!loToRemovedAcs[row.lo]) loToRemovedAcs[row.lo] = [];
            loToRemovedAcs[row.lo].push({ ac_id: row.ac });
        }

        for (const oldLoId in loToRemovedAcs) {
            const removedAcs = loToRemovedAcs[oldLoId].map(item => item.ac_id);
            await connection.query(
                "DELETE FROM lo_ac_mapping WHERE lo = ? AND ac IN (?)",
                [oldLoId, removedAcs]
            );
        }

        // Insert or update new mappings
        for (const item of data) {
            const { ac_id, priority } = item;
            const existingPriority = currentPriorityMap.get(ac_id);
            if (existingPriority !== undefined) {
                if (existingPriority !== priority) {
                    priorityChanged = true;
                    await connection.query(
                        "UPDATE lo_ac_mapping SET priority = ? WHERE lo = ? AND ac = ?",
                        [priority, lo_id, ac_id]
                    );
                }
            } else {
                priorityChanged = true;
                await connection.query(
                    "INSERT INTO lo_ac_mapping (lo, ac, priority) VALUES (?, ?, ?)",
                    [lo_id, ac_id, priority]
                );
            }
        }

        let allWarnings = [];

        // Recalculate for current LO
        const loWarnings = await recalculateLOScore(connection, lo_id, studentIds);
        allWarnings.push(...loWarnings);

        // Process old LOs affected by AC reassignment
        for (const oldLoId in loToRemovedAcs) {
            const [remainingMappings] = await connection.query(
                "SELECT ac FROM lo_ac_mapping WHERE lo = ?",
                [oldLoId]
            );

            if (remainingMappings.length === 0) {
                // Delete LO scores
                await connection.query(
                    "DELETE FROM lo_scores WHERE lo = ? AND student IN (?)",
                    [oldLoId, studentIds.map(s => s.student_id)]
                );
                allWarnings.push(`LO ${oldLoId} has no remaining ACs. LO scores deleted.`);

                // Delete RO-LO mapping
                await connection.query(
                    "DELETE FROM ro_lo_mapping WHERE lo = ?",
                    [oldLoId]
                );
                allWarnings.push(`RO-LO mapping for LO ${oldLoId} deleted as it has no ACs.`);
            } else {
                const oldLoWarnings = await recalculateLOScore(connection, oldLoId, studentIds);
                allWarnings.push(...oldLoWarnings);
            }

            const [oldRoRows] = await connection.query(
                "SELECT ro FROM ro_lo_mapping WHERE lo = ?",
                [oldLoId]
            );

            for (const row of oldRoRows) {
                const oldRoWarnings = await recalculateROScore(connection, row.ro, classname, section, year, quarter);
                allWarnings.push(...oldRoWarnings);
            }
        }

        // Recalculate for current RO(s)
        for (const ro_id of roIds) {
            const roWarnings = await recalculateROScore(connection, ro_id, classname, section, year, quarter);
            allWarnings.push(...roWarnings);
        }

        await connection.commit();

        res.status(200).json({
            message: `LO mapping updated successfully. ${priorityChanged ? "Priorities updated." : "No changes in priorities, but recalculation done."}`,
            warnings: allWarnings.length ? allWarnings : "No warnings.",
            recalculated: true
        });

    } catch (error) {
        await connection.rollback();
        console.error("Error updating LO mapping:", error.message);
        res.status(500).json({ error: "Internal Server Error", details: error.message });
    } finally {
        connection.release();
    }
};




export { getLearningOutcomesMapping, updateLearningOutcomeMapping, recalculateLOScore };