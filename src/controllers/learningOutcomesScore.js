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

export { getLearningOutcomesScore };