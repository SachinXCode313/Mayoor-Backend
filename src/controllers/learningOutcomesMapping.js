import db from "../config/db.js";

const priorityValues = { h: 0.5, m: 0.3, l: 0.2 };

// Function to Recalculate LO Scores
const recalculateLOScore = async (connection, lo_id, studentIds) => {
    try {
        // Fetch LO-AC mappings
        const [mappings] = await connection.query(
            "SELECT ac, priority FROM lo_ac_mapping WHERE lo = ?",
            [lo_id]
        );
        if (mappings.length === 0) return;

        // Count priority occurrences
        let hCount = 0, mCount = 0, lCount = 0;
        mappings.forEach(({ priority }) => {
            if (priority === 'h') hCount++;
            else if (priority === 'm') mCount++;
            else if (priority === 'l') lCount++;
        });

        const denominator = (hCount * priorityValues.h) + (mCount * priorityValues.m) + (lCount * priorityValues.l);
        if (denominator === 0) return;

        // Recalculate LO Scores for each student
        for (const student_id of studentIds) {
            let totalScore = 0;
            for (const { ac } of mappings) {
                const [acScoreRows] = await connection.query(
                    "SELECT value FROM ac_scores WHERE ac = ? AND student = ?",
                    [ac, student_id]
                );
                if (acScoreRows.length > 0) {
                    totalScore += acScoreRows[0].value || 0;
                }
            }
            const loScore = totalScore / denominator;

            // Insert or update LO Score
            await connection.query(
                "INSERT INTO lo_scores (lo, student, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = ?",
                [lo_id, student_id, loScore, loScore]
            );
        }

        // **Trigger RO Score Recalculation**
        const [roMappings] = await connection.query(
            "SELECT DISTINCT ro FROM ro_lo_mapping WHERE lo = ?",
            [lo_id]
        );
        for (const { ro } of roMappings) {
            await recalculateROScore(connection, ro);
        }
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

        // Validate Priorities
        const validPriorities = { h: 3, m: 2, l: 1 };
        for (const item of data) {
            if (!validPriorities[item.priority]) {
                return res.status(400).json({ error: `Invalid priority '${item.priority}'. Must be 'h', 'm', or 'l'.` });
            }
        }

        // **Fetch existing priorities**
        const [existingMappings] = await connection.query(
            "SELECT ac, priority FROM lo_ac_mapping WHERE lo = ?",
            [lo_id]
        );
        const currentPriorityMap = new Map(existingMappings.map(row => [row.ac, row.priority]));

        // **Fetch valid students**
        const [studentRows] = await connection.query(
            "SELECT student FROM students_records WHERE year = ? AND class = ? AND section = ?",
            [year, classname, section]
        );
        if (studentRows.length === 0) {
            return res.status(404).json({ error: "No students found in students_records for the given filters." });
        }
        const studentIds = studentRows.map(row => row.student);

        // **Validate ACs**
        const inputAcIds = data.map(item => item.ac_id);
        const [validAcRows] = await connection.query(
            "SELECT id FROM assessment_criterias WHERE id IN (?)",
            [inputAcIds]
        );
        const validAcIds = validAcRows.map(row => row.id);
        if (validAcIds.length !== inputAcIds.length) {
            return res.status(404).json({ error: "Some provided ac_ids are invalid or do not exist." });
        }

        // **Calculate total denominator for weight normalization**
        let totalDenominator = data.reduce((sum, item) => sum + validPriorities[item.priority], 0);
        if (totalDenominator === 0) {
            return res.status(400).json({ error: "Invalid weight calculation, check input values." });
        }

        let priorityChanged = false;
        const loAcMappingPromises = data.map(async (item) => {
            const { ac_id, priority } = item;
            let weight = validPriorities[priority] / totalDenominator;

            // **Check if priority has changed**
            if (currentPriorityMap.get(ac_id) !== priority) {
                priorityChanged = true;
            }

            await connection.query(
                "UPDATE lo_ac_mapping SET weight = ?, priority = ? WHERE lo = ? AND ac = ?",
                [weight, priority, lo_id, ac_id]
            );
            return { ac_id, weight };
        });

        await Promise.all(loAcMappingPromises);

        // **Recalculate LO Scores if priorities changed**
        if (priorityChanged) {
            await recalculateLOScore(connection, lo_id, studentIds);
        }

        await connection.commit();
        res.status(200).json({
            message: `LO mapping updated successfully. 
                      ${priorityChanged ? 'Priorities changed and scores recalculated.' : 'No priority changes detected.'}`
        });

    } catch (error) {
        await connection.rollback();
        console.error("Error updating LO mapping:", error.message);
        res.status(500).json({ error: "Internal Server Error", details: error.message });
    } finally {
        connection.release();
    }
};

export { getLearningOutcomesMapping, updateLearningOutcomeMapping };