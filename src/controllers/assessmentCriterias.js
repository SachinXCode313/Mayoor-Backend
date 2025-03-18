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
    const { name, max_marks, lo_id } = req.body;

    if (!id || !name || !max_marks || !lo_id || !Array.isArray(lo_id)) {
        return res.status(400).json({
            message: 'Missing or invalid required fields. Ensure id (params), name, max_marks, and lo_id (array in body) are provided.',
        });
    }

    const connection = await db.getConnection();
    try {
        // Fetch existing assessment criteria to check what changed
        const [existingAC] = await connection.execute(
            `SELECT name, max_marks FROM assessment_criterias WHERE id = ?`,
            [id]
        );
        if (existingAC.length === 0) {
            return res.status(404).json({ message: 'Assessment criterion not found.' });
        }

        const oldMaxMarks = existingAC[0].max_marks;
        const oldName = existingAC[0].name;

        // Fetch existing lo_id mappings
        const [existingLOs] = await connection.execute(
            `SELECT lo FROM lo_ac_mapping WHERE ac = ?`,
            [id]
        );
        const oldLOs = existingLOs.map(row => row.lo);
        
        // Check if max_marks or lo_id has changed
        const isMaxMarksChanged = oldMaxMarks !== max_marks;
        const isLOsChanged = JSON.stringify(oldLOs.sort()) !== JSON.stringify(lo_id.sort());

        // Update name & max_marks (Always update name, even if recalculation is not needed)
        const updateQuery = `UPDATE assessment_criterias SET name = ?, max_marks = ? WHERE id = ?`;
        const [result] = await connection.execute(updateQuery, [name, max_marks, id]);

        if (result.affectedRows === 0 && !isLOsChanged && !isMaxMarksChanged) {
            return res.status(200).json({ message: 'No changes detected.' });
        }

        // Only update lo_ac_mapping if LO mappings have changed
        if (isLOsChanged) {
            const deleteMappingQuery = `DELETE FROM lo_ac_mapping WHERE ac = ?`;
            await connection.execute(deleteMappingQuery, [id]);

            const insertMappingQuery = `INSERT INTO lo_ac_mapping (lo, ac, priority, weight) VALUES (?, ?, NULL, NULL)`;
            for (const lo of lo_id) {
                await connection.execute(insertMappingQuery, [lo, id]);
            }
        }

        // Trigger recalculations only if max_marks or lo_id has changed
        if (isMaxMarksChanged || isLOsChanged) {
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
        }

        await connection.commit();
        return res.status(200).json({
            message: 'Assessment criterion updated successfully' + 
                     (isMaxMarksChanged || isLOsChanged ? ' with recalculated LO and RO weights & scores.' : '.'),
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

async function recalculateLOWeightAndScore(connection, loId) {
    try {
        // Fetch ACs related to this LO
        const [acs] = await connection.execute(`
            SELECT ac.id, lo_ac.priority, ac.max_marks
            FROM lo_ac_mapping lo_ac
            JOIN assessment_criterias ac ON lo_ac.ac = ac.id
            WHERE lo_ac.lo = ?`, [loId]);

        let denominator = 0;
        acs.forEach(ac => {
            if (ac.priority === 'h') denominator += 0.5;
            if (ac.priority === 'm') denominator += 0.3;
            if (ac.priority === 'l') denominator += 0.2;
        });

        if (denominator === 0) return;

        // Update LO weights
        for (const ac of acs) {
            let weight = 0;
            if (ac.priority === 'h') weight = 0.5 / denominator;
            if (ac.priority === 'm') weight = 0.3 / denominator;
            if (ac.priority === 'l') weight = 0.2 / denominator;

            await connection.execute(`
                UPDATE lo_ac_mapping SET weight = ? WHERE lo = ? AND ac = ?`, 
                [weight, loId, ac.id]);
        }

        // Fetch students who have scores for these ACs
        const [students] = await connection.execute(`
            SELECT DISTINCT student FROM assessment_scores WHERE ac IN (?)`, 
            [acs.map(ac => ac.id)]);

        // Calculate and update LO scores for each student
        for (const student of students) {
            let loScore = 0;

            for (const ac of acs) {
                const [scoreResult] = await connection.execute(`
                    SELECT value FROM assessment_scores WHERE student = ? AND ac = ?`, 
                    [student.student, ac.id]);

                if (scoreResult.length > 0) {
                    loScore += scoreResult[0].value * (ac.priority === 'h' ? 0.5 / denominator :
                                                       ac.priority === 'm' ? 0.3 / denominator :
                                                       ac.priority === 'l' ? 0.2 / denominator : 0);
                }
            }

            // Insert or update LO score
            await connection.execute(`
                INSERT INTO lo_scores (student, lo, value) VALUES (?, ?, ?) 
                ON DUPLICATE KEY UPDATE value = ?`, 
                [student.student, loId, loScore, loScore]);
        }
    } catch (error) {
        console.error("Error recalculating LO weight & score:", error);
        throw error;
    }
}


async function recalculateROWeightAndScore(connection, roId) {
    try {
        // Fetch LOs related to this RO
        const [los] = await connection.execute(`
            SELECT lo.id, ro_lo.priority FROM ro_lo_mapping ro_lo
            JOIN learning_outcomes lo ON ro_lo.lo = lo.id
            WHERE ro_lo.ro = ?`, [roId]);

        let denominator = 0;
        los.forEach(lo => {
            if (lo.priority === 'h') denominator += 0.5;
            if (lo.priority === 'm') denominator += 0.3;
            if (lo.priority === 'l') denominator += 0.2;
        });

        if (denominator === 0) return;

        // Update RO weights
        for (const lo of los) {
            let weight = 0;
            if (lo.priority === 'h') weight = 0.5 / denominator;
            if (lo.priority === 'm') weight = 0.3 / denominator;
            if (lo.priority === 'l') weight = 0.2 / denominator;

            await connection.execute(`
                UPDATE ro_lo_mapping SET weight = ? WHERE ro = ? AND lo = ?`, 
                [weight, roId, lo.id]);
        }

        // Fetch students who have scores for these LOs
        const [students] = await connection.execute(`
            SELECT DISTINCT student FROM lo_scores WHERE lo IN (?)`, 
            [los.map(lo => lo.id)]);

        // Calculate and update RO scores for each student
        for (const student of students) {
            let roScore = 0;

            for (const lo of los) {
                const [scoreResult] = await connection.execute(`
                    SELECT value FROM lo_scores WHERE student = ? AND lo = ?`, 
                    [student.student, lo.id]);

                if (scoreResult.length > 0) {
                    roScore += scoreResult[0].value * (lo.priority === 'h' ? 0.5 / denominator :
                                                       lo.priority === 'm' ? 0.3 / denominator :
                                                       lo.priority === 'l' ? 0.2 / denominator : 0);
                }
            }

            // Insert or update RO score
            await connection.execute(`
                INSERT INTO ro_scores (student, ro, value) VALUES (?, ?, ?) 
                ON DUPLICATE KEY UPDATE value = ?`, 
                [student.student, roId, roScore, roScore]);
        }
    } catch (error) {
        console.error("Error recalculating RO weight & score:", error);
        throw error;
    }
}

const removeAssessmentCriteria = async (req, res) => {
    const { id } = req.query; // Get ID from request params
    console.log("ID : ",id);
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