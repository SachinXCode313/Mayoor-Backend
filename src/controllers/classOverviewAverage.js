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
                COALESCE(AVG(ascr.value), NULL) AS average_score
            FROM assessment_criterias ac
            LEFT JOIN ac_scores ascr ON ascr.ac = ac.id
            LEFT JOIN students_records sr ON ascr.student = sr.student
            WHERE ac.id IN (?) AND sr.year = ? AND sr.class = ? AND sr.section = ?
            GROUP BY ac.id, ac.name
            ORDER BY ac.id;
        `, [acIds, year, classname, section]);

        // Fetch student scores for the filtered ACs
        const [students] = await db.query(`
            SELECT ascr.ac AS ac_id, s.id AS student_id, s.name AS student_name, ascr.value AS score
            FROM ac_scores ascr
            JOIN students_records sr ON ascr.student = sr.student
            JOIN students s ON sr.student = s.id
            WHERE sr.year = ? AND sr.class = ? AND sr.section = ?
              AND ascr.ac IN (?)
        `, [year, classname, section, acIds]);

        // Group students by AC
        const studentGroups = {};
        students.forEach(({ ac_id, student_id, student_name, score }) => {
            if (!studentGroups[ac_id]) {
                studentGroups[ac_id] = [];
            }
            studentGroups[ac_id].push({
                student_id,
                student_name,
                score: score !== null ? parseFloat(score) : null
            });
        });

        // Format AC-wise response
        const result = acAverages.map(row => {
            const acStudents = studentGroups[row.ac_id] || [];

            // Count students in each range using fixed thresholds for display only
            const counts = { above_0_67: 0, between_0_35_0_67: 0, below_0_35: 0 };
            const grouped = { above_0_67: [], between_0_35_0_67: [], below_0_35: [] };

            acStudents.forEach(({ student_id, student_name, score }) => {
                if (score === null) return;
                const obj = { student_id, student_name, score };

                if (score > 0.67) {
                    counts.above_0_67++;
                    grouped.above_0_67.push(obj);
                } else if (score >= 0.35) {
                    counts.between_0_35_0_67++;
                    grouped.between_0_35_0_67.push(obj);
                } else {
                    counts.below_0_35++;
                    grouped.below_0_35.push(obj);
                }
            });

            return {
                ac_id: row.ac_id,
                ac_name: row.ac_name,
                average_score: row.average_score !== null ? parseFloat(row.average_score) : null,
                student_counts: counts,
                students: grouped
            };
        });

        // Compute per-student average across all ACs
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

        // Use dynamic bounds: average ± 0.07
        const lowerBound = overallClassAverage !== null ? overallClassAverage - 0.07 : null;
        const upperBound = overallClassAverage !== null ? overallClassAverage + 0.07 : null;

        // Classify students based on dynamic range
        const distribution = {
            above_average: [],
            average: [],
            below_average: []
        };

        studentAverages.forEach(({ student_id, student_name, average }) => {
            if (average === null || lowerBound === null || upperBound === null) {
                distribution.average.push({ student_id, student_name, average: null, score: null });
            } else if (average < lowerBound) {
                distribution.below_average.push({ student_id, student_name, average, score: average });
            } else if (average > upperBound) {
                distribution.above_average.push({ student_id, student_name, average, score: average });
            } else {
                distribution.average.push({ student_id, student_name, average, score: average });
            }
        });

        // Final response
        res.status(200).json({
            overall_class_average: overallClassAverage !== null ? parseFloat(overallClassAverage.toFixed(3)) : null,
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
                COALESCE(AVG(los.value), NULL) AS average_score
            FROM learning_outcomes lo
            LEFT JOIN lo_scores los ON los.lo = lo.id
            LEFT JOIN students_records sr ON los.student = sr.student
            WHERE lo.subject = ? AND lo.quarter = ?
              AND (sr.year = ? AND sr.class = ? AND sr.section = ?)
            GROUP BY lo.id, lo.name
            ORDER BY lo.id;
        `, [subject, quarter, year, classname, section]);

        const [students] = await db.query(`
            SELECT los.lo AS lo_id, s.id AS student_id, s.name AS student_name, los.value AS score
            FROM lo_scores los
            JOIN students_records sr ON los.student = sr.student
            JOIN students s ON sr.student = s.id
            WHERE sr.year = ? AND sr.class = ? AND sr.section = ? 
              AND los.lo IN (SELECT id FROM learning_outcomes WHERE subject = ? AND quarter = ?);
        `, [year, classname, section, subject, quarter]);

        // Group students by LO
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

        // Format LO-wise response
        const result = loAverages.map(row => ({
            lo_id: row.lo_id,
            lo_name: row.lo_name,
            average_score: row.average_score !== null ? parseFloat(row.average_score) : null,
            students: studentGroups[row.lo_id] || {
                above_0_67: [], between_0_35_0_67: [], below_0_35: []
            }
        }));

        // Compute per-student averages
        const studentMap = {};
        students.forEach(({ student_id, student_name, score }) => {
            if (!studentMap[student_id]) {
                studentMap[student_id] = { student_id, student_name, scores: [] };
            }
            if (score !== null) {
                studentMap[student_id].scores.push(parseFloat(score));
            }
        });

        const validStudentAverages = [];
        Object.values(studentMap).forEach(({ student_id, student_name, scores }) => {
            if (scores.length > 0) {
                const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
                validStudentAverages.push({ student_id, student_name, average: avg });
            }
        });

        const overall_class_average =
            validStudentAverages.length > 0
                ? parseFloat((validStudentAverages.reduce((sum, s) => sum + s.average, 0) / validStudentAverages.length).toFixed(4))
                : null;

        const lowerBound = overall_class_average !== null ? overall_class_average - 0.07 : null;
        const upperBound = overall_class_average !== null ? overall_class_average + 0.07 : null;

        const distribution = {
            above_average: [],
            average: [],
            below_average: []
        };

        validStudentAverages.forEach(({ student_id, student_name, average }) => {
            const studentEntry = {
                student_id,
                student_name,
                average: parseFloat(average.toFixed(4)),
                score: parseFloat(average.toFixed(4))
            };

            if (average > upperBound) {
                distribution.above_average.push(studentEntry);
            } else if (average < lowerBound) {
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
                COALESCE(AVG(ros.value), NULL) AS average_score
            FROM report_outcomes ro
            LEFT JOIN ro_scores ros ON ros.ro = ro.id
            LEFT JOIN students_records sr ON ros.student = sr.student
            WHERE ro.subject = ? AND ro.year = ?
              AND (sr.year = ? AND sr.class = ? AND sr.section = ? )
            GROUP BY ro.id, ro.name
            ORDER BY ro.id;
        `, [subject, year, year, classname, section]);

        const [students] = await db.query(`
            SELECT ros.ro AS ro_id, s.id AS student_id, s.name AS student_name, ros.value AS score
            FROM ro_scores ros
            JOIN students_records sr ON ros.student = sr.id
            JOIN students s ON sr.student = s.id
            WHERE sr.year = ? AND sr.class = ? AND sr.section = ?
              AND ros.ro IN (SELECT id FROM report_outcomes WHERE subject = ? AND year = ?);
        `, [year, classname, section, subject, year]);

        // Group students per RO
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

        // Structure final RO response
        const result = roAverages.map(row => ({
            ro_id: row.ro_id,
            ro_name: row.ro_name,
            average_score: row.average_score !== null ? parseFloat(row.average_score) : null,
            students: studentGroups[row.ro_id] || {
                above_0_67: [], between_0_35_0_67: [], below_0_35: []
            }
        }));

        // Compute per-student averages
        const studentMap = {};
        students.forEach(({ student_id, student_name, score }) => {
            if (!studentMap[student_id]) {
                studentMap[student_id] = { student_id, student_name, scores: [] };
            }
            if (score !== null) {
                studentMap[student_id].scores.push(parseFloat(score));
            }
        });

        const validStudentAverages = [];
        Object.values(studentMap).forEach(({ student_id, student_name, scores }) => {
            if (scores.length > 0) {
                const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
                validStudentAverages.push({ student_id, student_name, average: avg });
            }
        });

        const overall_class_average =
            validStudentAverages.length > 0
                ? parseFloat((validStudentAverages.reduce((sum, s) => sum + s.average, 0) / validStudentAverages.length).toFixed(4))
                : null;

        const lowerBound = overall_class_average !== null ? overall_class_average - 0.07 : null;
        const upperBound = overall_class_average !== null ? overall_class_average + 0.07 : null;

        const distribution = {
            above_average: [],
            average: [],
            below_average: []
        };

        validStudentAverages.forEach(({ student_id, student_name, average }) => {
            const studentEntry = {
                student_id,
                student_name,
                average: parseFloat(average.toFixed(4)),
                score: parseFloat(average.toFixed(4))
            };

            if (average > upperBound) {
                distribution.above_average.push(studentEntry);
            } else if (average < lowerBound) {
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