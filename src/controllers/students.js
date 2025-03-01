import db from "../config/db.js";

// Get students
const getStudents =  async (req, res) => {
    const year = req.headers['year'];
    const className = req.headers['classname'];
    const section = req.headers['section'];
    // Check if all required headers are present
    if (!year || !className || !section) {
        return res.status(400).json({
            message: "Missing required headers. Please provide 'year', 'classname', and 'section'."
        });
    }
    // Validate year (should be a number)
    if (isNaN(year)) {
        return res.status(400).json({
            message: "Invalid header value. 'year' should be a number."
        });
    }
    // Validate className (should be a string or numeric value depending on your use case)
    if (!className.trim()) {
        return res.status(400).json({
            message: "Invalid header value. 'classname' cannot be empty."
        });
    }
    // Validate section (should not be empty)
    if (!section.trim()) {
        return res.status(400).json({
            message: "Invalid section. 'section' cannot be empty."
        });
    }
    try {
        // SQL query to get students' details along with their record information
        const query = `
            SELECT 
                s.id, 
                s.name, 
                sc.year, 
                sc.section, 
                sc.class 
            FROM students s 
            JOIN students_records sc ON s.id = sc.student 
            WHERE sc.year = ? AND sc.class = ? AND sc.section = ?
        `;
        // Execute query with the year, classname, and section as parameters
        const [results] = await db.execute(query, [year, className, section]);
        // If no results found, return 404 error
        if (results.length === 0) {
            return res.status(404).json({ message: 'No students found for the given year, class, and section.' });
        }
        // Return the list of students found, including their ID, name, and record details
        return res.status(200).json({ students: results });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Server error' });
    }
}

// POST: Add Student
const createStudent = async (req, res) => {
    const { name } = req.body;
    const year = req.headers['year'];
    const className = req.headers['classname'];
    const section = req.headers['section'];

    // Validate required fields
    if (!name || !year || !className || !section) {
        return res.status(400).json({
            message: "Missing required fields. Provide 'name' in body, and 'year', 'classname', 'section' in headers."
        });
    }

    if (!name.trim()) {
        return res.status(400).json({ message: "Invalid name. 'name' cannot be empty." });
    }

    if (isNaN(year)) {
        return res.status(400).json({ message: "Invalid year. 'year' should be a number." });
    }

    if (!className.trim()) {
        return res.status(400).json({ message: "Invalid class. 'classname' cannot be empty." });
    }

    if (!section.trim()) {
        return res.status(400).json({ message: "Invalid section. 'section' cannot be empty." });
    }

    try {
        // Get next available ID for students
        const [maxStudentId] = await db.execute('SELECT MAX(id) AS maxId FROM students');
        const studentId = (maxStudentId[0].maxId || 0) + 1;

        // Insert new student
        const studentQuery = `INSERT INTO students (id, name) VALUES (?, ?)`;
        await db.execute(studentQuery, [studentId, name]);

        // Insert student record
        const recordQuery = `INSERT INTO students_records (student, year, class, section) VALUES (?, ?, ?, ?)`;
        await db.execute(recordQuery, [studentId, year, className, section]);

        res.status(201).json({
            message: "Student added successfully",
            student: {
                id: studentId,
                name,
                year,
                class: className,
                section
            }
        });
    } catch (err) {
        console.error("Error inserting student:", err);
        res.status(500).json({ message: "Server error", error: err.message });
    }
};



// PUT: Update Student Status
const updateStudentStatus = async (req, res) => {
    const { id } = req.query;
    const { status } = req.body;


    // Validate student ID
    if (!id || isNaN(id)) {
        return res.status(400).json({ message: "Invalid student ID. It should be a number." });
    }

    // Validate status value (only "active" or "inactive" allowed)
    if (!status || !["active", "inactive"].includes(status.toLowerCase())) {
        return res.status(400).json({ message: "Invalid status. Allowed values are 'active' or 'inactive'." });
    }

    try {
        // Check if student exists
        const [studentExists] = await db.execute('SELECT id FROM students WHERE id = ?', [id]);
        if (studentExists.length === 0) {
            return res.status(404).json({ message: "Student not found." });
        }

        // Update status
        const updateQuery = `UPDATE students SET status = ? WHERE id = ?`;
        await db.execute(updateQuery, [status.toLowerCase(), id]);

        res.status(200).json({
            message: "Student status updated successfully",
            student: { id, status: status.toLowerCase() }
        });
    } catch (err) {
        console.error("Error updating student status:", err);
        res.status(500).json({ message: "Server error", error: err.message });
    }
};

export {updateStudentStatus, createStudent, getStudents};
