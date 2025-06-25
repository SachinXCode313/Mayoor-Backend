import db from "../config/db.js";

// Get Report Outcomes Score
const getReportOutcomesScore = async (req, res) => {
    try {
        const { student } = req.headers;
        if (!student ) {
            return res.status(400).json({
                error: "student header is required.",
            });
        }
        // Fetch the report outcome scores for the given student_id
        const [roScores] = await db.query(
            `SELECT rs.ro, rs.value
            FROM ro_scores rs
            WHERE rs.student = ?`,
            [student]
        );
        if (roScores.length === 0) {
            return res.status(404).json({
                error: "No ro_scores found for the provided student.",
            });
        }
        // Calculate the total score and average score
        const totalScore = roScores.reduce((acc, row) => acc + parseFloat(row.value), 0);
        const averageScore = roScores.length > 0 ? totalScore / roScores.length : null;
        // Send the response with both the fetched data and the average score
        res.status(200).json({
            ro_scores: roScores,
            average_score: averageScore
        });
    } catch (error) {
        console.error("Error fetching ro_scores:", error.message);
        res.status(500).json({
            error: "Internal Server Error",
        });
    }
}   
export { getReportOutcomesScore };