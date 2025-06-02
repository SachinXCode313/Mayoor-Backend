import { recalculateROScore } from "./reportOutcomesMapping.js";
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
const updateLearningOutcome = async (req, res) => {
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        const { id } = req.query;
        const { year, quarter, classname, section, subject } = req.headers;
        const { name, ro_id } = req.body;

        if (!id || !year || !quarter || !classname || !section || !subject) {
            return res.status(400).json({
                error: "Missing required parameters: id (query) and headers year, quarter, classname, section, subject."
            });
        }

        if (!name && (!ro_id || !Array.isArray(ro_id))) {
            return res.status(400).json({
                error: "Either 'name' or 'ro_id' array must be provided in request body."
            });
        }

        // Check LO exists
        const [existingLO] = await connection.query("SELECT * FROM learning_outcomes WHERE id = ?", [id]);
        if (existingLO.length === 0) {
            return res.status(404).json({ error: `Learning Outcome with id ${id} not found.` });
        }

        // Update LO name
        if (name) {
            await connection.query("UPDATE learning_outcomes SET name = ? WHERE id = ?", [name, id]);
        }

        // Prepare sets to track old and new RO IDs
        let oldROIds = [];
        if (ro_id && Array.isArray(ro_id)) {
            // Get old RO IDs mapped to this LO BEFORE deletion
            const [oldROMappingRows] = await connection.query(
                "SELECT DISTINCT ro FROM ro_lo_mapping WHERE lo = ?",
                [id]
            );
            oldROIds = oldROMappingRows.map(row => row.ro);

            // Validate new RO ids
            const [validROs] = await connection.query(
                `SELECT id FROM report_outcomes WHERE id IN (?)`,
                [ro_id]
            );
            const validROIds = validROs.map(r => r.id);

            for (const rid of ro_id) {
                if (!validROIds.includes(rid)) {
                    return res.status(400).json({ error: `Invalid RO id: ${rid}` });
                }
            }

            // Delete old mappings
            await connection.query("DELETE FROM ro_lo_mapping WHERE lo = ?", [id]);

            // Insert new mappings without priority and weight
            for (const rid of ro_id) {
                await connection.query(
                    `INSERT INTO ro_lo_mapping (ro, lo) VALUES (?, ?)`,
                    [rid, id]
                );
            }
        }

        // After update, check if old ROs have any LOs mapped
        for (const oldRoId of oldROIds) {
            const [countRows] = await connection.query(
                "SELECT COUNT(*) as cnt FROM ro_lo_mapping WHERE ro = ?",
                [oldRoId]
            );
            if (countRows[0].cnt === 0) {
                // No LOs mapped to this RO now — remove its score
                await connection.query(
                    "DELETE FROM ro_scores WHERE ro = ? AND quarter = ?",
                    [oldRoId, quarter]
                );
            }
        }

        // Collect all affected RO IDs (old + new + current mappings)
        const affectedROsSet = new Set();

        if (ro_id && Array.isArray(ro_id)) {
            ro_id.forEach(rid => affectedROsSet.add(rid));
        }

        const [currentROMappings] = await connection.query(
            "SELECT DISTINCT ro FROM ro_lo_mapping WHERE lo = ?",
            [id]
        );
        currentROMappings.forEach(row => affectedROsSet.add(row.ro));

        // Also add oldROIds because some may still be mapped
        oldROIds.forEach(rid => affectedROsSet.add(rid));

        const affectedROs = Array.from(affectedROsSet);
        let allWarnings = [];

        for (const roId of affectedROs) {
            const warnings = await recalculateROScore(connection, roId, classname, section, year, quarter);
            allWarnings = allWarnings.concat(warnings);
        }

        await connection.commit();
        res.status(200).json({
            message: "Learning Outcome updated and RO mappings saved (priority left empty). RO scores recalculated and obsolete RO scores removed.",
            warnings: allWarnings
        });

    } catch (error) {
        await connection.rollback();
        console.error("Error in updateLearningOutcome:", error);
        res.status(500).json({ error: "Internal Server Error", details: error.message });
    } finally {
        connection.release();
    }
};

const removeLearningOutcome = async (req, res) => {
    const { id } = req.query;
    const { classname, section, year, quarter } = req.headers;

    if (!id) {
        console.log("[DEBUG] Missing LO ID");
        return res.status(400).json({ message: "Missing LO ID." });
    }

    if (!classname || !section || !year || !quarter) {
        return res.status(400).json({ message: "Missing required headers: classname, section, year, or quarter." });
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        console.log(`[DEBUG] Starting LO removal process for LO ID: ${id}`);

        // Step 1: Get all ROs mapped to this LO
        const [roRows] = await connection.execute(
            "SELECT DISTINCT ro FROM ro_lo_mapping WHERE lo = ?",
            [id]
        );
        const roIds = roRows.map(row => row.ro);
        console.log(`[DEBUG] Affected RO IDs:`, roIds);

        // Step 2: Delete LO scores (not the RO scores yet)
        await connection.execute(
            "DELETE FROM lo_scores WHERE lo = ?",
            [id]
        );
        console.log(`[DEBUG] Deleted LO scores for LO ID ${id}`);

        // Step 3: Delete mapping and the LO
        await connection.execute(
            "DELETE FROM ro_lo_mapping WHERE lo = ?",
            [id]
        );
        console.log(`[DEBUG] Deleted ro_lo_mapping for LO ID ${id}`);

        const [result] = await connection.execute(
            "DELETE FROM learning_outcomes WHERE id = ?",
            [id]
        );
        if (result.affectedRows === 0) {
            console.log(`[DEBUG] LO ID ${id} not found.`);
            await connection.rollback();
            return res.status(404).json({ message: "Learning Outcome not found." });
        }
        console.log(`[DEBUG] Deleted LO entry.`);

        // Step 4: Recalculate RO scores AFTER LO + mapping is deleted
        let allWarnings = [];
        for (const ro_id of roIds) {
            console.log(`[DEBUG] Recalculating RO Score for RO ID: ${ro_id}`);
            const warnings = await recalculateROScore(connection, ro_id, classname, section, year, quarter); // ✅ Passed quarter
            if (warnings?.length > 0) {
                console.log(`[DEBUG] Warnings for RO ${ro_id}:`, warnings);
                allWarnings.push(...warnings);
            } else {
                console.log(`[DEBUG] RO ${ro_id} recalculated successfully.`);
            }
        }

        await connection.commit();
        console.log(`[DEBUG] Transaction committed successfully.`);

        return res.status(200).json({
            message: "Learning Outcome deleted and RO scores recalculated successfully.",
            ...(allWarnings.length > 0 && { warnings: allWarnings })
        });

    } catch (err) {
        await connection.rollback();
        console.error("[DEBUG] Error during LO deletion process:", err);
        return res.status(500).json({
            message: "Server error while deleting Learning Outcome.",
            error: err.message,
        });
    } finally {
        console.log(`[DEBUG] Releasing DB connection`);
        connection.release();
    }
};

export { getLearningOutcomes, addLearningOutcome, updateLearningOutcome, removeLearningOutcome};