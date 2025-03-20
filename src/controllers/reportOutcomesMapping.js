import db from "../config/db.js";

const priorityValues = { h: 0.5, m: 0.3, l: 0.2 };

// **Function to Recalculate RO Scores**
const recalculateROWeightAndScore = async (connection, ro_id) => {
    try {
        console.log("Recalculating RO Scores...");
        const [loWeights] = await connection.query(
            "SELECT lo, weight FROM ro_lo_mapping WHERE ro = ?", [ro_id]
        );

        if (loWeights.length === 0) return;

        let totalDenominator = loWeights.reduce((sum, row) => sum + row.weight, 0);
        if (totalDenominator === 0) return;

        const loIds = loWeights.map(row => row.lo);
        const [studentScores] = await connection.query(
            "SELECT DISTINCT student FROM lo_scores WHERE lo IN (?)", [loIds]
        );

        for (const { student } of studentScores) {
            let roScore = 0;
            let hasValidScore = false;

            for (const { lo, weight } of loWeights) {
                const [loScoreRows] = await connection.query(
                    "SELECT value FROM lo_scores WHERE lo = ? AND student = ?", [lo, student]
                );

                if (loScoreRows.length > 0) {
                    const loScore = parseFloat(loScoreRows[0].value);
                    if (!isNaN(loScore)) {
                        roScore += (weight / totalDenominator) * loScore;
                        hasValidScore = true;
                    }
                }
            }

            if (hasValidScore) {
                roScore = isNaN(roScore) ? 0 : roScore;
                await connection.query(
                    "INSERT INTO ro_scores (ro, student, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = ?",
                    [ro_id, student, roScore, roScore]
                );
            }
        }
        console.log("RO Scores recalculated successfully.");
    } catch (error) {
        console.error("Error recalculating RO weight and score:", error.message);
    }
};

// **Main Function: Update Report Outcome Mapping**
const updateReportOutcomeMapping = async (req, res) => {
    try {
        console.log("Starting updateReportOutcomeMapping...");
        const { ro_id } = req.query;
        const { data } = req.body;

        if (!data || !Array.isArray(data) || data.length === 0) {
            return res.status(400).json({ error: "Invalid data format. Expected an array of objects with lo_id and priority." });
        }

        const validPriorities = ["h", "m", "l"];
        for (const item of data) {
            if (!validPriorities.includes(item.priority)) {
                return res.status(400).json({ error: `Invalid priority '${item.priority}'. Must be 'h', 'm', or 'l'.` });
            }
        }

        const [roRows] = await db.query("SELECT id FROM report_outcomes WHERE id = ?", [ro_id]);
        if (roRows.length === 0) return res.status(404).json({ error: "Invalid ro_id provided." });

        const [existingMappings] = await db.query("SELECT lo, priority FROM ro_lo_mapping WHERE ro = ?", [ro_id]);

        const existingMappingMap = new Map(existingMappings.map(row => [row.lo, row.priority]));
        const inputMappingMap = new Map(data.map(item => [item.lo_id, item.priority]));

        let mappingChanged = false;

        // **Handle New Mappings & Updates**
        for (const { lo_id, priority } of data) {
            const weight = priorityValues[priority];

            if (!existingMappingMap.has(lo_id)) {
                await db.query("INSERT INTO ro_lo_mapping (ro, lo, priority, weight) VALUES (?, ?, ?, ?)", [ro_id, lo_id, priority, weight]);
                mappingChanged = true;
            } else if (existingMappingMap.get(lo_id) !== priority) {
                await db.query("UPDATE ro_lo_mapping SET priority = ?, weight = ? WHERE ro = ? AND lo = ?", [priority, weight, ro_id, lo_id]);
                mappingChanged = true;
            }
        }

        // **Handle Deletions**
        for (const lo_id of existingMappingMap.keys()) {
            if (!inputMappingMap.has(lo_id)) {
                await db.query("DELETE FROM ro_lo_mapping WHERE ro = ? AND lo = ?", [ro_id, lo_id]);
                mappingChanged = true;
            }
        }

        // **Only Recalculate RO Scores if Mapping Changed**
        if (mappingChanged) {
            await recalculateROWeightAndScore(db, ro_id);
            console.log("RO scores recalculated successfully.");
        }

        res.status(200).json({
            message: "RO mappings updated and scores recalculated successfully.",
        });

    } catch (error) {
        console.error("Error updating RO mappings:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

const getReportOutcomesMapping = async (req, res) => {
    try {
        const ro_id = req.headers["ro_id"];
        if (!ro_id) return res.status(400).json({ error: "ro_id is required in the headers" });

        const [rows] = await db.query(
            `SELECT lo, priority FROM ro_lo_mapping WHERE ro = ?`, [ro_id]
        );

        if (rows.length === 0) return res.status(404).json({ error: "No LOs found for the given ro_id." });

        res.status(200).json({
            message: "LOs and their priorities for the given ro_id fetched successfully",
            data: rows
        });
    } catch (error) {
        console.error("Error fetching LOs mapping for RO:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

// **Export Functions**
export { updateReportOutcomeMapping, getReportOutcomesMapping };