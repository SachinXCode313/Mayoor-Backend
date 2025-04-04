import db from "../config/db.js";
import fs from 'fs';
import fastCsv from 'fast-csv';

const generateCsv = async (query, params, filename, categoryPrefix) => {
    if (params.some(p => p === undefined)) {
        throw new Error('Bind parameters must not contain undefined. To pass SQL NULL specify JS null');
    }

    const [rows] = await db.execute(query, params);

    // Pivot the data
    const studentMap = {};
    rows.forEach(({ roll_no, student_name, category, score }) => {
        if (!studentMap[roll_no]) {
            studentMap[roll_no] = { "Student Roll No.": roll_no, "Student Name": student_name };
        }
        studentMap[roll_no][`${categoryPrefix} ${category}`] = score;
    });

    const pivotedRows = Object.values(studentMap);

    // Extract unique IDs for dynamic headers
    const uniqueCategories = [...new Set(rows.map(row => `${categoryPrefix} ${row.category}`))];
    const headers = ["Student Roll No.", "Student Name", ...uniqueCategories];

    return new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(filename);
        const csvStream = fastCsv.write(pivotedRows, { headers: headers });
        csvStream.pipe(ws).on('finish', resolve).on('error', reject);
    });
};

const getACReport = async (req, res) => {
    const { year, quarter, classname, section, subject } = req.headers;

    if (!year || !quarter || !classname || !section || !subject) {
        return res.status(400).json({ error: 'Missing required query parameters' });
    }

    const query = `SELECT sr.id AS roll_no, s.name AS student_name, ac.id AS category, acs.value AS score 
                   FROM ac_scores acs 
                   JOIN students_records sr ON acs.student = sr.id 
                   JOIN students s ON sr.student = s.id 
                   JOIN assessment_criterias ac ON acs.ac = ac.id 
                   WHERE sr.year = ? AND ac.quarter = ? AND sr.class = ? AND sr.section = ? AND ac.subject = ?`;

    const filename = 'ac_scores.csv';
    try {
        await generateCsv(query, [year, quarter, classname, section, subject], filename, 'AC');
        res.download(filename);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const getLOReport = async (req, res) => {
    const { year, quarter, classname, section, subject } = req.headers;

    if (!year || !quarter || !classname || !section || !subject) {
        return res.status(400).json({ error: 'Missing required query parameters' });
    }

    const query = `SELECT sr.id AS roll_no, s.name AS student_name, lo.id AS category, los.value AS score 
                   FROM lo_scores los 
                   JOIN students_records sr ON los.student = sr.id 
                   JOIN students s ON sr.student = s.id 
                   JOIN learning_outcomes lo ON los.lo = lo.id 
                   WHERE sr.year = ? AND lo.quarter = ? AND sr.class = ? AND sr.section = ? AND lo.subject = ?`;

    const filename = 'lo_scores.csv';
    try {
        await generateCsv(query, [year, quarter, classname, section, subject], filename, 'LO');
        res.download(filename);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const getROReport = async (req, res) => {
    const { year, quarter, classname, section, subject } = req.headers;

    if (!year || !quarter || !classname || !section || !subject) {
        return res.status(400).json({ error: 'Missing required query parameters' });
    }

    const query = `SELECT sr.id AS roll_no, s.name AS student_name, ro.id AS category, ros.value AS score 
                   FROM ro_scores ros 
                   JOIN students_records sr ON ros.student = sr.id 
                   JOIN students s ON sr.student = s.id 
                   JOIN report_outcomes ro ON ros.ro = ro.id 
                   WHERE sr.year = ? AND ro.year = ? AND sr.class = ? AND sr.section = ? AND ro.subject = ?`;

    const filename = 'ro_scores.csv';
    try {
        await generateCsv(query, [year, year, classname, section, subject], filename, 'RO');
        res.download(filename);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export { getACReport, getLOReport, getROReport };
