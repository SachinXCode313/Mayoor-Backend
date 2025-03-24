import db from "../config/db.js";
import { recalculateLOScore } from "./learningOutcomesMapping.js";
import { recalculateROScore } from "./reportOutcomesMapping.js";

// Get All Assessment Criteria Scores for All Students in a Section
const getAssessmentCriteriaScores = async (req, res) => {
    const { ac_id, year, quarter, classname } = req.headers;
    if (!ac_id || !year || !quarter || !classname ) {
        return res.status(400).json({ message: "Missing required headers: ac_id, year, quarter, classname, section" });
    }
    try {
        const query = `
            SELECT sr.student, s.name AS student_name, acs.value
            FROM ac_scores acs
            LEFT JOIN students_records sr ON acs.student = sr.student
            LEFT JOIN students s ON sr.student = s.id
            LEFT JOIN assessment_criterias ac ON acs.ac = ac.id
            WHERE acs.ac = ?
            AND ac.year = ?
            AND ac.quarter = ?
            AND ac.class = ?
            ORDER BY sr.student;
        `;
        const [results] = await db.query(query, [ac_id, year, quarter, classname]);
        if (results.length === 0) {
            return res.status(404).json({ message: "No assessment scores found for the given filters." });
        }
        const students = results.map(({ student, student_name, value }) => ({
            student_id: student,
            student_name,
            value
        }));
        res.status(200).json(students);
    } catch (err) {
        console.error("Error fetching assessment scores:", err);
        res.status(500).json({ message: "Server error while fetching assessment scores", error: err.message });
    }
};

// Set Assessment Criteria Scores (POST)
const setAssessmentCriteriaScore = async (req, res) => {
    try {
        const { year, quarter, classname, section } = req.headers;
        const { ac_id, scores } = req.body;

        const result = await recalculateAcScores(ac_id, year, quarter, classname, section, scores);
        if (result.success) {
            return res.status(201).json({ message: result.message });
        } else {
            return res.status(400).json({ error: result.error });
        }
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error" });
    }
};

// Update Assessment Criteria Scores (PUT)
const updateAssessmentCriteriaScore = async (req, res) => {
    try {
        const { year, quarter, classname, section } = req.headers;
        const { ac_id, scores } = req.body;

        const result = await recalculateAcScores(ac_id, year, quarter, classname, section, scores);
        if (result.success) {
            return res.status(200).json({ message: result.message });
        } else {
            return res.status(400).json({ error: result.error });
        }
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error" });
    }
};
const recalculateAcScores = async (ac_id, year, quarter, classname, section, scores) => {
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        
        if (!ac_id || !scores || !Array.isArray(scores) || scores.length === 0) {
            throw new Error("ac_id and valid scores array are required.");
        }

        if (!year || !quarter || !classname || !section) {
            throw new Error("year, quarter, classname, and section are required.");
        }
        // Fetch max_marks for the assessment criteria
        const [criteriaRows] = await connection.query(
            "SELECT max_marks FROM assessment_criterias WHERE id = ? AND quarter = ? AND year = ? AND class = ?",
            [ac_id, quarter, year, classname] // Check if 'class' should be 'classname'
        );
        
        const max_marks = criteriaRows[0]?.max_marks;
        if (!max_marks) {
            throw new Error("Max marks not set for this assessment criteria.");
        }
        
        let validScores = scores
            .filter(({ student_id, obtained_marks }) => student_id && obtained_marks !== null && obtained_marks <= max_marks)
            .map(({ student_id, obtained_marks }) => [student_id, ac_id, obtained_marks / max_marks]);
        
        if (validScores.length === 0) {
            throw new Error("No valid scores to process.");
        }
        

        // Insert or update AC scores
        const valuesPlaceholder = validScores.map(() => "(?, ?, ?)").join(", ");
        const flattenedValues = validScores.flat();

        const query = `
            INSERT INTO ac_scores (student, ac, value)
            VALUES ${valuesPlaceholder}
            ON DUPLICATE KEY UPDATE value = VALUES(value);
        `;
        await connection.query(query, flattenedValues);

        // Trigger LO Score Recalculation
        const [loMappings] = await connection.query(
            "SELECT lo, priority FROM lo_ac_mapping WHERE ac = ?",
            [ac_id]
        );

        if (loMappings.length > 0) {
            for (const { lo, priority } of loMappings) {
                if (priority) {
                    const result = await recalculateLOScore(connection, lo,scores);
                } else {
                    console.warn(`Skipping LO (${lo}): No priority assigned.`);
                }
            }
        }

        // Trigger RO Score Recalculation
        const [roMappings] = await connection.query(
            "SELECT ro, priority FROM ro_lo_mapping WHERE lo IN (SELECT lo FROM lo_ac_mapping WHERE ac = ?)",
            [ac_id]
        );
        console.log("working...")
        if (roMappings.length > 0) {
            for (const { ro, priority } of roMappings) {
                if (priority) {
                    const result = await recalculateROScore(connection, ro);
                } else {
                    console.warn(`Skipping RO (${ro}): No priority assigned.`);
                } 
            }
        }

        await connection.commit();
        return { success: true, message: `${validScores.length} scores processed successfully.` };
    } catch (error) {
        await connection.rollback();
        console.error("Error recalculating AC scores:", error.message);
        return { success: false, error: error.message };
    } finally {
        connection.release();
    }
};

export { getAssessmentCriteriaScores, recalculateAcScores, setAssessmentCriteriaScore, updateAssessmentCriteriaScore };
