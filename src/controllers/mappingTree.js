import db from "../config/db.js";

const getMappingTree = async (req, res) => {
    try {
        const { subject,year } = req.headers;
        if (!subject) {
            return res.status(400).json({ error: "subject is required" });
        }
        const query = `
        SELECT
            ro.id AS ro_id, ro.name AS ro_name,
            lo.id AS lo_id, lo.name AS lo_name,
            ac.id AS ac_id, ac.name AS ac_name
        FROM report_outcomes ro
        LEFT JOIN ro_lo_mapping rlm ON ro.id = rlm.ro
        LEFT JOIN learning_outcomes lo ON rlm.lo = lo.id
        LEFT JOIN lo_ac_mapping lam ON lo.id = lam.lo
        LEFT JOIN assessment_criterias ac ON lam.ac = ac.id
        WHERE ro.subject = ? AND ro.year = ?
        ORDER BY ro.id, lo.id, ac.id;
      `;
        const [rows] = await db.query(query, [subject,year]);
        // Transform flat data into a hierarchical JSON response
        const roMap = new Map();
        rows.forEach(({ ro_id, ro_name, lo_id, lo_name, ac_id, ac_name }) => {
            if (!roMap.has(ro_id)) {
                roMap.set(ro_id, { ro_id, ro_name, learning_outcomes: [] });
            }
            const roEntry = roMap.get(ro_id); // If LO is null, skip adding it
            if (lo_id) {
                let loEntry = roEntry.learning_outcomes.find(lo => lo.lo_id === lo_id);
                if (!loEntry) {
                    loEntry = { lo_id, lo_name, assessment_criteria: [] };
                    roEntry.learning_outcomes.push(loEntry);
                } // If AC is not null, add it to the corresponding LO
                if (ac_id) { loEntry.assessment_criteria.push({ ac_id, ac_name }); }
            }
        });
        res.json(Array.from(roMap.values()));
    } catch (error) {
        console.error("Error fetching report outcomes:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

export default getMappingTree