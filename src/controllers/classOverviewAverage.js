import db from "../config/db.js";

const getClassAverageAC = async (req, res) => {
    try {
        const { subject, classname, year, quarter, section } = req.headers;

        // Validate required headers
        if (!subject || !classname || !year || !quarter || !section) {
            return res.status(400).json({
                error: "Missing required headers: subject, classname, year, quarter, or section.",
            });
        }

        // Query to calculate the average score per AC
        const [acAverages] = await db.query(`
            SELECT ac.id AS ac_id, ac.name AS ac_name, AVG(ascore.value) AS average_score
            FROM ac_scores ascore
            JOIN students_records sr ON ascore.student = sr.id
            JOIN assessment_criterias ac ON ascore.ac = ac.id
            WHERE sr.year = ?
              AND sr.class = ?
              AND sr.section = ?
              AND ac.subject = ?
              AND ac.quarter = ?
            GROUP BY ac.id, ac.name
            ORDER BY ac.id;
        `, [year, classname, section, subject, quarter]);

        if (acAverages.length === 0) {
            return res.status(404).json({ error: "No AC scores found for the provided filters." });
        }

        // Format the response
        const result = acAverages.map(row => ({
            ac_id: row.ac_id,
            ac_name: row.ac_name,
            average_score: parseFloat(row.average_score.toFixed(3)) // Rounded to 3 decimal places
        }));

        res.status(200).json({ class_ac_averages: result });
    } catch (error) {
        console.error("Error fetching class AC averages:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

// Get average scores for Learning Outcomes (LO)
const getClassAverageLO = async (req, res) => {
    try {
        const { subject, classname, year, quarter, section } = req.headers;

        // Validate required headers
        if (!subject || !classname || !year || !quarter || !section) {
            return res.status(400).json({
                error: "Missing required headers: subject, classname, year, quarter, or section.",
            });
        }

        // Query to calculate the average score per LO
        const [loAverages] = await db.query(`
            SELECT lo.id AS lo_id, lo.name AS lo_name, AVG(ls.value) AS average_score
            FROM lo_scores ls
            JOIN students_records sr ON ls.student = sr.id
            JOIN learning_outcomes lo ON ls.lo = lo.id
            WHERE sr.year = ?
              AND sr.class = ?
              AND sr.section = ?
              AND lo.subject = ?
              AND lo.quarter = ?
            GROUP BY lo.id, lo.name
            ORDER BY lo.id;
        `, [year, classname, section, subject, quarter]);

        if (loAverages.length === 0) {
            return res.status(404).json({ error: "No LO scores found for the provided filters." });
        }

        // Format the response
        const result = loAverages.map(row => ({
            lo_id: row.lo_id,
            lo_name: row.lo_name,
            average_score: parseFloat(row.average_score.toFixed(3)) // Rounded to 3 decimal places
        }));

        res.status(200).json({ class_lo_averages: result });
    } catch (error) {
        console.error("Error fetching class LO averages:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

// Get average scores for Report Outcomes (RO)
const getClassAverageRO = async (req, res) => {
    try {
        const { subject, classname, year, section } = req.headers;

        // Validate required headers
        if (!subject || !classname || !year || !section) {
            return res.status(400).json({
                error: "Missing required headers: subject, classname, year, or section.",
            });
        }

        // Query to calculate the average score per RO
        const [roAverages] = await db.query(`
            SELECT ro.id AS ro_id, ro.name AS ro_name, AVG(rs.value) AS average_score
            FROM ro_scores rs
            JOIN students_records sr ON rs.student = sr.id
            JOIN report_outcomes ro ON rs.ro = ro.id
            WHERE sr.year = ?
              AND sr.class = ?
              AND sr.section = ?
              AND ro.subject = ?
            GROUP BY ro.id, ro.name
            ORDER BY ro.id;
        `, [year, classname, section, subject]);

        if (roAverages.length === 0) {
            return res.status(404).json({ error: "No RO scores found for the provided filters." });
        }

        // Format the response
        const result = roAverages.map(row => ({
            ro_id: row.ro_id,
            ro_name: row.ro_name,
            average_score: parseFloat(row.average_score.toFixed(3)) // Rounded to 3 decimal places
        }));

        res.status(200).json({ class_ro_averages: result });
    } catch (error) {
        console.error("Error fetching class RO averages:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

export { getClassAverageLO, getClassAverageRO, getClassAverageAC };
