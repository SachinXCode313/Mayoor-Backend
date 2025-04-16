import db from "../config/db.js";
import fs from "fs";
import fastCsv from "fast-csv";
import archiver from "archiver";
import { Parser } from "json2csv";

// General CSV builder for AC, LO, RO
const generateCsv = async (query, params, filename, prefix) => {
    if (params.includes(undefined)) {
        throw new Error("Invalid or missing parameters for query execution");
    }

    const [rows] = await db.execute(query, params);
    const studentMap = {};

    for (let { roll_no, student_name, category, score } of rows) {
        if (!studentMap[roll_no]) {
            studentMap[roll_no] = { "Student Roll No.": roll_no, "Student Name": student_name };
        }
        studentMap[roll_no][`${prefix} ${category}`] = score;
    }

    const finalRows = Object.values(studentMap);
    const categories = [...new Set(rows.map(r => `${prefix} ${r.category}`))];
    const headers = ["Student Roll No.", "Student Name", ...categories];

    return new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(filename);
        fastCsv.write(finalRows, { headers }).pipe(ws).on("finish", resolve).on("error", reject);
    });
};

// Term Report CSV builder
const generateTermCsv = async (quarter, classname, section, year, subject, filename) => {
    const termQuarterMap = {
        3: [1, 2, 3],
        6: [4, 5, 6],
    };
    const [q1, q2, q3] = termQuarterMap[quarter];

    const [ros] = await db.query(
        `SELECT id, name FROM report_outcomes WHERE subject = ? AND year = ? ORDER BY id`,
        [subject, year]
    );
    if (ros.length === 0) throw new Error("No ROs found");

    const [students] = await db.query(
        `SELECT sr.student, s.name FROM students_records sr
     JOIN students s ON sr.student = s.id
     WHERE sr.class = ? AND sr.section = ? AND sr.year = ?`,
        [classname, section, year]
    );
    if (students.length === 0) throw new Error("No students found");

    const [scores] = await db.query(
        `SELECT student, ro, quarter, value FROM ro_scores WHERE quarter IN (?, ?, ?)`,
        [q1, q2, q3]
    );

    const scoreMap = {};
    for (let { student, ro, quarter, value } of scores) {
        if (!scoreMap[student]) scoreMap[student] = {};
        if (!scoreMap[student][ro]) scoreMap[student][ro] = {};
        scoreMap[student][ro][quarter] = value;
    }

    const csvData = students.map(({ student, name }) => {
        const row = { studentName: name };
        for (let ro of ros) {
            const qScores = scoreMap[student]?.[ro.id] || {};
            const q1Score = qScores[q1] || 0;
            const q2Score = qScores[q2] || 0;
            const q3Score = qScores[q3] || 0;
            const final = (0.3 * q1Score + 0.3 * q2Score + 0.4 * q3Score).toFixed(2);
            row[ro.name] = final;
        }
        return row;
    });

    const fields = ['studentName', ...ros.map(r => r.name)];
    const parser = new Parser({ fields });
    const csv = parser.parse(csvData);
    fs.writeFileSync(filename, csv);
};

// Main report exporter
const getReport = async (req, res) => {
    const { classname, section, year, subject, quarter } = req.headers;

    let reportTypes = req.headers["report-type"];
    if (!reportTypes) {
        return res.status(400).json({ error: "Missing report-type header" });
    }

    if (typeof reportTypes === "string") {
        reportTypes = reportTypes.split(",").map(r => r.trim().toLowerCase());
    }

    reportTypes = reportTypes.map(type => {
        if (type === "t1") return "term1";
        if (type === "t2") return "term2";
        return type;
    });

    const files = [];

    try {
        for (let type of reportTypes) {
            switch (type) {
                case "ac":
                    await generateCsv(
                        `SELECT sr.id AS roll_no, s.name AS student_name, ac.id AS category, acs.value AS score 
             FROM ac_scores acs 
             JOIN students_records sr ON acs.student = sr.id 
             JOIN students s ON sr.student = s.id 
             JOIN assessment_criterias ac ON acs.ac = ac.id 
             WHERE sr.year = ? AND ac.quarter = ? AND sr.class = ? AND sr.section = ? AND ac.subject = ?`,
                        [year, quarter, classname, section, subject],
                        "ac_scores.csv",
                        "AC"
                    );
                    files.push("ac_scores.csv");
                    break;

                case "lo":
                    await generateCsv(
                        `SELECT sr.id AS roll_no, s.name AS student_name, lo.id AS category, los.value AS score 
             FROM lo_scores los 
             JOIN students_records sr ON los.student = sr.id 
             JOIN students s ON sr.student = s.id 
             JOIN learning_outcomes lo ON los.lo = lo.id 
             WHERE sr.year = ? AND lo.quarter = ? AND sr.class = ? AND sr.section = ? AND lo.subject = ?`,
                        [year, quarter, classname, section, subject],
                        "lo_scores.csv",
                        "LO"
                    );
                    files.push("lo_scores.csv");
                    break;

                case "ro":
                    await generateCsv(
                        `SELECT sr.id AS roll_no, s.name AS student_name, ro.id AS category, ros.value AS score 
             FROM ro_scores ros 
             JOIN students_records sr ON ros.student = sr.id 
             JOIN students s ON sr.student = s.id 
             JOIN report_outcomes ro ON ros.ro = ro.id 
             WHERE sr.year = ? AND ro.year = ? AND sr.class = ? AND sr.section = ? AND ro.subject = ? AND ros.quarter = ?`,
                        [year, year, classname, section, subject, quarter],
                        "ro_scores.csv",
                        "RO"
                    );
                    files.push("ro_scores.csv");
                    break;

                case "term1":
                    await generateTermCsv(3, classname, section, year, subject, "term1_report.csv");
                    files.push("term1_report.csv");
                    break;

                case "term2":
                    await generateTermCsv(6, classname, section, year, subject, "term2_report.csv");
                    files.push("term2_report.csv");
                    break;

                default:
                    throw new Error(`Unknown report type: ${type}`);
            }
        }

        if (files.length === 1) {
            res.download(files[0]);
        } else {
            const zipPath = "reports.zip";
            const output = fs.createWriteStream(zipPath);
            const archive = archiver("zip");

            archive.pipe(output);
            files.forEach(file => archive.file(file, { name: file }));
            archive.finalize();

            output.on("close", () => res.download(zipPath));
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
}

export default getReport