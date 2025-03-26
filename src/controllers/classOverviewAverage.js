import db from "../config/db.js";

// Get average scores for AC along with student count in score categories
const getClassAverageAC = async (req, res) => {
    try {
        const { subject, classname, year, quarter, section } = req.headers;

        if (!subject || !classname || !year || !quarter || !section) {
            return res.status(400).json({ error: "Missing required headers." });
        }

        // Fetch AC averages and student counts per range
        const [acAverages] = await db.query(`
            SELECT 
                ac.id AS ac_id, ac.name AS ac_name, 
                COALESCE(AVG(ascr.value), NULL) AS average_score,
                COALESCE(SUM(CASE WHEN ascr.value > 0.67 THEN 1 ELSE 0 END), 0) AS above_0_67,
                COALESCE(SUM(CASE WHEN ascr.value BETWEEN 0.35 AND 0.67 THEN 1 ELSE 0 END), 0) AS between_0_35_0_67,
                COALESCE(SUM(CASE WHEN ascr.value < 0.35 THEN 1 ELSE 0 END), 0) AS below_0_35
            FROM assessment_criterias ac
            LEFT JOIN ac_scores ascr ON ascr.ac = ac.id
            LEFT JOIN students_records sr ON ascr.student = sr.id
            WHERE ac.subject = ? AND ac.quarter = ?
              AND (sr.year = ? AND sr.class = ? AND sr.section = ? OR sr.id IS NULL)
            GROUP BY ac.id, ac.name
            ORDER BY ac.id;
        `, [subject, quarter, year, classname, section]);

        // Fetch students grouped by score ranges
        const [students] = await db.query(`
            SELECT ascr.ac AS ac_id, s.id AS student_id, s.name AS student_name, ascr.value AS score
            FROM ac_scores ascr
            JOIN students_records sr ON ascr.student = sr.id
            JOIN students s ON sr.student = s.id
            WHERE sr.year = ? AND sr.class = ? AND sr.section = ? 
              AND ascr.ac IN (SELECT id FROM assessment_criterias WHERE subject = ? AND quarter = ?);
        `, [year, classname, section, subject, quarter]);

        // Group students by score range and remove `ac_id`
        const studentGroups = {};
        students.forEach(({ ac_id, student_id, student_name, score }) => {
            if (!studentGroups[ac_id]) {
                studentGroups[ac_id] = { above_0_67: [], between_0_35_0_67: [], below_0_35: [] };
            }
            const studentObj = { student_id, student_name, score };
            if (score > 0.67) {
                studentGroups[ac_id].above_0_67.push(studentObj);
            } else if (score >= 0.35 && score <= 0.67) {
                studentGroups[ac_id].between_0_35_0_67.push(studentObj);
            } else {
                studentGroups[ac_id].below_0_35.push(studentObj);
            }
        });

        // Format the final response
        const result = acAverages.map(row => ({
            ac_id: row.ac_id,
            ac_name: row.ac_name,
            average_score: row.average_score !== null ? parseFloat(row.average_score) : 0,
            student_counts: {
                above_0_67: row.above_0_67,
                between_0_35_0_67: row.between_0_35_0_67,
                below_0_35: row.below_0_35
            },
            students: studentGroups[row.ac_id] || { above_0_67: [], between_0_35_0_67: [], below_0_35: [] }
        }));

        res.status(200).json({ class_ac_averages: result });
    } catch (error) {
        console.error("Error fetching class AC averages:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

const getClassAverageLO = async (req, res) => {
    try {
        const { subject, classname, year, quarter, section } = req.headers;

        if (!subject || !classname || !year || !quarter || !section) {
            return res.status(400).json({ error: "Missing required headers." });
        }

        // Fetch LO averages along with student counts per score category
        const [loAverages] = await db.query(`
            SELECT 
                lo.id AS lo_id, lo.name AS lo_name, 
                COALESCE(AVG(ls.value), NULL) AS average_score,
                COALESCE(SUM(CASE WHEN ls.value > 0.67 THEN 1 ELSE 0 END), 0) AS above_0_67,
                COALESCE(SUM(CASE WHEN ls.value BETWEEN 0.35 AND 0.67 THEN 1 ELSE 0 END), 0) AS between_0_35_0_67,
                COALESCE(SUM(CASE WHEN ls.value < 0.35 THEN 1 ELSE 0 END), 0) AS below_0_35
            FROM learning_outcomes lo
            LEFT JOIN lo_scores ls ON ls.lo = lo.id
            LEFT JOIN students_records sr ON ls.student = sr.id
            WHERE lo.subject = ? AND lo.quarter = ?
              AND (sr.year = ? AND sr.class = ? AND sr.section = ? OR sr.id IS NULL)
            GROUP BY lo.id, lo.name
            ORDER BY lo.id;
        `, [subject, quarter, year, classname, section]);

        // Fetch students grouped by score ranges
        const [students] = await db.query(`
            SELECT ls.lo AS lo_id, s.id AS student_id, s.name AS student_name, ls.value AS score
            FROM lo_scores ls
            JOIN students_records sr ON ls.student = sr.id
            JOIN students s ON sr.student = s.id
            WHERE sr.year = ? AND sr.class = ? AND sr.section = ? 
              AND ls.lo IN (SELECT id FROM learning_outcomes WHERE subject = ? AND quarter = ?);
        `, [year, classname, section, subject, quarter]);

        // Group students by their score range
        const studentGroups = {};
        students.forEach(student => {
            if (!studentGroups[student.lo_id]) {
                studentGroups[student.lo_id] = { above_0_67: [], between_0_35_0_67: [], below_0_35: [] };
            }
            if (student.score > 0.67) {
                studentGroups[student.lo_id].above_0_67.push(student);
            } else if (student.score >= 0.35 && student.score <= 0.67) {
                studentGroups[student.lo_id].between_0_35_0_67.push(student);
            } else {
                studentGroups[student.lo_id].below_0_35.push(student);
            }
        });

        // Format the final response
        const result = loAverages.map(row => ({
            lo_id: row.lo_id,
            lo_name: row.lo_name,
            average_score: row.average_score !== null ? parseFloat(row.average_score) : 0,
            student_counts: {
                above_0_67: row.above_0_67,
                between_0_35_0_67: row.between_0_35_0_67,
                below_0_35: row.below_0_35
            },
            students: studentGroups[row.lo_id] || { above_0_67: [], between_0_35_0_67: [], below_0_35: [] }
        }));

        res.status(200).json({ class_lo_averages: result });
    } catch (error) {
        console.error("Error fetching class LO averages:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

const getClassAverageRO = async (req, res) => {
    try {
        const { subject, classname, year, section } = req.headers;

        if (!subject || !classname || !year || !section) {
            return res.status(400).json({ error: "Missing required headers." });
        }

        // Fetch RO averages along with student counts per score category
        const [roAverages] = await db.query(`
            SELECT 
                ro.id AS ro_id, ro.name AS ro_name, 
                COALESCE(AVG(rs.value), NULL) AS average_score,
                COALESCE(SUM(CASE WHEN rs.value > 0.67 THEN 1 ELSE 0 END), 0) AS above_0_67,
                COALESCE(SUM(CASE WHEN rs.value BETWEEN 0.35 AND 0.67 THEN 1 ELSE 0 END), 0) AS between_0_35_0_67,
                COALESCE(SUM(CASE WHEN rs.value < 0.35 THEN 1 ELSE 0 END), 0) AS below_0_35
            FROM report_outcomes ro
            LEFT JOIN ro_scores rs ON rs.ro = ro.id
            LEFT JOIN students_records sr ON rs.student = sr.id
            WHERE ro.subject = ? 
              AND (sr.year = ? AND sr.class = ? AND sr.section = ? OR sr.id IS NULL)
            GROUP BY ro.id, ro.name
            ORDER BY ro.id;
        `, [subject, year, classname, section]);

        // Fetch students grouped by score ranges
        const [students] = await db.query(`
            SELECT rs.ro AS ro_id, s.id AS student_id, s.name AS student_name, rs.value AS score
            FROM ro_scores rs
            JOIN students_records sr ON rs.student = sr.id
            JOIN students s ON sr.student = s.id
            WHERE sr.year = ? AND sr.class = ? AND sr.section = ? 
              AND rs.ro IN (SELECT id FROM report_outcomes WHERE subject = ?);
        `, [year, classname, section, subject]);

        // Group students by their score range
        const studentGroups = {};
        students.forEach(student => {
            if (!studentGroups[student.ro_id]) {
                studentGroups[student.ro_id] = { above_0_67: [], between_0_35_0_67: [], below_0_35: [] };
            }
            if (student.score > 0.67) {
                studentGroups[student.ro_id].above_0_67.push(student);
            } else if (student.score >= 0.35 && student.score <= 0.67) {
                studentGroups[student.ro_id].between_0_35_0_67.push(student);
            } else {
                studentGroups[student.ro_id].below_0_35.push(student);
            }
        });

        // Format the final response
        const result = roAverages.map(row => ({
            average_score: row.average_score !== null ? parseFloat(row.average_score) : 0,
            student_counts: {
                ro_id: row.ro_id,
                ro_name: row.ro_name,
                above_0_67: row.above_0_67,
                between_0_35_0_67: row.between_0_35_0_67,
                below_0_35: row.below_0_35
            },
            students: studentGroups[row.ro_id] || { above_0_67: [], between_0_35_0_67: [], below_0_35: [] }
        }));

        res.status(200).json({ class_ro_averages: result });
    } catch (error) {
        console.error("Error fetching class RO averages:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
};


export { getClassAverageLO, getClassAverageRO, getClassAverageAC };