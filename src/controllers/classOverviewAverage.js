import db from "../config/db.js";

// Get average scores for AC along with student count in score categories
const getClassAverageAC = async (req, res) => {
    try {
        const { subject, classname, year, quarter, section } = req.headers;

        if (!subject || !classname || !year || !quarter || !section) {
            return res.status(400).json({ error: "Missing required headers." });
        }

        // Fetch relevant ACs based on subject and quarter
        const [acs] = await db.query(`
            SELECT id, name FROM assessment_criterias
            WHERE subject = ? AND quarter = ?
        `, [subject, quarter]);

        const acIds = acs.map(ac => ac.id);
        if (acIds.length === 0) {
            return res.status(200).json({
                overall_class_average: null,
                overall_distribution: { above_average: [], average: [], below_average: [] },
                class_ac_averages: []
            });
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
            WHERE ac.id IN (?) AND sr.year = ? AND sr.class = ? AND sr.section = ?
            GROUP BY ac.id, ac.name
            ORDER BY ac.id;
        `, [acIds, year, classname, section]);

        // Fetch student scores for the filtered ACs
        const [students] = await db.query(`
            SELECT ascr.ac AS ac_id, s.id AS student_id, s.name AS student_name, ascr.value AS score
            FROM ac_scores ascr
            JOIN students_records sr ON ascr.student = sr.id
            JOIN students s ON sr.student = s.id
            WHERE sr.year = ? AND sr.class = ? AND sr.section = ?
              AND ascr.ac IN (?)
        `, [year, classname, section, acIds]);

        // Group students by AC and score range
        const studentGroups = {};
        students.forEach(({ ac_id, student_id, student_name, score }) => {
            if (!studentGroups[ac_id]) {
                studentGroups[ac_id] = { above_0_67: [], between_0_35_0_67: [], below_0_35: [] };
            }
            const studentObj = { student_id, student_name, score: score };
            if (score > 0.67) {
                studentGroups[ac_id].above_0_67.push(studentObj);
            } else if (score >= 0.35 && score <= 0.67) {
                studentGroups[ac_id].between_0_35_0_67.push(studentObj);
            } else {
                studentGroups[ac_id].below_0_35.push(studentObj);
            }
        });

        // Format the final AC-wise response
        const result = acAverages.map(row => ({
            ac_id: row.ac_id,
            ac_name: row.ac_name,
            average_score: row.average_score !== null ? parseFloat(row.average_score) : null,
            student_counts: {
                above_0_67: row.above_0_67,
                between_0_35_0_67: row.between_0_35_0_67,
                below_0_35: row.below_0_35
            },
            students: studentGroups[row.ac_id] || {
                above_0_67: [], between_0_35_0_67: [], below_0_35: []
            }
        }));

        // Compute student average across all ACs
        const studentScoreMap = {};
        students.forEach(({ student_id, student_name, score }) => {
            if (!studentScoreMap[student_id]) {
                studentScoreMap[student_id] = {
                    student_id,
                    student_name,
                    total: 0,
                    count: 0
                };
            }
            if (score !== null) {
                studentScoreMap[student_id].total += parseFloat(score);
                studentScoreMap[student_id].count += 1;
            }
        });

        const studentAverages = Object.values(studentScoreMap).map(s => ({
            student_id: s.student_id,
            student_name: s.student_name,
            average: s.count > 0 ? s.total / s.count : null
        }));

        // Calculate overall class average
        const validStudentAverages = studentAverages.filter(s => s.average !== null);
        const overallClassAverage = validStudentAverages.length > 0
            ? validStudentAverages.reduce((sum, s) => sum + s.average, 0) / validStudentAverages.length
            : null;

        // Group students based on class average
        const distribution = {
            above_average: [],
            average: [],
            below_average: []
        };

        studentAverages.forEach(student => {
            const { student_id, student_name, average } = student;
            if (average === null || overallClassAverage === null) {
                distribution.average.push({ student_id, student_name, average: null, score: null });
            } else if (average > overallClassAverage) {
                distribution.above_average.push({ student_id, student_name, average, score: average });
            } else if (average < overallClassAverage) {
                distribution.below_average.push({ student_id, student_name, average, score: average });
            } else {
                distribution.average.push({ student_id, student_name, average, score: average });
            }
        });

        res.status(200).json({
            overall_class_average: overallClassAverage !== null ? parseFloat(overallClassAverage) : null,
            overall_distribution: distribution,
            class_ac_averages: result
        });

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

        const [loAverages] = await db.query(`
            SELECT 
                lo.id AS lo_id, lo.name AS lo_name,
                COALESCE(AVG(los.value), NULL) AS average_score,
                COALESCE(SUM(CASE WHEN los.value > 0.67 THEN 1 ELSE 0 END), 0) AS above_0_67,
                COALESCE(SUM(CASE WHEN los.value BETWEEN 0.35 AND 0.67 THEN 1 ELSE 0 END), 0) AS between_0_35_0_67,
                COALESCE(SUM(CASE WHEN los.value < 0.35 THEN 1 ELSE 0 END), 0) AS below_0_35
            FROM learning_outcomes lo
            LEFT JOIN lo_scores los ON los.lo = lo.id
            LEFT JOIN students_records sr ON los.student = sr.id
            WHERE lo.subject = ? AND lo.quarter = ?
              AND (sr.year = ? AND sr.class = ? AND sr.section = ? OR sr.id IS NULL)
            GROUP BY lo.id, lo.name
            ORDER BY lo.id;
        `, [subject, quarter, year, classname, section]);

        const [students] = await db.query(`
            SELECT los.lo AS lo_id, s.id AS student_id, s.name AS student_name, los.value AS score
            FROM lo_scores los
            JOIN students_records sr ON los.student = sr.id
            JOIN students s ON sr.student = s.id
            WHERE sr.year = ? AND sr.class = ? AND sr.section = ? 
              AND los.lo IN (SELECT id FROM learning_outcomes WHERE subject = ? AND quarter = ?);
        `, [year, classname, section, subject, quarter]);

        const studentGroups = {};
        students.forEach(({ lo_id, student_id, student_name, score }) => {
            if (!studentGroups[lo_id]) {
                studentGroups[lo_id] = { above_0_67: [], between_0_35_0_67: [], below_0_35: [] };
            }
            const studentObj = { student_id, student_name, score };
            if (score > 0.67) {
                studentGroups[lo_id].above_0_67.push(studentObj);
            } else if (score >= 0.35 && score <= 0.67) {
                studentGroups[lo_id].between_0_35_0_67.push(studentObj);
            } else {
                studentGroups[lo_id].below_0_35.push(studentObj);
            }
        });

        const result = loAverages.map(row => ({
            lo_id: row.lo_id,
            lo_name: row.lo_name,
            average_score: row.average_score !== null ? parseFloat(row.average_score) : null,
            student_counts: {
                above_0_67: row.above_0_67,
                between_0_35_0_67: row.between_0_35_0_67,
                below_0_35: row.below_0_35
            },
            students: studentGroups[row.lo_id] || { above_0_67: [], between_0_35_0_67: [], below_0_35: [] }
        }));

        const allScores = students.map(s => parseFloat(s.score)).filter(Boolean);
        const overall_class_average = allScores.length > 0
            ? parseFloat((allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(4))
            : null;

        const studentMap = {};
        students.forEach(({ student_id, student_name, score }) => {
            if (!studentMap[student_id]) {
                studentMap[student_id] = { student_id, student_name, scores: [] };
            }
            if (score !== null) studentMap[student_id].scores.push(parseFloat(score));
        });

        const distribution = {
            above_average: [],
            average: [],
            below_average: []
        };

        Object.values(studentMap).forEach(({ student_id, student_name, scores }) => {
            const avg = scores.length > 0
                ? parseFloat((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(4))
                : null;

            const studentEntry = { student_id, student_name, average: avg, score: avg };

            if (avg === null) {
                distribution.average.push(studentEntry);
            } else if (avg > overall_class_average) {
                distribution.above_average.push(studentEntry);
            } else if (avg < overall_class_average) {
                distribution.below_average.push(studentEntry);
            } else {
                distribution.average.push(studentEntry);
            }
        });

        res.status(200).json({
            overall_class_average,
            overall_distribution: distribution,
            class_lo_averages: result
        });

    } catch (error) {
        console.error("Error in LO average API:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
};


const getClassAverageRO = async (req, res) => {
    try {
        const { subject, classname, year, quarter, section } = req.headers;

        if (!subject || !classname || !year || !quarter || !section) {
            return res.status(400).json({ error: "Missing required headers." });
        }

        const [roAverages] = await db.query(`
            SELECT 
                ro.id AS ro_id, ro.name AS ro_name,
                COALESCE(AVG(ros.value), NULL) AS average_score,
                COALESCE(SUM(CASE WHEN ros.value > 0.67 THEN 1 ELSE 0 END), 0) AS above_0_67,
                COALESCE(SUM(CASE WHEN ros.value BETWEEN 0.35 AND 0.67 THEN 1 ELSE 0 END), 0) AS between_0_35_0_67,
                COALESCE(SUM(CASE WHEN ros.value < 0.35 THEN 1 ELSE 0 END), 0) AS below_0_35
            FROM report_outcomes ro
            LEFT JOIN ro_scores ros ON ros.ro = ro.id
            LEFT JOIN students_records sr ON ros.student = sr.id
            WHERE ro.subject = ? AND ro.quarter = ?
              AND (sr.year = ? AND sr.class = ? AND sr.section = ? OR sr.id IS NULL)
            GROUP BY ro.id, ro.name
            ORDER BY ro.id;
        `, [subject, quarter, year, classname, section]);

        const [students] = await db.query(`
            SELECT ros.ro AS ro_id, s.id AS student_id, s.name AS student_name, ros.value AS score
            FROM ro_scores ros
            JOIN students_records sr ON ros.student = sr.id
            JOIN students s ON sr.student = s.id
            WHERE sr.year = ? AND sr.class = ? AND sr.section = ? 
              AND ros.ro IN (SELECT id FROM report_outcomes WHERE subject = ? AND quarter = ?);
        `, [year, classname, section, subject, quarter]);

        const studentGroups = {};
        students.forEach(({ ro_id, student_id, student_name, score }) => {
            if (!studentGroups[ro_id]) {
                studentGroups[ro_id] = { above_0_67: [], between_0_35_0_67: [], below_0_35: [] };
            }
            const studentObj = { student_id, student_name, score };
            if (score > 0.67) {
                studentGroups[ro_id].above_0_67.push(studentObj);
            } else if (score >= 0.35 && score <= 0.67) {
                studentGroups[ro_id].between_0_35_0_67.push(studentObj);
            } else {
                studentGroups[ro_id].below_0_35.push(studentObj);
            }
        });

        const result = roAverages.map(row => ({
            ro_id: row.ro_id,
            ro_name: row.ro_name,
            average_score: row.average_score !== null ? parseFloat(row.average_score) : null,
            student_counts: {
                above_0_67: row.above_0_67,
                between_0_35_0_67: row.between_0_35_0_67,
                below_0_35: row.below_0_35
            },
            students: studentGroups[row.ro_id] || { above_0_67: [], between_0_35_0_67: [], below_0_35: [] }
        }));

        const allScores = students.map(s => parseFloat(s.score)).filter(Boolean);
        const overall_class_average = allScores.length > 0
            ? parseFloat((allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(4))
            : null;

        const studentMap = {};
        students.forEach(({ student_id, student_name, score }) => {
            if (!studentMap[student_id]) {
                studentMap[student_id] = { student_id, student_name, scores: [] };
            }
            if (score !== null) studentMap[student_id].scores.push(parseFloat(score));
        });

        const distribution = {
            above_average: [],
            average: [],
            below_average: []
        };

        Object.values(studentMap).forEach(({ student_id, student_name, scores }) => {
            const avg = scores.length > 0
                ? parseFloat((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(4))
                : null;

            const studentEntry = { student_id, student_name, average: avg, score: avg };

            if (avg === null) {
                distribution.average.push(studentEntry);
            } else if (avg > overall_class_average) {
                distribution.above_average.push(studentEntry);
            } else if (avg < overall_class_average) {
                distribution.below_average.push(studentEntry);
            } else {
                distribution.average.push(studentEntry);
            }
        });

        res.status(200).json({
            overall_class_average,
            overall_distribution: distribution,
            class_ro_averages: result
        });

    } catch (error) {
        console.error("Error in RO average API:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
};
export { getClassAverageLO, getClassAverageRO, getClassAverageAC };