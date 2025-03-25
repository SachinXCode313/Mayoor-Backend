
import db from "../config/db.js";
//get learning outcome
const getLearningOutcomes = async (req, res) => {
    const { subject, year, quarter, classname } = req.headers;
    // Validate required headers
    if (!subject || !year || !quarter || !classname) {
        return res.status(400).json({
            message: 'Invalid input. Subject, Class, Year, and Quarter are required in the headers.',
        });
    }
    try {
        // Fetch Learning Outcomes
        const loQuery = `
            SELECT id AS lo_id, name AS lo_name
            FROM learning_outcomes
            WHERE subject = ? AND year = ? AND quarter = ? AND class = ?
        `;
        const [learningOutcomes] = await db.execute(loQuery, [subject, year, quarter, classname]);
        if (learningOutcomes.length === 0) {
            return res.status(404).json({
                message: 'No learning outcomes found for the given filters.',
            });
        }
        // Get LO IDs
        const loIds = learningOutcomes.map(lo => lo.lo_id);
        if (loIds.length === 0) {
            return res.status(200).json(learningOutcomes); // No LOs, return empty response
        }
        // Fetch ROs mapped to LOs
        const roQuery = `
            SELECT rlm.lo, ro.id AS ro_id, ro.name AS ro_name
            FROM report_outcomes ro
            JOIN ro_lo_mapping rlm ON ro.id = rlm.ro
            WHERE rlm.lo IN (${loIds.map(() => "?").join(", ")})
        `;
        const [reportOutcomes] = await db.execute(roQuery, loIds);
        // Fetch ACs mapped to LOs with priority
        const acQuery = `
            SELECT ac.id AS ac_id, ac.name AS ac_name, lam.lo, lam.priority
            FROM assessment_criterias ac
            JOIN lo_ac_mapping lam ON ac.id = lam.ac
            WHERE lam.lo IN (${loIds.map(() => "?").join(", ")})
        `;
        const [assessmentCriterias] = await db.execute(acQuery, loIds);
        // Map ROs and ACs to corresponding LOs
        const loWithMappings = learningOutcomes.map(lo => ({
            ...lo,
            report_outcomes: reportOutcomes
                .filter(ro => ro.lo === lo.lo_id)
                .map(ro => ({
                    ro_id: ro.ro_id,
                    ro_name: ro.ro_name
                })),
            assessment_criterias: assessmentCriterias
                .filter(ac => ac.lo === lo.lo_id)
                .map(ac => ({
                    ac_id: ac.ac_id,
                    ac_name: ac.ac_name,
                    priority: ac.priority
                }))
        }));
        return res.status(200).json(loWithMappings);
    } catch (err) {
        console.error('Error retrieving learning outcomes:', err);
        return res.status(500).json({
            message: 'Server error while fetching learning outcomes',
            error: err.message,
        });
    }
};


// POST LO 
const addLearningOutcome = async (req, res) => {
    const { year, quarter, classname, subject } = req.headers;
    const { name, ro_id } = req.body;

    if (!year || !quarter || !classname || !subject || !name || !ro_id || !Array.isArray(ro_id)) {
        return res.status(400).json({
            message: "Missing or incorrect fields: year, quarter, class, subject (headers) or name, ro_id (array) (body)."
        });
    }

    const connection = await db.getConnection(); // Get a connection for transaction handling
    try {
        await connection.beginTransaction();

        // Insert new Learning Outcome
        const loQuery = `
            INSERT INTO learning_outcomes (name, year, quarter, class, subject) 
            VALUES (?, ?, ?, ?, ?)
        `;
        const [loResult] = await connection.execute(loQuery, [name, year, quarter, classname, subject]);
        const newLoId = loResult.insertId;

        // Insert RO-LO Mappings
        const mappingQuery = `
            INSERT INTO ro_lo_mapping (ro, lo, priority, weight) VALUES ?
        `;
        const mappingValues = ro_id.map(ro => [ro, newLoId, null, null]);
        await connection.query(mappingQuery, [mappingValues]);

        await connection.commit();

        res.status(201).json({
            message: "Learning outcome added successfully",
            insertedId: newLoId
        });
    } catch (err) {
        await connection.rollback();
        console.error("Error inserting learning outcome:", err);
        res.status(500).json({ message: "Server error", error: err.message });
    } finally {
        connection.release(); // Release connection back to the pool
    }
};

const priorityValues = {
    h: 0.5,
    m: 0.3,
    l: 0.2,
};

const updateLearningOutcome = async (req, res) => {
    const { id } = req.query;
    const { year, quarter, classname, subject } = req.headers;
    const { name, ro_id, priority } = req.body;

    if (!id || !year || !quarter || !classname || !subject) {
        return res.status(400).json({
            message: "Missing required fields: year, quarter, class, subject (headers) or LO id (params)."
        });
    }

    if (!name && (!ro_id || !Array.isArray(ro_id))) {
        return res.status(400).json({
            message: "At least one field (name or ro_id array) is required to update."
        });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // Validate if LO exists
        const [existingLO] = await connection.execute(
            `SELECT id FROM learning_outcomes WHERE id = ? AND year = ? AND quarter = ? AND class = ? AND subject = ?`,
            [id, year, quarter, classname, subject]
        );

        if (existingLO.length === 0) {
            return res.status(404).json({ message: "Learning outcome not found for the given filters." });
        }

        // Update LO Name if provided
        if (name) {
            await connection.execute(
                `UPDATE learning_outcomes SET name = ? WHERE id = ?`,
                [name, id]
            );
        }

        // Update RO-LO mapping if provided
        if (ro_id) {
            await connection.execute(`DELETE FROM ro_lo_mapping WHERE lo = ?`, [id]);

            const mappingQuery = `INSERT INTO ro_lo_mapping (ro, lo, priority) VALUES ?`;
            const mappingValues = ro_id.map(ro => [ro, id, priority || null]);
            await connection.query(mappingQuery, [mappingValues]);

            for (const ro of ro_id) {
                await recalculateROScore(connection, ro);
            }
        }

        await connection.commit();
        res.status(200).json({ message: "Learning Outcome updated successfully." });
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ error: error.message });
    } finally {
        connection.release();
    }
};

// Function to Recalculate RO Scores when mappings change
const recalculateROScore = async (connection, roId) => {
    const [studentScores] = await connection.execute(
        `SELECT ls.student, SUM(ls.value * CASE 
            WHEN rlm.priority = 'h' THEN 0.5
            WHEN rlm.priority = 'm' THEN 0.3
            WHEN rlm.priority = 'l' THEN 0.2
            ELSE 0 END) AS total_score
         FROM lo_scores ls
         JOIN ro_lo_mapping rlm ON ls.lo = rlm.lo
         WHERE rlm.ro = ?
         GROUP BY ls.student`,
        [roId]
    );

    for (const { student, total_score } of studentScores) {
        await connection.execute(
            `INSERT INTO ro_scores (student, ro, value) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE value = VALUES(value)`,
            [student, roId, total_score]
        );
    }
};


const removeLearningOutcome = async (req, res) => {
    const { lo_id } = req.query; // Expecting LO ID in URL

    if (!lo_id) {
        return res.status(400).json({ message: "Missing required parameter: lo_id" });
    }

    try {
        // Check if LO exists
        const [existingLO] = await db.execute(
            "SELECT id FROM learning_outcomes WHERE id = ?",
            [lo_id]
        );

        if (existingLO.length === 0) {
            return res.status(404).json({ message: "Learning Outcome not found" });
        }

        // Delete the LO (cascading will take care of related entries)
        await db.execute(
            "DELETE FROM learning_outcomes WHERE id = ?",
            [lo_id]
        );

        res.status(200).json({ message: "Learning Outcome deleted successfully" });
    } catch (err) {
        console.error("Error deleting Learning Outcome:", err);
        res.status(500).json({ message: "Server error", error: err.message });
    }
};

export { getLearningOutcomes, addLearningOutcome, updateLearningOutcome, removeLearningOutcome};