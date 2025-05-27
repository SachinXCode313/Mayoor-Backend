import db from "../config/db.js";
import { recalculateAcScores } from "./assessmentCriteriasScores.js";
import { recalculateLOScore } from "./learningOutcomesMapping.js";
import { recalculateROScore } from "./reportOutcomesMapping.js";
// Get Assessment Criterias
const getAssessmentCriterias = async (req, res) => {
    const { subject, year, quarter, classname, section } = req.headers;

    if (!subject || !year || !quarter || !classname || !section) {
        return res.status(400).json({
            message: 'Invalid input. Subject, Class, Section, Year, and Quarter are required in the headers.',
        });
    }

    try {
        // Step 1: Get all students in the class & section
        const [students] = await db.execute(
            `SELECT student FROM students_records WHERE class = ? AND section = ? AND year = ?`,
            [classname, section, year]
        );
        const totalStudents = students.length;

        if (totalStudents === 0) {
            return res.status(404).json({ message: 'No students found for the given class and section.' });
        }

        // Step 2: Get ACs with their average scores
        const [acs] = await db.execute(
            `SELECT ac.id AS ac_id, ac.name AS ac_name, ac.max_marks,
                    COALESCE(AVG(ascore.value), NULL) AS average_score
             FROM assessment_criterias ac
             LEFT JOIN ac_scores ascore ON ac.id = ascore.ac
             WHERE ac.subject = ? AND ac.year = ? AND ac.quarter = ? AND ac.class = ?
             GROUP BY ac.id, ac.name, ac.max_marks`,
            [subject, year, quarter, classname]
        );

        if (acs.length === 0) {
            return res.status(404).json({ message: 'No assessment criteria found for the given filters.' });
        }

        // Step 3: Get count of students who have non-null scores per AC
        const acIds = acs.map(ac => ac.ac_id);
        const [scoredCounts] = await db.execute(
            `SELECT ac, COUNT(DISTINCT student) AS scored_count
             FROM ac_scores
             WHERE ac IN (${acIds.map(() => '?').join(', ')})
               AND student IN (${students.map(() => '?').join(', ')})
               AND value IS NOT NULL
             GROUP BY ac`,
            [...acIds, ...students.map(s => s.student)]
        );

        const scoredMap = {};
        scoredCounts.forEach(row => {
            scoredMap[row.ac] = row.scored_count;
        });

        // Step 4: Get AC-LO mappings
        const [loMappings] = await db.execute(
            `SELECT acl.ac, lo.id AS lo_id, lo.name AS lo_name
             FROM lo_ac_mapping acl
             JOIN learning_outcomes lo ON acl.lo = lo.id
             WHERE acl.ac IN (${acIds.map(() => '?').join(', ')})`,
            [...acIds]
        );

        const loMap = {};
        loMappings.forEach(row => {
            if (!loMap[row.ac]) loMap[row.ac] = [];
            loMap[row.ac].push({ lo_id: row.lo_id, lo_name: row.lo_name });
        });

        // Step 5: Construct response
        const final = acs.map(ac => ({
            ac_id: ac.ac_id,
            ac_name: ac.ac_name,
            max_marks: ac.max_marks,
            average_score: ac.average_score ? parseFloat(ac.average_score) : null,
            remaining_students: totalStudents - (scoredMap[ac.ac_id] || 0),
            mapped_los: loMap[ac.ac_id] || []
        }));

        return res.status(200).json(final);
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
    const { quarter } = req.headers;

    if (!id || !name || !max_marks || !lo_id || !Array.isArray(lo_id)) {
        return res.status(400).json({
            message: 'Missing or invalid required fields. Ensure id (params), name, max_marks, and lo_id (array in body) are provided.',
        });
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        const [currentAC] = await connection.execute(
            "SELECT max_marks, year, quarter AS db_quarter, class, section FROM assessment_criterias WHERE id = ?",
            [id]
        );

        if (currentAC.length === 0) {
            return res.status(404).json({ message: 'Assessment criterion not found.' });
        }

        const { max_marks: currentMaxMarks, year, db_quarter, class: classname, section } = currentAC[0];
        const effectiveQuarter = quarter || db_quarter;

        const [existingLOs] = await connection.execute(
            "SELECT lo FROM lo_ac_mapping WHERE ac = ?",
            [id]
        );

        const currentLOIds = existingLOs.map(row => row.lo);
        const newLOIds = lo_id.map(lo => parseInt(lo));

        const loMappingChanged =
            currentLOIds.length !== newLOIds.length ||
            !currentLOIds.every(lo => newLOIds.includes(lo));

        const updateQuery = `UPDATE assessment_criterias SET name = ?, max_marks = ? WHERE id = ?`;
        await connection.execute(updateQuery, [name, max_marks, id]);

        const [validLOs] = await connection.query(
            `SELECT id FROM learning_outcomes WHERE id IN (${lo_id.map(() => '?').join(',')}) 
             AND year = ? AND quarter = ? AND class = ?`,
            [...lo_id, year, effectiveQuarter, classname]
        );

        const validLOIds = validLOs.map(row => row.id);

        if (validLOIds.length !== lo_id.length) {
            return res.status(400).json({
                message: "One or more Learning Outcome IDs (lo_id) are invalid or do not belong to the correct year/class.",
            });
        }

        if (loMappingChanged) {
            await connection.execute(`DELETE FROM lo_ac_mapping WHERE ac = ?`, [id]);

            const insertMappingQuery = `INSERT INTO lo_ac_mapping (lo, ac, priority, weight) VALUES ?`;
            const loAcValues = validLOIds.map(lo => [lo, id, null, null]);

            if (loAcValues.length > 0) {
                await connection.query(insertMappingQuery, [loAcValues]);
            }

            for (const lo of validLOIds) {
                await recalculateLOScore(connection, lo);
            }

            const [affectedROs] = await connection.execute(
                `SELECT DISTINCT ro FROM ro_lo_mapping WHERE lo IN (?)`,
                [validLOIds]
            );

            for (const ro of affectedROs.map(r => r.ro)) {
                await recalculateROScore(connection, ro, classname, section, year, effectiveQuarter);
            }
        }

        const maxMarksChanged = parseFloat(currentMaxMarks) !== parseFloat(max_marks);
        if (maxMarksChanged) {
            await recalculateAcScores(id, year, effectiveQuarter, classname, section);
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
    const { classname, section, year, quarter } = req.headers;

    if (!id) {
        return res.status(400).json({ message: "Missing assessment criterion ID." });
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        const [affectedLOs] = await connection.execute(
            "SELECT lo FROM lo_ac_mapping WHERE ac = ?",
            [id]
        );
        const loIds = affectedLOs.map(row => row.lo);
        let loRecalculateList = new Set(loIds);

        // 🔴 Step 1: Delete the AC first so it's not included in recalculation
        await connection.execute("DELETE FROM assessment_criterias WHERE id = ?", [id]);

        // Also remove the mapping
        await connection.execute("DELETE FROM lo_ac_mapping WHERE ac = ?", [id]);

        // For each LO that had this AC, update LO scores
        for (const lo of loRecalculateList) {
            // If only one mapping existed (the one we just deleted), set LO score to 0
            const [remainingACs] = await connection.execute(
                "SELECT COUNT(*) AS count FROM lo_ac_mapping WHERE lo = ?",
                [lo]
            );

            if (remainingACs[0].count === 0) {
                // No more ACs mapped, reset all LO scores for this LO to 0
                await connection.execute(
                    "UPDATE lo_scores SET value = 0 WHERE lo = ?",
                    [lo]
                );
                continue;
            }

            // 🔁 Get all students who had AC scores for this LO through mapped ACs
            const [mappedACs] = await connection.execute(
                "SELECT ac FROM lo_ac_mapping WHERE lo = ?",
                [lo]
            );
            const acIds = mappedACs.map(row => row.ac);
            const placeholders = acIds.map(() => '?').join(',');

            const [students] = await connection.execute(
                `SELECT DISTINCT student as student_id FROM ac_scores WHERE ac IN (${placeholders})`,
                acIds
            );

            await recalculateLOScore(connection, lo, students);
        }

        // RO recalculation
        const placeholders = Array.from(loRecalculateList).map(() => '?').join(',');
        const [affectedROs] = await connection.execute(
            `SELECT DISTINCT ro FROM ro_lo_mapping WHERE lo IN (${placeholders})`,
            [...loRecalculateList]
        );

        const roIds = new Set(affectedROs.map(row => row.ro));
        for (const ro of roIds) {
            await recalculateROScore(connection, ro, classname, section, year, quarter);
        }

        await connection.commit();
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