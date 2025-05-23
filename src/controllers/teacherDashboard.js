import db from "../config/db.js";

const getTeacherDashboard = async (req, res) => {
    try {
        const { teacher_id, year, quarter } = req.headers;

        // Validate required headers
        if (!teacher_id || !year || !quarter) {
            return res.status(400).json({
                error: "Missing required headers: teacher, year, or quarter.",
            });
        }

        // Fetch teacher’s assigned subjects, sections, and classes
        const teacherQuery = `
            SELECT ta.class, ta.section, ta.subject, 
                   c.name AS class_name, s.name AS section_name, sub.name AS subject_name
            FROM teacher_allocation ta
            JOIN classes c ON ta.class = c.id
            JOIN sections s ON ta.section = s.id
            JOIN subjects sub ON ta.subject = sub.id
            WHERE ta.teacher = ?;
        `;

        const [teacherAssignments] = await db.query(teacherQuery, [teacher_id]);

        if (teacherAssignments.length === 0) {
            return res.status(404).json({ error: "No assigned classes found for this teacher." });
        }

        // Prepare queries to fetch AC, LO, and RO averages
        const results = [];

        for (const assignment of teacherAssignments) {
            const { class : class_id, section, subject, class_name, section_name, subject_name } = assignment;
            // AC Average Query (Fixed)
            const [acScores] = await db.query(`
                SELECT SUM(ascore.value) / COUNT(ascore.value) AS ac_avg
                FROM students_records sr
                LEFT JOIN ac_scores ascore ON sr.id = ascore.student
                LEFT JOIN assessment_criterias ac ON ascore.ac = ac.id
                WHERE sr.year = ?
                      AND sr.class = ?
                      AND sr.section = ?
                      AND ac.quarter = ?
                      AND ac.subject = ?
                GROUP BY ac.subject;
            `, [year, class_id, section, quarter, subject]);

            console.log("AC Scores:", acScores); // Debugging line
            
            // LO Average Query (Fixed)
            const [loScores] = await db.query(`
                SELECT SUM(ls.value) / COUNT(ls.value) AS lo_avg
                FROM students_records sr
                LEFT JOIN lo_scores ls ON sr.id = ls.student
                JOIN learning_outcomes lo ON ls.lo = lo.id
                WHERE sr.year = ?
                      AND sr.class = ?
                      AND sr.section = ?
                      AND lo.quarter = ?
                      AND lo.subject = ?
                GROUP BY lo.subject;
            `, [year, class_id, section, quarter, subject]);

            // RO Average Query (Fixed)
            const [roScores] = await db.query(`
                SELECT SUM(rs.value) / COUNT(rs.value) AS ro_avg
                FROM students_records sr
                LEFT JOIN ro_scores rs ON sr.id = rs.student
                JOIN report_outcomes ro ON rs.ro = ro.id
                WHERE sr.year = ?
                      AND sr.class = ?
                      AND sr.section = ?
                      AND ro.subject = ?
                GROUP BY ro.subject;
            `, [year, class_id, section, subject]);

            // Push formatted result
            results.push({
                subject: subject_name,
                section: section_name,
                quarter,
                class: class_name,
                ac_class_average: acScores.length ? parseFloat(acScores[0].ac_avg) : null,
                lo_class_average: loScores.length ? parseFloat(loScores[0].lo_avg) : null,
                ro_class_average: roScores.length ? parseFloat(roScores[0].ro_avg) : null
            });
        }

        res.status(200).json({ teacher_dashboard: results });
    } catch (error) {
        console.error("Error fetching teacher dashboard:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

export default getTeacherDashboard ;