import db from "../config/db.js";

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
        // Fetch Assessment Criterias
        const acQuery = `
            SELECT id AS ac_id, name AS ac_name, max_marks
            FROM assessment_criterias
            WHERE subject = ? AND year = ? AND quarter = ? AND class = ?
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
            learning_outcomes: learningOutcomes
                .filter(lo => lo.ac === ac.ac_id)
                .map(lo => ({
                    lo_id: lo.lo_id,
                    lo_name: lo.lo_name
                }))
        }));

        return res.status(200).json({
            message: 'Assessment criteria retrieved successfully',
            assessments: acWithLO,
        });
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
    const { name, max_marks, lo_id } = req.body;
    if (!id || !name || !max_marks || !lo_id || !Array.isArray(lo_id)) {
        return res.status(400).json({
            message: 'Missing or invalid required fields. Ensure id (params), name, max_marks, and lo_id (array in body) are provided.',
        });
    }
    const connection = await db.getConnection();
    try {
        const updateQuery = `UPDATE assessment_criterias SET name = ?, max_marks = ? WHERE id = ?`;
        const [result] = await connection.execute(updateQuery, [name, max_marks, id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Assessment criterion not found or no changes made.' });
        }
        const deleteMappingQuery = `DELETE FROM lo_ac_mapping WHERE ac = ?`;
        await connection.execute(deleteMappingQuery, [id]);
        const insertMappingQuery = `INSERT INTO lo_ac_mapping (lo, ac, priority, weight) VALUES (?, ?, NULL, NULL)`;
        for (const lo of lo_id) {
            await connection.execute(insertMappingQuery, [lo, id]);
        }
        for (const lo of lo_id) {
            await recalculateLOWeightAndScore(connection, lo);
        }
        const [affectedROs] = await connection.execute(
            `SELECT DISTINCT ro FROM ro_lo_mapping WHERE lo IN (?)`,
            [lo_id]
        );
        for (const ro of affectedROs.map(r => r.ro)) {
            await recalculateROWeightAndScore(connection, ro);
        }
        await connection.commit();
        return res.status(200).json({
            message: 'Assessment criterion updated successfully with recalculated LO and RO weights & scores.',
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

const priorityValues = {
    h: 0.5,
    m: 0.3,
    l: 0.2,
};

// Function
const recalculateLOWeightAndScore = async (connection, loId) => {
    // Fetch all ACs mapped to this LO
    const [acs] = await connection.execute(
        `SELECT ac, priority FROM lo_ac_mapping WHERE lo = ?`,
        [loId]
    );
    if (acs.length === 0) return;
    let totalDenominator = 0;
    for (const ac of acs) {
        totalDenominator += priorityValues[ac.priority] || 0;
    }
    if (totalDenominator === 0) return;
    let totalScore = 0;
    for (const ac of acs) {
        const [acDetails] = await connection.execute(
            `SELECT max_marks FROM assessment_criterias WHERE id = ?`,
            [ac.ac]
        );
        if (acDetails.length > 0) {
            let weight = (priorityValues[ac.priority] || 0) / totalDenominator;
            totalScore += acDetails[0].max_marks * weight;
            // Update weight in mapping
            await connection.execute(
                `UPDATE lo_ac_mapping SET weight = ? WHERE lo = ? AND ac = ?`,
                [weight, loId, ac.ac]
            );
        }
    }
    // Update LO score
    await connection.execute(
        `UPDATE learning_outcomes SET score = ? WHERE id = ?`,
        [totalScore, loId]
    );
};
const recalculateROWeightAndScore = async (connection, roId) => {
    const [los] = await connection.execute(
        `SELECT lo, priority FROM ro_lo_mapping WHERE ro = ?`,
        [roId]
    );
    if (los.length === 0) return;
    let totalDenominator = 0;
    for (const lo of los) {
        totalDenominator += priorityValues[lo.priority] || 0;
    }
    if (totalDenominator === 0) return;
    let totalScore = 0;
    for (const lo of los) {
        const [loDetails] = await connection.execute(
            `SELECT score FROM learning_outcomes WHERE id = ?`,
            [lo.lo]
        );
        if (loDetails.length > 0) {
            let weight = (priorityValues[lo.priority] || 0) / totalDenominator;
            totalScore += loDetails[0].score * weight;
            // Update weight in mapping
            await connection.execute(
                `UPDATE ro_lo_mapping SET weight = ? WHERE ro = ? AND lo = ?`,
                [weight, roId, lo.lo]
            );
        }
    }
    // Update RO score
    await connection.execute(
        `UPDATE report_outcomes SET score = ? WHERE id = ?`,
        [totalScore, roId]
    );
};// Remove Assessment Criteria
const removeAssessmentCriteria = async (req, res) => {
    const { id } = req.query; // Get ID from request params

    if (!id) {
        return res.status(400).json({
            message: 'Missing assessment criterion ID in the request.',
        });
    }

    try {
        const deleteQuery = `
            DELETE FROM assessment_criterias WHERE id = ?
        `;

        const [result] = await db.execute(deleteQuery, [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                message: 'Assessment criterion not found.',
            });
        }

        return res.status(200).json({
            message: 'Assessment criterion deleted successfully',
        });
    } catch (err) {
        console.error('Error deleting assessment criteria:', err);
        return res.status(500).json({
            message: 'Server error while deleting assessment criteria',
            error: err.message,
        });
    }
};

export { 
    getAssessmentCriterias, 
    addAssessmentCriteria, 
    updateAssessmentCriteria, 
    removeAssessmentCriteria 
};