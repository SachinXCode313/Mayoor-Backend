
import db from "../config/db.js";
//get learning outcome
const getLearningOutcomes = async (req, res) => {
    const { subject, year, quarter, classname } = req.headers;
    console.log(`Subject: ${subject}, Year: ${year}, Quarter: ${quarter}, Class: ${classname}`);
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


const priorityValues = { h: 0.5, m: 0.3, l: 0.2 };

const updateLearningOutcome = async (req, res) => {
    const { lo_id } = req.query;
    const { loname, ro_ids } = req.body;
    console.log(req.body)
    if (!lo_id || !loname || !ro_ids || !Array.isArray(ro_ids) || !ro_ids.every(id => Number.isInteger(Number(id)))) {
        return res.status(400).json({ error: "Missing or invalid parameters." });
    }
    

    const connection = await db.getConnection();
    await connection.beginTransaction();
    
    try {
        // 1. Update LO name
        await connection.query("UPDATE learning_outcomes SET name = ? WHERE id = ?", [loname, lo_id]);
        
        // 2. Get existing RO-LO mappings
        const [existingMappings] = await connection.query("SELECT ro FROM ro_lo_mapping WHERE lo = ?", [lo_id]);
        const existingRoIds = existingMappings.map(row => row.ro_id);
        
        // Find removed RO mappings (to recalculate scores)
        const removedRoIds = existingRoIds.filter(id => !ro_ids.includes(id));
        
        // 3. Remove existing RO-LO mappings
        await connection.query("DELETE FROM ro_lo_mapping WHERE lo = ?", [lo_id]);
        
        // 4. Insert new RO-LO mappings
        const roLoMappingData = [];
        for (const ro_id of ro_ids) {
            roLoMappingData.push([ro_id, lo_id]);
        }
        if (roLoMappingData.length > 0) {
            await connection.query("INSERT INTO ro_lo_mapping (ro, lo) VALUES ?", [roLoMappingData]);
        }
        
        // 5. Recalculate weights for RO-LO mappings
        const [roLoMappings] = await connection.query("SELECT ro, priority FROM ro_lo_mapping WHERE lo = ?", [lo_id]);
        
        if (roLoMappings.length > 0) {
            let totalDenominator = 0;
            roLoMappings.forEach(item => {
                totalDenominator += priorityValues[item.priority] || 0;
            });
            
            if (totalDenominator > 0) {
                for (const item of roLoMappings) {
                    const weight = priorityValues[item.priority] / totalDenominator;
                    await connection.query(
                        "UPDATE ro_lo_mapping SET weight = ? WHERE lo = ? AND ro = ?",
                        [weight, lo_id, item.ro_id]
                    );
                }
            }
        }
        
        // 6. Recalculate RO scores for removed mappings
        if (removedRoIds.length > 0) {
            for (const ro_id of removedRoIds) {
                await connection.query(`
                    UPDATE ro_scores rs
                    LEFT JOIN (
                        SELECT rlm.ro, SUM(ls.value * rlm.weight) AS new_score 
                        FROM lo_scores ls 
                        JOIN ro_lo_mapping rlm ON ls.lo = rlm.lo 
                        WHERE rlm.ro = ? 
                        GROUP BY rlm.ro
                    ) AS subquery 
                    ON rs.ro = subquery.ro
                    SET rs.value = COALESCE(subquery.new_score, 0)
                    WHERE rs.ro = ?;
                `, [ro_id, ro_id]);
            }
        }
        
        // 7. Ensure valid LO recalculations (skip if no AC scores or null priority)
        const [validLoAcMappings] = await connection.query("SELECT lam.lo, acs.value, lam.priority FROM lo_ac_mapping lam JOIN ac_scores acs ON lam.ac = acs.ac WHERE lam.lo = ?", [lo_id]);
        
        if (validLoAcMappings.length === 0 || validLoAcMappings.some(item => item.priority === null)) {
            await connection.commit();
            return res.status(200).json({ message: "LO scores not recalculated due to missing AC scores or null priority." });
        }
        
        // 8. Recalculate LO scores using AC scores
        await connection.query(`
            UPDATE lo_scores ls
            JOIN (
                SELECT lam.lo, SUM(lam.weight * acs.value) AS new_score 
                FROM ac_scores acs
                JOIN lo_ac_mapping lam ON acs.ac = lam.ac
                WHERE lam.lo = ?
                GROUP BY lam.lo
            ) AS subquery 
            ON ls.lo = subquery.lo
            SET ls.value = subquery.new_score;
        `, [lo_id]);

        await connection.commit();
        res.status(200).json({ message: "Learning Outcome updated successfully." });
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ error: error.message });
    } finally {
        connection.release();
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