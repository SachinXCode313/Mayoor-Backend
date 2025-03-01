import db from "../config/db.js";

const priorityValues = {
    h: 0.5,
    m: 0.3,
    l: 0.2,
};
//Unsensible Code
const getLearningOutcomesMapping = async (req, res) => {
    try {
        const lo_id = req.headers["lo_id"]; // lo_id provided in the header
        // Check if lo_id is provided in headers
        if (!lo_id) {
            return res.status(400).json({ error: "lo_id is required in the headers" });
        }
        // Query to fetch ac_id and priority mapped to the given lo_id
        const [rows] = await db.query(
            `SELECT ac, priority
            FROM lo_ac_mapping
            WHERE lo = ?`,
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

        const validPriorities = ["h", "m", "l"];
        for (const item of data) {
            if (!validPriorities.includes(item.priority)) {
                return res.status(400).json({ error: `Invalid priority '${item.priority}'. Must be 'h', 'm', or 'l'.` });
            }
        }

        // Check if LO exists
        const [loRows] = await db.query("SELECT id FROM learning_outcomes WHERE id = ?", [lo_id]);
        if (loRows.length === 0) {
            return res.status(404).json({ error: "Invalid lo_id provided." });
        }

        // Fetch valid students
        const [studentRows] = await db.query(
            "SELECT student FROM students_records WHERE year = ? AND class = ? AND section = ?",
            [year, classname, section]
        );
        console.log(studentRows)
        if (studentRows.length === 0) {
            return res.status(404).json({ error: "No students found in students_records for the given filters." });
        }
        const studentIds = studentRows.map(row => row.student);
        console.log(studentIds)
        // Validate ACs
        const inputAcIds = data.map(item => item.ac_id);
        console.log(inputAcIds)
        const [validAcRows] = await db.query(
            "SELECT id AS ac FROM assessment_criterias WHERE id IN (?)",
            [inputAcIds]
        );
        console.log(validAcRows)
        const validAcIds = validAcRows.map(row => row.id);
        if (validAcIds.length !== inputAcIds.length) {
            return res.status(404).json({ error: "Some provided ac_ids are invalid or do not match filters." });
        }

        // Calculate new weights
        let totalDenominator = 0;
        data.forEach(item => totalDenominator += priorityValues[item.priority]);
        if (totalDenominator === 0) {
            return res.status(400).json({ error: "Invalid weight calculation, check input values." });
        }

        // Update mapping & recalculate weights
        const loAcMappingPromises = data.map(async (item) => {
            const { ac_id, priority } = item;
            let weight = priorityValues[priority] / totalDenominator;
            await db.query(
                "UPDATE lo_ac_mapping SET weight = ?, priority = ? WHERE lo = ? AND ac = ?",
                [weight, priority, lo_id, ac_id]
            );
            return { ac_id, weight };
        });

        const mappings = await Promise.all(loAcMappingPromises);

        // Recalculate LO Scores for each student
        for (const student_id of studentIds) {
            let loScore = 0;
            for (const mapping of mappings) {
                const { ac_id, weight } = mapping;
                const [acScoreRows] = await db.query(
                    "SELECT value FROM ac_scores WHERE ac = ? AND student = ?",
                    [ac_id, student_id]
                );
                if (acScoreRows.length > 0) {
                    loScore += weight * acScoreRows[0].value;
                }
            }

            // Check if an entry already exists for this lo_id and student
            const [existingScore] = await db.query(
                "SELECT value FROM lo_scores WHERE lo = ? AND student = ?",
                [lo_id, student_id]
            );

            if (existingScore.length > 0) {
                // Update existing record
                await db.query(
                    "UPDATE lo_scores SET value = ? WHERE lo = ? AND student = ?",
                    [loScore, lo_id, student_id]
                );
            } else {
                // Insert new record if not exists
                await db.query(
                    "INSERT INTO lo_scores (lo, student, value) VALUES (?, ?, ?)",
                    [lo_id, student_id, loScore]
                );
            }
        }

        res.status(200).json({
            message: "LO mapping updated and scores recalculated successfully.",
            students_processed: studentIds.length
        });
    } catch (error) {
        console.error("Error updating LO mapping:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
};
export {getLearningOutcomesMapping, updateLearningOutcomeMapping };