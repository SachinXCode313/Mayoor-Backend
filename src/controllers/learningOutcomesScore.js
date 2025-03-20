import db from "../config/db.js";

// Get Leaning Outcomes Score
const getLearningOutcomesScore = async (req, res) => {
    try {
        const { student_id, lo_id } = req.headers;
        if (!student_id) {
            return res.status(400).json({
                error: "student_id header is required.",
            });
        }
        // Start building the query to fetch lo_scores
        let query = `SELECT ls.lo, ls.value FROM lo_scores ls WHERE ls.student = ?`;
        let queryParams = [student_id];
        // If lo_id is provided, filter by it
        if (lo_id) {
            query += " AND ls.lo = ?";
            queryParams.push(lo_id);
        }
        // Execute the query
        const [loScores] = await db.query(query, queryParams);
        if (loScores.length === 0) {
            return res.status(404).json({
                error: "No lo_scores found for the provided student_id.",
            });
        }
        // Calculate the total score and average score
        const totalScore = loScores.reduce((acc, row) => acc + parseFloat(row.value), 0);
        const averageScore = loScores.length > 0 ? totalScore / loScores.length : null;
        // Constructing the response with both fetched data and the average score
        res.status(200).json({
            lo_scores: loScores,
            average_score: averageScore
        });
    } catch (error) {
        console.error("Error fetching lo_scores:", error.message);
        res.status(500).json({
            error: "Internal Server Error",
        });
    }
}

const recalculateLOScore = async (connection, lo_id) => {
    try {
        // Fetch all students linked to the given LO
        const [studentRows] = await connection.query(
            "SELECT DISTINCT student FROM ac_scores WHERE ac IN (SELECT ac FROM lo_ac_mapping WHERE lo = ?)",
            [lo_id]
        );
        if (studentRows.length === 0) return;
        
        const studentIds = studentRows.map(row => row.student);

        // Fetch all AC mappings for this LO
        const [mappings] = await connection.query(
            "SELECT ac, priority FROM lo_ac_mapping WHERE lo = ?",
            [lo_id]
        );
        
        if (mappings.length === 0) return;

        // Count priority occurrences
        let hCount = 0, mCount = 0, lCount = 0;
        const priorityWeights = { h: 0.5, m: 0.3, l: 0.2 };
        mappings.forEach(({ priority }) => {
            if (priority === 'h') hCount++;
            else if (priority === 'm') mCount++;
            else if (priority === 'l') lCount++;
        });
        
        const denominator = (hCount * priorityWeights.h) + (mCount * priorityWeights.m) + (lCount * priorityWeights.l);
        if (denominator === 0) return;

        // Calculate and update LO Scores for each student
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

        // **Auto-trigger RO Score Recalculation**
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



export { getLearningOutcomesScore, recalculateLOScore };