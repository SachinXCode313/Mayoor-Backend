import db from "../config/db.js";
import { recalculateROScore } from "./reportOutcomesMapping.js";
const recalculateLOScore = async (connection, lo_id, studentIds) => {
    try {
        let warnings = [];
        const priorityValues = { h: 0.5, m: 0.3, l: 0.2 };

        // Fetch LO-AC mappings
        const [mappings] = await connection.query(
            "SELECT ac, priority FROM lo_ac_mapping WHERE lo = ?",
            [lo_id]
        );
        
        if (mappings.length === 0) {
            warnings.push(`No LO-AC mappings found for LO ID: ${lo_id}`);
            return warnings
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
            warnings.push(`Total weight is 0 for LO ID: ${lo_id}, skipping recalculation.`);
            return warnings// Avoid division by zero
        }

        const hWeight = (priorityValues.h ) / totalWeight;
        const mWeight = (priorityValues.m ) / totalWeight;
        const lWeight = (priorityValues.l ) / totalWeight ;
        // Update weights in the lo_ac_mapping table
        for (const { ac, priority } of mappings) {
            let weight = 0;
            if (priority === 'h') weight = hWeight;
            else if (priority === 'm') weight = mWeight;
            else if (priority === 'l') weight = lWeight;

            // Update the weight column for each mapping
            await connection.query(
                "UPDATE lo_ac_mapping SET weight = ? WHERE lo = ? AND ac = ?",
                [weight, lo_id, ac]
            );
        }
        if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
            warnings.push(`No student IDs provided for LO ID: ${lo_id}. Cannot recalculate scores.`);
            return warnings
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
            warnings.push(`Priority set for LO ${lo_id}, but no AC scores found. Please add AC scores.`);
            return warnings
        }
        for (const studentObj of studentIds) {
            if (!studentObj || !studentObj.student_id) {
                console.error(`Invalid student object:`, studentObj);
                continue; // Skip this iteration if student_id is missing
            }
            
            const student_id = studentObj.student_id;
            let weightedSum = 0;

            console.log(`Processing student ID: ${student_id}`);

            for (const { ac, priority } of mappings) {
                let weight = 0;
                if (priority === 'h') weight = hWeight;
                else if (priority === 'm') weight = mWeight;
                else if (priority === 'l') weight = lWeight;

                // Fetch the AC score for the student
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

            // If weightedSum is still 0, skip inserting a null value
            if (weightedSum === 0) {
                warnings.push(`Skipping LO score insert for student ${student_id} due to no valid AC scores.`);
                continue;
            }

            // Calculate LO score
            const loScore = weightedSum / mappings.length;

            // Insert or update LO Score
            await connection.query(
                "INSERT INTO lo_scores (lo, student, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = ?",
                [lo_id, student_id, loScore, loScore]
            );
        }
        return warnings
    } catch (error) {
        console.error("Error recalculating LO score:", error);
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

// Update Learning Outcome Mapping
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
        const validPriorities = { h: 3, m: 2, l: 1 };
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
        // Fetch existing priorities
        const [existingMappings] = await connection.query(
            "SELECT ac, priority FROM lo_ac_mapping WHERE lo = ?",
            [lo_id]
        );
        const currentPriorityMap = new Map(existingMappings.map(row => [row.ac, row.priority]));

        // Fetch valid students
        const [studentRows] = await connection.query(
            "SELECT student FROM students_records WHERE year = ? AND class = ? AND section = ?",
            [year, classname, section]
        );
        if (studentRows.length === 0) {
            return res.status(404).json({ error: "No students found in students_records for the given filters." });
        }
        const studentIds = studentRows.map(row => row.student);

        // Validate ACs
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
        const loAcMappingPromises = data.map(async (item) => {
            const { ac_id, priority } = item;

            // Check if priority has changed
            if (currentPriorityMap.get(ac_id) !== priority) {
                priorityChanged = true;
            }

            // Update priority in database
            await connection.query(
                "UPDATE lo_ac_mapping SET priority = ? WHERE lo = ? AND ac = ?",
                [priority, lo_id, ac_id]
            );
        });

        await Promise.all(loAcMappingPromises);

        // **Collect warnings**
        let allWarnings = [];

        // **Recalculate Scores if priorities changed**
        let recalculationMessage = "No priority changes detected.";
        if (priorityChanged) {
            const loWarnings = await recalculateLOScore(connection, lo_id, studentIds, data);
            allWarnings.push(...loWarnings);

            for (const ro_id of roIds) {
                const roWarnings = await recalculateROScore(connection, ro_id, studentIds, data);
                allWarnings.push(...roWarnings);
            }

            recalculationMessage = "Priorities changed and scores recalculated.";
        }
        await connection.commit();
        res.status(200).json({
            message: `LO mapping updated successfully. ${recalculationMessage}`,
            warnings: allWarnings.length ? allWarnings : "No warnings."
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