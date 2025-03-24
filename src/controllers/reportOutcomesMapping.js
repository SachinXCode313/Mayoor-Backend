import db from "../config/db.js";

const recalculateROScore = async (connection, ro_id) => {
    try {
        // Priority values
        const priorityValues = { h: 0.5, m: 0.3, l: 0.2 };

        // Fetch all students linked to the given RO
        const [studentRows] = await connection.query(
            "SELECT student FROM lo_scores WHERE lo IN (SELECT lo FROM ro_lo_mapping WHERE ro = ?)",
            [ro_id]
        );
        if (studentRows.length === 0) return;

        const studentIds = studentRows.map(row => row.student);

        // Fetch all LO mappings for this RO
        const [mappings] = await connection.query(
            "SELECT lo, priority FROM ro_lo_mapping WHERE ro = ?",
            [ro_id]
        );
        if (mappings.length === 0) return;

        // Calculate weight for each priority
        let hCount = 0, mCount = 0, lCount = 0;
        mappings.forEach(({ priority }) => {
            if (priority === 'h') hCount++;
            else if (priority === 'm') mCount++;
            else if (priority === 'l') lCount++;
        });

        const totalWeight = (hCount * priorityValues.h) + (mCount * priorityValues.m) + (lCount * priorityValues.l);
        if (totalWeight === 0) return; // Avoid division by zero

        const hWeight = (priorityValues.h * hCount) / totalWeight;
        const mWeight = (priorityValues.m * mCount) / totalWeight;
        const lWeight = (priorityValues.l * lCount) / totalWeight;

        // Recalculate RO Scores for each student
        for (const { lo, priority } of mappings) {
            let weight = 0;
            if (priority === 'h') weight = hWeight;
            else if (priority === 'm') weight = mWeight;
            else if (priority === 'l') weight = lWeight;
            // Update the weight in the ro_lo_mapping table
            await connection.query(
                "UPDATE ro_lo_mapping SET weight = ? WHERE ro = ? AND lo = ?",
                [weight, ro_id, lo]);}
        for (const student_id of studentIds) {
            let weightedSum = 0;

            for (const { lo, priority } of mappings) {
                let weight = 0;
                if (priority === 'h') weight = hWeight;
                else if (priority === 'm') weight = mWeight;
                else if (priority === 'l') weight = lWeight;

                // Fetch the LO score for the student
                const [loScoreRows] = await connection.query(
                    "SELECT value FROM lo_scores WHERE lo = ? AND student = ?",
                    [lo, student_id]
                );
                if (loScoreRows.length > 0) {
                    const loScore = loScoreRows[0].value || 0;
                    weightedSum += loScore * weight;
                }
            }

            // Calculate RO score
            const roScore = weightedSum/mappings.length;

            // Insert or update RO Score
            await connection.query(
                "INSERT INTO ro_scores (ro, student, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = ?",
                [ro_id, student_id, roScore, roScore]
            );
        }
    } catch (error) {
        console.error("Error recalculating RO score:", error);
    }
};

// **Main Function: Update Report Outcome Mapping**
const updateReportOutcomeMapping = async (req, res) => {
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        console.log("Starting updateReportOutcomeMapping...");
        const { ro_id } = req.query;
        const { data } = req.body;

        // Validate input
        if (!ro_id) {
            return res.status(400).json({ error: "Missing required parameter: ro_id." });
        }

        if (!data || !Array.isArray(data) || data.length === 0) {
            return res.status(400).json({ error: "Invalid data format. Expected an array of objects with lo_id and priority." });
        }

        // Priority values
        const priorityValues = { h: 0.5, m: 0.3, l: 0.2 };
        const validPriorities = Object.keys(priorityValues);

        // Validate priorities in the input
        for (const item of data) {
            if (!validPriorities.includes(item.priority)) {
                return res.status(400).json({
                    error: `Invalid priority '${item.priority}'. Must be one of ${validPriorities.join(", ")}.`,
                });
            }
        }

        // Fetch existing report outcome
        const [roRows] = await connection.query("SELECT id FROM report_outcomes WHERE id = ?", [ro_id]);
        if (roRows.length === 0) {
            return res.status(404).json({ error: "Invalid ro_id provided." });
        }

        // Fetch existing mappings for the given report outcome
        const [existingMappings] = await connection.query(
            "SELECT lo, priority FROM ro_lo_mapping WHERE ro = ?",
            [ro_id]
        );

        // Create maps for easy comparison
        const existingMappingMap = new Map(existingMappings.map(row => [row.lo, row.priority]));
        const inputMappingMap = new Map(data.map(item => [item.lo_id, item.priority]));

        let mappingChanged = false;

        // **Handle New Mappings & Updates**
        for (const { lo_id, priority } of data) {
            const weight = priorityValues[priority];

            // If the mapping doesn't exist, insert it
            if (!existingMappingMap.has(lo_id)) {
                await connection.query(
                    "INSERT INTO ro_lo_mapping (ro, lo, priority, weight) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE priority = VALUES(priority), weight = VALUES(weight);",
                    [ro_id, lo_id, priority, weight]
                );
                mappingChanged = true;
            } 
            // If the priority has changed, update it
            else if (existingMappingMap.get(lo_id) !== priority) {
                await connection.query(
                    "UPDATE ro_lo_mapping SET priority = ?, weight = ? WHERE ro = ? AND lo = ?",
                    [priority, weight, ro_id, lo_id]
                );
                mappingChanged = true;
            }
        }

        // **Handle Deletions**
        for (const lo_id of existingMappingMap.keys()) {
            if (!inputMappingMap.has(lo_id)) {
                await connection.query(
                    "DELETE FROM ro_lo_mapping WHERE ro = ? AND lo = ?",
                    [ro_id, lo_id]
                );
                mappingChanged = true;
            }
        }

        // **Recalculate RO Scores if Mapping Changed**
        if (mappingChanged) {
            await recalculateROScore(connection, ro_id); // Call the recalculation function
            console.log("RO scores recalculated successfully.");
        }

        await connection.commit();
        res.status(200).json({
            message: `RO mappings updated successfully. ${
                mappingChanged ? "Scores recalculated." : "No changes detected."
            }`,
        });
    } catch (error) {
        await connection.rollback();
        console.error("Error updating RO mappings:", error.message);
        res.status(500).json({ error: "Internal Server Error", details: error.message });
    } finally {
        connection.release();
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

export { updateReportOutcomeMapping, getReportOutcomesMapping, recalculateROScore};