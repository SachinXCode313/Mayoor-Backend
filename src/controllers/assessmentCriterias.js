import db from "../config/db.js";
import { recalculateAcScores } from "./assessmentCriteriasScores.js";
import { recalculateLOScore } from "./learningOutcomesMapping.js";
import { recalculateROScore } from "./reportOutcomesMapping.js";
// Get Assessment Criterias
const getAssessmentCriterias = async (req, res) => {
    const { subject, year, quarter, classname } = req.headers;

    console.log(`Subject: ${subject}, Year: ${year}, Quarter: ${quarter}, Class: ${classname}`);

    // Validate required headers
    if (!subject || !year || !quarter || !classname) {
        return res.status(400).json({
            message: 'Invalid input. Subject, Class, Year, and Quarter are required in the headers.',
        });
    }

    try {
        // Fetch Assessment Criterias with Average Score
        const acQuery = `
            SELECT ac.id AS ac_id, ac.name AS ac_name, ac.max_marks,
                   COALESCE(AVG(ascore.value), NULL) AS average_score  -- NULL if no scores
            FROM assessment_criterias ac
            LEFT JOIN ac_scores ascore ON ac.id = ascore.ac
            WHERE ac.subject = ? AND ac.year = ? AND ac.quarter = ? AND ac.class = ?
            GROUP BY ac.id, ac.name, ac.max_marks
        `;
        const [assessmentCriterias] = await db.execute(acQuery, [subject, year, quarter, classname]);

        if (assessmentCriterias.length === 0) {
            return res.status(404).json({
                message: 'No assessment criteria found for the given filters.',
            });
        }

        // Get AC IDs
        const acIds = assessmentCriterias.map(ac => ac.ac_id);
        if (acIds.length === 0) {
            return res.status(200).json(assessmentCriterias); // No ACs, return empty response
        }

        // Fetch LOs mapped to ACs
        const loQuery = `
            SELECT lam.ac, lo.id AS lo_id, lo.name AS lo_name
            FROM learning_outcomes lo
            JOIN lo_ac_mapping lam ON lo.id = lam.lo
            WHERE lam.ac IN (${acIds.map(() => "?").join(", ")})
        `;
        const [learningOutcomes] = await db.execute(loQuery, acIds);

        // Map LOs to corresponding ACs
        const acWithLO = assessmentCriterias.map(ac => ({
            ...ac,
            average_score: ac.average_score ? parseFloat(ac.average_score) : 0, // Convert to float, handle null
            learning_outcomes: learningOutcomes
                .filter(lo => lo.ac === ac.ac_id)
                .map(lo => ({
                    lo_id: lo.lo_id,
                    lo_name: lo.lo_name
                }))
        }));

        return res.status(200).json(acWithLO);
    } catch (err) {
        console.error('Error retrieving assessment criteria:', err);

        return res.status(500).json({
            message: 'Server error while fetching assessment criteria',
            error: err.message,
        });
    }
};



// Add Assessment Criteria
const addAssessmentCriteria = async (req, res) => {
    const { year, quarter, subject, classname } = req.headers;
    const { max_marks, name, lo_id } = req.body;

    // Validate required fields
    if (!year || !quarter || !subject || !classname || !max_marks || !name || !lo_id || !Array.isArray(lo_id)) {
        return res.status(400).json({
            message: 'Missing or invalid required fields. Ensure year, quarter, class, subject (headers), and max_marks, name, lo_id (array in body) are provided.',
        });
    }
    try {
        // Insert new assessment criteria
        const insertQuery = `
            INSERT INTO assessment_criterias (name, max_marks, year, quarter, subject, class)
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        const [result] = await db.execute(insertQuery, [
            name,
            max_marks,
            year,
            quarter,
            subject,
            classname
        ]);

        const acId = result.insertId; // Get the newly inserted AC ID

        // Insert LO-AC mappings
        const mappingQuery = `
            INSERT INTO lo_ac_mapping (lo, ac, priority, weight)
            VALUES (?, ?, NULL, NULL)
        `;

        for (const lo of lo_id) {
            await db.execute(mappingQuery, [lo, acId]); // Insert each mapping
        }

        return res.status(201).json({
            message: 'Assessment criterion added successfully with LO mappings',
            insertedId: acId,
        });
    } catch (err) {
        console.error('Error inserting assessment criteria:', err);

        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                message: 'Duplicate entry. This assessment criterion already exists.',
            });
        }

        return res.status(500).json({
            message: 'Server error while inserting assessment criteria',
            error: err.message,
        });
    }
};


const updateAssessmentCriteria = async (req, res) => {
    const { id } = req.query; // AC ID
    const { name, max_marks, lo_id } = req.body; // lo_id is an array

    if (!id || !name || !max_marks || !lo_id || !Array.isArray(lo_id)) {
        return res.status(400).json({
            message: 'Missing or invalid required fields. Ensure id (params), name, max_marks, and lo_id (array in body) are provided.',
        });
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        // **1. Fetch current assessment criteria details**
        const [currentAC] = await connection.execute(
            "SELECT max_marks, year, quarter, class FROM assessment_criterias WHERE id = ?",
            [id]
        );

        if (currentAC.length === 0) {
            return res.status(404).json({ message: 'Assessment criterion not found.' });
        }

        const { max_marks: currentMaxMarks, year, quarter, class: classname, section } = currentAC[0];

        // **2. Fetch current LO mappings**
        const [existingLOs] = await connection.execute(
            "SELECT lo FROM lo_ac_mapping WHERE ac = ?",
            [id]
        );

        const currentLOIds = existingLOs.map(row => row.lo);
        const newLOIds = lo_id.map(lo => parseInt(lo));

        const loMappingChanged = 
            currentLOIds.length !== newLOIds.length ||
            !currentLOIds.every(lo => newLOIds.includes(lo));

        // **3. Update assessment criteria**
        const updateQuery = `UPDATE assessment_criterias SET name = ?, max_marks = ? WHERE id = ?`;
        await connection.execute(updateQuery, [name, max_marks, id]);

        // **4. Validate that all LO IDs exist in the learning_outcomes table**
        const [validLOs] = await connection.query(
            `SELECT id FROM learning_outcomes WHERE id IN (${lo_id.map(() => '?').join(',')}) 
             AND year = ? AND quarter = ? AND class = ?`,
            [...lo_id, year, quarter, classname]
        );
        
        const validLOIds = validLOs.map(row => row.id);

        // **5. Check if all provided lo_id exist**
        if (validLOIds.length !== lo_id.length) {
            return res.status(400).json({
                message: "One or more Learning Outcome IDs (lo_id) are invalid or do not belong to the correct year/class.",
            });
        }

        // **6. Delete & Insert LO-AC Mapping (if changed)**
        if (loMappingChanged) {
            await connection.execute(`DELETE FROM lo_ac_mapping WHERE ac = ?`, [id]);

            const insertMappingQuery = `INSERT INTO lo_ac_mapping (lo, ac, priority, weight) VALUES ?`;
            const loAcValues = validLOIds.map(lo => [lo, id, null, null]);

            if (loAcValues.length > 0) {
                await connection.query(insertMappingQuery, [loAcValues]);
            }

            // **7. Recalculate LO Scores**
            for (const lo of validLOIds) {
                await recalculateLOScore(connection, lo);
            }

            // **8. Recalculate RO Scores for affected ROs**
            const [affectedROs] = await connection.execute(
                `SELECT DISTINCT ro FROM ro_lo_mapping WHERE lo IN (?)`,
                [validLOIds]
            );
            for (const ro of affectedROs.map(r => r.ro)) {
                await recalculateROScore(connection, ro);
            }
        }

        // **9. Recalculate AC Scores if max_marks changed**
        const maxMarksChanged = parseFloat(currentMaxMarks) !== parseFloat(max_marks);
        if (maxMarksChanged) {
            await recalculateAcScores(id, year, quarter, classname, section);
        }

        await connection.commit();

        return res.status(200).json({
            message: `Assessment criterion updated successfully. 
                      LO mapping ${loMappingChanged ? 'changed and scores recalculated.' : 'remained the same.'}
                      ${maxMarksChanged ? 'AC scores recalculated.' : ''}`
        });

    } catch (err) {
        await connection.rollback();
        console.error('Error updating assessment criteria:', err);
        return res.status(500).json({
            message: 'Server error while updating assessment criteria',
            error: err.message,
        });
    } finally {
        connection.release();
    }
};


const removeAssessmentCriteria = async (req, res) => {
    const { id } = req.query;

    if (!id) {
        return res.status(400).json({ message: "Missing assessment criterion ID." });
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        // Step 1: Check for affected LOs
        const [affectedLOs] = await connection.execute(
            "SELECT lo FROM lo_ac_mapping WHERE ac = ?",
            [id]
        );
        const loIds = affectedLOs.map(row => row.lo);
        let loRecalculateList = new Set();

        // Step 2: If LOs exist, process LO + RO recalculations
        if (loIds.length > 0) {
            for (const lo of loIds) {
                const [remainingACs] = await connection.execute(
                    "SELECT COUNT(*) AS count FROM lo_ac_mapping WHERE lo = ?",
                    [lo]
                );

                if (remainingACs[0].count === 1) {
                    await connection.execute(
                        "UPDATE lo_scores SET value = 0 WHERE lo = ?",
                        [lo]
                    );
                }

                loRecalculateList.add(lo);
            }

            // Recalculate LO scores
            for (const lo of loRecalculateList) {
                await recalculateLOScore(connection, lo);
            }

            // Check affected ROs
            const placeholders = Array.from(loRecalculateList).map(() => '?').join(',');
            const [affectedROs] = await connection.execute(
                `SELECT DISTINCT ro FROM ro_lo_mapping WHERE lo IN (${placeholders})`,
                [...loRecalculateList]
            );

            const roIds = new Set(affectedROs.map(row => row.ro));

            // Recalculate RO scores
            for (const ro of roIds) {
                await recalculateROScore(connection, ro);
                const [updatedRO] = await connection.execute(
                    "SELECT value FROM ro_scores WHERE ro = ?",
                    [ro]
                );

                if (updatedRO.length > 0) {
                    console.log(`RO ${ro} recalculated. New score: ${updatedRO[0].value}`);
                } else {
                    console.log(`RO ${ro} recalculation failed. No update found.`);
                }
            }
        }

        // Step 3: Delete the AC
        const [result] = await connection.execute(
            "DELETE FROM assessment_criterias WHERE id = ?",
            [id]
        );

        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ message: "Assessment criterion not found." });
        }

        await connection.commit();

        if (loIds.length === 0) {
            return res.status(200).json({
                message: "Assessment criterion deleted. No linked LOs found for recalculation.",
            });
        }

        return res.status(200).json({
            message: "Assessment criterion deleted. LO and RO scores updated accordingly.",
        });

    } catch (err) {
        await connection.rollback();
        console.error("Error deleting AC:", err);
        return res.status(500).json({
            message: "Server error while deleting assessment criteria",
            error: err.message,
        });
    } finally {
        connection.release();
    }
};

export { 
    getAssessmentCriterias, 
    addAssessmentCriteria, 
    updateAssessmentCriteria, 
    removeAssessmentCriteria 
};