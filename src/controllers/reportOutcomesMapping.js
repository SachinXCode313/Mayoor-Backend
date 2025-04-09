import db from "../config/db.js";

const recalculateROScore = async (connection, ro_id) => {
    try {
        const warnings = []; // Store warnings

        // Priority values
        const priorityValues = { h: 0.5, m: 0.3, l: 0.2 };

        // Fetch all students linked to the given RO
        const [studentRows] = await connection.query(
            "SELECT DISTINCT student FROM lo_scores WHERE lo IN (SELECT lo FROM ro_lo_mapping WHERE ro = ?)",
            [ro_id]
        );
        if (studentRows.length === 0) {
            warnings.push(`No students found for RO ${ro_id}.`);
            return warnings;
        }

        const studentIds = studentRows.map(row => row.student);

        // Fetch all LO mappings for this RO
        const [mappings] = await connection.query(
            "SELECT lo, priority FROM ro_lo_mapping WHERE ro = ?",
            [ro_id]
        );
        if (mappings.length === 0) {
            warnings.push(`No LO mappings found for RO ${ro_id}.`);
            return warnings;
        }

        // Calculate weight for each priority
        let hCount = 0, mCount = 0, lCount = 0;
        mappings.forEach(({ priority }) => {
            if (priority === 'h') hCount++;
            else if (priority === 'm') mCount++;
            else if (priority === 'l') lCount++;
        });

        const totalWeight = (hCount * priorityValues.h) + (mCount * priorityValues.m) + (lCount * priorityValues.l);
        if (totalWeight === 0) {
            warnings.push(`Invalid weight calculation for RO ${ro_id} (total weight is zero).`);
            return warnings;
        }

        const hWeight = priorityValues.h / totalWeight;
        const mWeight = priorityValues.m / totalWeight;
        const lWeight = priorityValues.l / totalWeight;

        // Update the weight in the ro_lo_mapping table
        for (const { lo, priority } of mappings) {
            let weight = priority === 'h' ? hWeight :
                         priority === 'm' ? mWeight :
                         priority === 'l' ? lWeight : 0;

            await connection.query(
                "UPDATE ro_lo_mapping SET weight = ? WHERE ro = ? AND lo = ?",
                [weight, ro_id, lo]
            );
        }

        // Recalculate RO Scores for each student
        for (const student_id of studentIds) {
            let weightedSum = 0;
            let validLOs = 0;

            for (const { lo, priority } of mappings) {
                let weight = priority === 'h' ? hWeight :
                             priority === 'm' ? mWeight :
                             priority === 'l' ? lWeight : 0;

                // Fetch the LO score for the student
                const [loScoreRows] = await connection.query(
                    "SELECT value FROM lo_scores WHERE lo = ? AND student = ?",
                    [lo, student_id]
                );

                if (loScoreRows.length > 0) {
                    const loScore = loScoreRows[0].value || 0;
                    weightedSum += loScore * weight;
                    validLOs++;
                } else {
                    warnings.push(`No LO score found for student ${student_id} and LO ${lo}.`);
                }
            }

            if (validLOs === 0) {
                warnings.push(`Skipping RO score insert for student ${student_id} due to no valid LO scores.`);
                continue;
            }

            // Calculate RO score
            const roScore = weightedSum ;

            // Insert or update RO Score
            await connection.query(
                "INSERT INTO ro_scores (ro, student, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = ?",
                [ro_id, student_id, roScore, roScore]
            );
        }

        return warnings;
    } catch (error) {
        console.error("Error recalculating RO score:", error);
        return [`Error recalculating RO score: ${error.message}`];
    }
};


// **Main Function: Update Report Outcome Mapping**
const updateReportOutcomeMapping = async (req, res) => {
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        console.log("Starting updateReportOutcomeMapping...");
        const warnings = [];

        const { ro_id } = req.query;
        const { data } = req.body;

        if (!ro_id) {
            return res.status(400).json({ error: "Missing required parameter: ro_id." });
        }

        if (!data || !Array.isArray(data) || data.length === 0) {
            return res.status(400).json({ error: "Invalid data format. Expected an array of objects with lo_id and priority." });
        }

        const priorityValues = { h: 0.5, m: 0.3, l: 0.2 };
        const validPriorities = Object.keys(priorityValues);

        for (const item of data) {
            if (!validPriorities.includes(item.priority)) {
                return res.status(400).json({
                    error: `Invalid priority '${item.priority}'. Must be one of ${validPriorities.join(", ")}.` });
            }
        }

        const [roRows] = await connection.query("SELECT id FROM report_outcomes WHERE id = ?", [ro_id]);
        if (roRows.length === 0) {
            return res.status(404).json({ error: "Invalid ro_id provided." });
        }

        const [existingMappings] = await connection.query(
            "SELECT lo, priority FROM ro_lo_mapping WHERE ro = ?",
            [ro_id]
        );

        const existingMappingMap = new Map(existingMappings.map(row => [row.lo, row.priority]));

        let mappingChanged = false;

        for (const { lo_id, priority } of data) {
            const weight = priorityValues[priority];

            const [loExists] = await connection.query(
                "SELECT id FROM learning_outcomes WHERE id = ?", [lo_id]
            );
            if (loExists.length === 0) {
                warnings.push(`LO ${lo_id} does not exist in learning_outcomes.`);
                continue;
            }

            if (!existingMappingMap.has(lo_id)) {
                await connection.query(
                    "INSERT INTO ro_lo_mapping (ro, lo, priority, weight) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE priority = VALUES(priority), weight = VALUES(weight);",
                    [ro_id, lo_id, priority, weight]
                );
                mappingChanged = true;
            } else if (existingMappingMap.get(lo_id) !== priority) {
                await connection.query(
                    "UPDATE ro_lo_mapping SET priority = ?, weight = ? WHERE ro = ? AND lo = ?",
                    [priority, weight, ro_id, lo_id]
                );
                mappingChanged = true;
            }
        }

        let recalculationWarnings = [];

        if (mappingChanged) {
            const [studentRows] = await connection.query(`
                SELECT DISTINCT sr.student AS student_id
                FROM students_records sr
                JOIN lo_scores ls ON sr.student = ls.student
                JOIN ro_lo_mapping rlm ON ls.lo = rlm.lo
                WHERE rlm.ro = ?;
            `, [ro_id]);

            if (studentRows.length > 0) {
                recalculationWarnings = await recalculateROScore(connection, ro_id, studentRows);
                console.log("RO scores recalculated successfully.");
            } else {
                warnings.push("No students found to recalculate RO scores.");
            }
        }

        await connection.commit();
        res.status(200).json({
            message: `RO mappings updated successfully. ${mappingChanged ? "Scores recalculated." : "No changes detected."}`,
            warnings: [...warnings, ...recalculationWarnings]
        });

    } catch (error) {
        await connection.rollback();
        console.error("Error updating RO mappings:", error.message);
        res.status(500).json({ error: "Internal Server Error", details: error.message });
    } finally {
        connection.release();
    }
};

const getReportOutcomesMapping = async (req, res) => {
    try {
        const ro_id = req.headers["ro_id"];
        if (!ro_id) return res.status(400).json({ error: "ro_id is required in the headers" });

        const [rows] = await db.query(
            `SELECT lo, priority FROM ro_lo_mapping WHERE ro = ?`, [ro_id]
        );

        if (rows.length === 0) return res.status(404).json({ error: "No LOs found for the given ro_id." });

        res.status(200).json({
            message: "LOs and their priorities for the given ro_id fetched successfully",
            data: rows
        });
    } catch (error) {
        console.error("Error fetching LOs mapping for RO:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

export { updateReportOutcomeMapping, getReportOutcomesMapping, recalculateROScore};