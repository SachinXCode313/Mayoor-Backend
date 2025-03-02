import db from "../config/db.js";

const getStudentReport = async (req, res) => {
    const { studentid, year, quarter, subject, classname } = req.headers;

    if (!studentid || !year || !quarter || !subject || !classname) {
        return res.status(400).json({ message: "Missing required headers: studentid, year, quarter, subject, classname" });
    }

    try {
        const queries = {
            ac: `SELECT ac.id AS ac_id, ac.name AS ac_name, acs.value
                 FROM ac_scores acs
                 JOIN assessment_criterias ac ON acs.ac = ac.id
                 WHERE acs.student = ? AND ac.year = ? AND ac.quarter = ? AND ac.subject = ? AND ac.class = ?`,
            lo: `SELECT lo.id AS lo_id, lo.name AS lo_name, los.value
                 FROM lo_scores los
                 JOIN learning_outcomes lo ON los.lo = lo.id
                 WHERE los.student = ? AND lo.year = ? AND lo.quarter = ? AND lo.subject = ? AND lo.class = ?`,
            ro: `SELECT ro.id AS ro_id, ro.name AS ro_name, ros.value
                 FROM ro_scores ros
                 JOIN report_outcomes ro ON ros.ro = ro.id
                 WHERE ros.student = ? AND ro.year = ? AND ro.subject = ?`
        };

        const [acResults] = await db.execute(queries.ac, [studentid, year, quarter, subject, classname]);
        const [loResults] = await db.execute(queries.lo, [studentid, year, quarter, subject, classname]);
        const [roResults] = await db.execute(queries.ro, [studentid, year, subject]);

        const calculateAvg = (results) => {
            if (results.length === 0) return null;
            const sum = results.reduce((acc, { value }) => acc + parseFloat(value), 0);
            return (sum / results.length).toFixed(2);
        };

        const response = {
            student_id: studentid,
            ac_scores: acResults,
            lo_scores: loResults,
            ro_scores: roResults,
            avg_ac: calculateAvg(acResults),
            avg_lo: calculateAvg(loResults),
            avg_ro: calculateAvg(roResults)
        };

        res.status(200).json(response);
    } catch (err) {
        console.error("Error fetching student scores:", err);
        res.status(500).json({ message: "Server error while fetching student scores", error: err.message });
    }
};

export default getStudentReport
