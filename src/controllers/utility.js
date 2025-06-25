const priorityValues = {
    h: 0.5,
    m: 0.3,
    l: 0.2,
};

// **Function to recalculate LO weight and score**
const recalculateLOWeightAndScore = async (connection, loId) => {
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
            `SELECT SUM(value) AS ac_score FROM ac_scores WHERE ac = ?`,
            [ac.ac]
        );
        if (acDetails.length > 0 && acDetails[0].ac_score !== null) {
            let weight = (priorityValues[ac.priority] || 0) / totalDenominator;
            totalScore += acDetails[0].ac_score * weight;
            await connection.execute(
                `UPDATE lo_ac_mapping SET weight = ? WHERE lo = ? AND ac = ?`,
                [weight, loId, ac.ac]
            );
        }
    }
    await connection.execute(
        `UPDATE learning_outcomes SET score = ? WHERE id = ?`,
        [totalScore, loId]
    );
};

// **Function to recalculate RO weight and score**
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
        if (loDetails.length > 0 && loDetails[0].score !== null) {
            let weight = (priorityValues[lo.priority] || 0) / totalDenominator;
            totalScore += loDetails[0].score * weight;
            await connection.execute(
                `UPDATE ro_lo_mapping SET weight = ? WHERE ro = ? AND lo = ?`,
                [weight, roId, lo.lo]
            );
        }
    }
    await connection.execute(
        `UPDATE report_outcomes SET score = ? WHERE id = ?`,
        [totalScore, roId]
    );
};

// **Redistribute LO Weights (if no priority exists)**
const redistributeLOWeights = async (connection, loId) => {
    const [acs] = await connection.execute(
        `SELECT ac FROM lo_ac_mapping WHERE lo = ?`,
        [loId]
    );

    if (acs.length === 0) return;

    const weight = 1 / acs.length; // Equal distribution
    for (const ac of acs) {
        await connection.execute(
            `UPDATE lo_ac_mapping SET weight = ? WHERE lo = ? AND ac = ?`,
            [weight, loId, ac.ac]
        );
    }
};

// **Redistribute RO Weights (if no priority exists)**
const redistributeROWeights = async (connection, roId) => {
    const [los] = await connection.execute(
        `SELECT lo FROM ro_lo_mapping WHERE ro = ?`,
        [roId]
    );

    if (los.length === 0) return;

    const weight = 1 / los.length; // Equal distribution
    for (const lo of los) {
        await connection.execute(
            `UPDATE ro_lo_mapping SET weight = ? WHERE ro = ? AND lo = ?`,
            [weight, roId, lo.lo]
        );
    }
};

export {recalculateLOWeightAndScore,recalculateROWeightAndScore,redistributeLOWeights,redistributeROWeights}