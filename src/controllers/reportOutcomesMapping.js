import db from "../config/db.js";
const priorityValues = {
    h: 0.5,
    m: 0.3,
    l: 0.2,
};
const getReportOutcomesMapping = async (req, res) => {
    try {
        const ro_id = req.headers["ro_id"]; // ro_id provided in the header
        // Check if ro_id is provided in headers
        if (!ro_id) {
            return res.status(400).json({ error: "ro_id is required in the headers" });
        }
        // Query to fetch lo_id, and priority mapped to the given ro_id
        const [rows] = await db.query(
            `SELECT lo, priority
            FROM ro_lo_mapping
            WHERE ro = ?`,
            [ro_id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: "No LOs found for the given ro_id." });
        }
        res.status(200).json({
            message: "LOs and their priorities for the given ro_id fetched successfully",
            data: rows
        });
    } catch (error) {
        console.error("Error fetching LOs mapping for RO:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
};
// UPDATE ro mapping 

const updateReportOutcomeMapping = async (req, res) => {
    try {
        const { ro_id, data } = req.body;

        if (!data || !Array.isArray(data) || data.length === 0) {
            return res.status(400).json({ error: "Invalid data format. Expected an array of objects with lo_id and priority." });
        }

        const validPriorities = ["h", "m", "l"];
        for (const item of data) {
            if (!validPriorities.includes(item.priority)) {
                return res.status(400).json({ error: `Invalid priority '${item.priority}'. Must be 'h', 'm', or 'l'.` });
            }
        }

        // Validate RO existence
        const [roRows] = await db.query("SELECT id FROM report_outcomes WHERE id = ?", [ro_id]);
        if (roRows.length === 0) {
            return res.status(404).json({ error: "Invalid ro_id provided." });
        }

        // Fetch existing RO-LO mappings
        const [existingMappings] = await db.query(
            "SELECT lo_id FROM ro_lo_mapping WHERE ro_id = ?",
            [ro_id]
        );
        const mappedLoIds = existingMappings.map(row => row.lo_id);

        // Ensure all provided lo_ids exist in the mapping
        const inputLoIds = data.map(item => item.lo_id);
        if (!inputLoIds.every(lo_id => mappedLoIds.includes(lo_id))) {
            return res.status(404).json({ error: "Some provided lo_ids are not mapped to the given ro_id." });
        }

        // Update priority in ro_lo_mapping
        for (const item of data) {
            await db.query(
                "UPDATE ro_lo_mapping SET priority = ? WHERE ro_id = ? AND lo_id = ?",
                [item.priority, ro_id, item.lo_id]
            );
        }

        // Fetch students for recalculating RO scores
        const [studentRows] = await db.query(
            `SELECT student_id FROM ro_scores WHERE ro_id = ?`,
            [ro_id]
        );
        if (studentRows.length === 0) {
            return res.status(404).json({ error: "No students found with existing RO scores." });
        }
        const studentIds = studentRows.map(row => row.student_id);

        // Recalculate RO scores
        for (const student_id of studentIds) {
            let roScore = 0;
            let totalDenominator = 0;

            for (const item of data) {
                const { lo_id, priority } = item;
                const weight = priorityValues[priority];
                totalDenominator += weight;

                const [loScoreRows] = await db.query(
                    "SELECT value FROM lo_scores WHERE lo_id = ? AND student_id = ?",
                    [lo_id, student_id]
                );
                if (loScoreRows.length === 0) continue;

                roScore += weight * loScoreRows[0].value;
            }

            if (totalDenominator > 0) {
                roScore /= totalDenominator;
                await db.query(
                    "UPDATE ro_scores SET value = ? WHERE ro_id = ? AND student_id = ?",
                    [roScore, ro_id, student_id]
                );
            }
        }

        res.status(200).json({
            message: "RO mappings updated and scores recalculated successfully",
            students_processed: studentIds.length,
        });
    } catch (error) {
        console.error("Error updating RO mappings:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

export { updateReportOutcomeMapping , getReportOutcomesMapping};
