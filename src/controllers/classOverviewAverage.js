import db from "../config/db.js";

// Get average scores for AC along with student count in score categories
const getClassAverageAC = async (req, res) => {
    try {
        const { subject, classname, year, quarter, section } = req.headers;

        if (!subject || !classname || !year || !quarter || !section) {
            return res.status(400).json({
                error: "Missing required headers: subject, classname, year, quarter, or section.",
            });
        }

        // Fetch AC averages along with student count in each group (adjusting range for 0-1 scale)
        const [acAverages] = await db.query(`
            SELECT 
                ac.id AS ac_id, ac.name AS ac_name, 
                AVG(ascore.value) AS average_score,
                SUM(CASE WHEN ascore.value > 0.67 THEN 1 ELSE 0 END) AS above_0_67,
                SUM(CASE WHEN ascore.value BETWEEN 0.35 AND 0.67 THEN 1 ELSE 0 END) AS between_0_35_0_67,
                SUM(CASE WHEN ascore.value < 0.35 THEN 1 ELSE 0 END) AS below_0_35
            FROM ac_scores ascore
            JOIN students_records sr ON ascore.student = sr.id
            JOIN assessment_criterias ac ON ascore.ac = ac.id
            WHERE sr.year = ? AND sr.class = ? AND sr.section = ? 
              AND ac.subject = ? AND ac.quarter = ?
            GROUP BY ac.id, ac.name
            ORDER BY ac.id;
        `, [year, classname, section, subject, quarter]);

        if (acAverages.length === 0) {
            return res.status(404).json({ error: "No AC scores found for the provided filters." });
        }

        // Fetch students grouped by score ranges, joining with the `students` table
        const [students] = await db.query(`
            SELECT 
                ascore.ac AS ac_id, 
                sr.id AS student_record_id, 
                s.id AS student_id, s.name AS student_name, 
                ascore.value AS score
            FROM ac_scores ascore
            JOIN students_records sr ON ascore.student = sr.id
            JOIN students s ON sr.student = s.id
            JOIN assessment_criterias ac ON ascore.ac = ac.id
            WHERE sr.year = ? AND sr.class = ? AND sr.section = ? 
              AND ac.subject = ? AND ac.quarter = ?;
        `, [year, classname, section, subject, quarter]);

        // Organizing students into groups based on the 0-1 range
        const studentGroups = {};
        students.forEach(student => {
            if (!studentGroups[student.ac_id]) {
                studentGroups[student.ac_id] = { above_0_67: [], between_0_35_0_67: [], below_0_35: [] };
            }
            if (student.score > 0.67) {
                studentGroups[student.ac_id].above_0_67.push({ id: student.student_id, name: student.student_name });
            } else if (student.score >= 0.35 && student.score <= 0.67) {
                studentGroups[student.ac_id].between_0_35_0_67.push({ id: student.student_id, name: student.student_name });
            } else {
                studentGroups[student.ac_id].below_0_35.push({ id: student.student_id, name: student.student_name });
            }
        });

        // Merging student data into AC averages
        const result = acAverages.map(row => ({
            ac_id: row.ac_id,
            ac_name: row.ac_name,
            average_score: parseFloat(row.average_score),
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




// Get average scores for LO along with student count in score categories
const getClassAverageLO = async (req, res) => {
    try {
        const { subject, classname, year, quarter, section } = req.headers;

        if (!subject || !classname || !year || !quarter || !section) {
            return res.status(400).json({
                error: "Missing required headers: subject, classname, year, quarter, or section.",
            });
        }

        // Fetch LO averages along with student count in each group (adjusting range for 0-1 scale)
        const [loAverages] = await db.query(`
            SELECT 
                lo.id AS lo_id, lo.name AS lo_name, 
                AVG(ls.value) AS average_score,
                SUM(CASE WHEN ls.value > 0.67 THEN 1 ELSE 0 END) AS above_0_67,
                SUM(CASE WHEN ls.value BETWEEN 0.35 AND 0.67 THEN 1 ELSE 0 END) AS between_0_35_0_67,
                SUM(CASE WHEN ls.value < 0.35 THEN 1 ELSE 0 END) AS below_0_35
            FROM lo_scores ls
            JOIN students_records sr ON ls.student = sr.id
            JOIN learning_outcomes lo ON ls.lo = lo.id
            WHERE sr.year = ? AND sr.class = ? AND sr.section = ? 
              AND lo.subject = ? AND lo.quarter = ?
            GROUP BY lo.id, lo.name
            ORDER BY lo.id;
        `, [year, classname, section, subject, quarter]);

        if (loAverages.length === 0) {
            return res.status(404).json({ error: "No LO scores found for the provided filters." });
        }

        // Fetch students grouped by score ranges, joining with the `students` table
        const [students] = await db.query(`
            SELECT 
                ls.lo AS lo_id, 
                sr.id AS student_record_id, 
                s.id AS student_id, s.name AS student_name, 
                ls.value AS score
            FROM lo_scores ls
            JOIN students_records sr ON ls.student = sr.id
            JOIN students s ON sr.student = s.id
            JOIN learning_outcomes lo ON ls.lo = lo.id
            WHERE sr.year = ? AND sr.class = ? AND sr.section = ? 
              AND lo.subject = ? AND lo.quarter = ?;
        `, [year, classname, section, subject, quarter]);

        // Organizing students into groups based on the 0-1 range
        const studentGroups = {};
        students.forEach(student => {
            if (!studentGroups[student.lo_id]) {
                studentGroups[student.lo_id] = { above_0_67: [], between_0_35_0_67: [], below_0_35: [] };
            }
            if (student.score > 0.67) {
                studentGroups[student.lo_id].above_0_67.push({ id: student.student_id, name: student.student_name });
            } else if (student.score >= 0.35 && student.score <= 0.67) {
                studentGroups[student.lo_id].between_0_35_0_67.push({ id: student.student_id, name: student.student_name });
            } else {
                studentGroups[student.lo_id].below_0_35.push({ id: student.student_id, name: student.student_name });
            }
        });

        // Merging student data into LO averages
        const result = loAverages.map(row => ({
            lo_id: row.lo_id,
            lo_name: row.lo_name,
            average_score: parseFloat(row.average_score),
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


// Get average scores for RO along with student count in score categories
const getClassAverageRO = async (req, res) => {
    try {
        const { subject, classname, year, section } = req.headers;

        if (!subject || !classname || !year || !section) {
            return res.status(400).json({
                error: "Missing required headers: subject, classname, year, or section.",
            });
        }

        // Fetch RO averages along with student count in each group (adjusted for 0-1 scale)
        const [roAverages] = await db.query(`
            SELECT 
                ro.id AS ro_id, ro.name AS ro_name, 
                AVG(rs.value) AS average_score,
                SUM(CASE WHEN rs.value > 0.67 THEN 1 ELSE 0 END) AS above_0_67,
                SUM(CASE WHEN rs.value BETWEEN 0.35 AND 0.67 THEN 1 ELSE 0 END) AS between_0_35_0_67,
                SUM(CASE WHEN rs.value < 0.35 THEN 1 ELSE 0 END) AS below_0_35
            FROM ro_scores rs
            JOIN students_records sr ON rs.student = sr.id
            JOIN report_outcomes ro ON rs.ro = ro.id
            WHERE sr.year = ? AND sr.class = ? AND sr.section = ? 
              AND ro.subject = ?
            GROUP BY ro.id, ro.name
            ORDER BY ro.id;
        `, [year, classname, section, subject]);

        if (roAverages.length === 0) {
            return res.status(404).json({ error: "No RO scores found for the provided filters." });
        }

        // Fetch students grouped by score ranges, joining with the `students` table
        const [students] = await db.query(`
            SELECT 
                rs.ro AS ro_id, 
                sr.id AS student_record_id, 
                s.id AS student_id, s.name AS student_name, 
                rs.value AS score
            FROM ro_scores rs
            JOIN students_records sr ON rs.student = sr.id
            JOIN students s ON sr.student = s.id
            JOIN report_outcomes ro ON rs.ro = ro.id
            WHERE sr.year = ? AND sr.class = ? AND sr.section = ? 
              AND ro.subject = ?;
        `, [year, classname, section, subject]);

        // Organizing students into groups based on the 0-1 range
        const studentGroups = {};
        students.forEach(student => {
            if (!studentGroups[student.ro_id]) {
                studentGroups[student.ro_id] = { above_0_67: [], between_0_35_0_67: [], below_0_35: [] };
            }
            if (student.score > 0.67) {
                studentGroups[student.ro_id].above_0_67.push({ id: student.student_id, name: student.student_name });
            } else if (student.score >= 0.35 && student.score <= 0.67) {
                studentGroups[student.ro_id].between_0_35_0_67.push({ id: student.student_id, name: student.student_name });
            } else {
                studentGroups[student.ro_id].below_0_35.push({ id: student.student_id, name: student.student_name });
            }
        });

        // Merging student data into RO averages
        const result = roAverages.map(row => ({
            ro_id: row.ro_id,
            ro_name: row.ro_name,
            average_score: parseFloat(row.average_score),
            student_counts: {
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