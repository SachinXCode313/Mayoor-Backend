
import db from "../config/db.js";

// GET Report Outcomes with their Learning Outcomes
const getReportOutcomes = async (req, res) => {
    const { year, subject, quarter, classname } = req.headers;

    // Validate headers
    if (!year || !subject || !quarter || !classname) {
        return res.status(400).json({ message: "Missing required headers: year, subject, quarter, or classname" });
    }

    try {
        // Fetch Report Outcomes based on year and subject
        const roQuery = `
            SELECT id AS ro_id, name AS ro_name
            FROM report_outcomes
            WHERE year = ? AND subject = ?
        `;
        const [reportOutcomes] = await db.execute(roQuery, [year, subject]);

        if (reportOutcomes.length === 0) {
            return res.status(404).json({ message: "No report outcomes found for the given filters" });
        }

        // Get list of RO IDs
        const roIds = reportOutcomes.map(ro => ro.ro_id);

        let learningOutcomes = [];
        if (roIds.length > 0) {
            const placeholders = roIds.map(() => "?").join(", ");
            const loQuery = `
                SELECT lom.ro, lo.id AS lo_id, lo.name AS lo_name, lom.priority, lom.weight
                FROM ro_lo_mapping lom
                LEFT JOIN learning_outcomes lo ON lom.lo = lo.id
                WHERE lom.ro IN (${placeholders})
                  AND lo.subject = ? 
                  AND lo.year = ? 
                  AND lo.quarter = ?
                  AND lo.class = ?
            `;
            [learningOutcomes] = await db.execute(loQuery, [...roIds, subject, year, quarter, classname]);
        }

        // Map learning outcomes to their respective report outcomes
        const roWithLO = reportOutcomes.map(ro => ({
            ...ro,
            learning_outcomes: learningOutcomes
                .filter(lo => lo.ro === ro.ro_id && lo.lo_id !== null) // Ensure only valid LOs
                .map(lo => ({
                    lo_id: lo.lo_id,
                    lo_name: lo.lo_name,
                    priority: lo.priority,
                }))
        }));

        res.status(200).json(roWithLO);
    } catch (err) {
        console.error("Error fetching report outcomes:", err);
        res.status(500).json({ message: "Internal server error" });
    }
};

// POST Report Outcome
const addReportOutcome = async (req, res) => {
    const { year, classname, section, quarter, subject } = req.headers;
    const { name } = req.body;

    if (!year || !classname || !section || !quarter || !subject || !name) {
        return res.status(400).json({ message: "Missing required fields in headers or body" });
    }

    try {
        // Insert new Report Outcome (assuming 'id' is auto-incremented)
        const query = `
            INSERT INTO report_outcomes (name, year, subject) 
            VALUES (?, ?, ?)
        `;
        const [result] = await db.execute(query, [name, year, subject]);

        // Fetch the newly inserted report outcome
        const [newRO] = await db.execute(
            `SELECT id AS ro_id, name AS ro_name FROM report_outcomes WHERE id = ?`,
            [result.insertId]
        );

        res.status(201).json({
            message: "Report outcome added successfully",
            report_outcome: newRO[0]  // Return inserted record
        });
    } catch (err) {
        console.error("Error inserting report outcome:", err);
        res.status(500).json({ message: "Server error", error: err.message });
    }
};


// UPDATE Report Outcome
const updateReportOutcome = async (req, res) => {
    const { id } = req.query;
    const { name } = req.body;

    if (!id || !name) {
        return res.status(400).json({ message: "Missing required fields: Report Outcome ID (params) or name (body)." });
    }

    try {
        // Update the name of the Report Outcome
        const updateQuery = "UPDATE report_outcomes SET name = ? WHERE id = ?";
        const [result] = await db.execute(updateQuery, [name, id]);

        // Check if the update actually happened
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Report outcome not found." });
        }

        res.status(200).json({
            message: "Report outcome updated successfully.",
        });
    } catch (err) {
        console.error("Error updating report outcome:", err);
        res.status(500).json({ message: "Server error", error: err.message });
    }
};


const removeReportOutcome = async (req, res) => {
    const id = req.query["id"]; // Use correct parameter name

    if (!id) {
        return res.status(400).json({ message: "Missing required params: id." });
    }

    if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid 'id'. It should be a number." });
    }

    try {
        // Delete report outcome
        const [deleteResult] = await db.execute(
            "DELETE FROM report_outcomes WHERE id = ?",
            [id]
        );

        if (deleteResult.affectedRows === 0) {
            return res.status(404).json({ message: "No report outcome found with the given 'ro_id'." });
        }

        res.status(200).json({
            message: `Deleted report outcome with id ${id} successfully.`,
        });
    } catch (err) {
        console.error("Error deleting report outcome:", err);
        res.status(500).json({ message: "Server error", error: err.message });
    }
};



export { getReportOutcomes, addReportOutcome, updateReportOutcome, removeReportOutcome};
