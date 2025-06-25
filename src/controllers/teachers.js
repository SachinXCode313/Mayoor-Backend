import db from "../config/db.js";

// Get Teachers List with Filters (Optional Class and Section)
const getTeachers = async (req, res) => {
    try {
        const { classname, section } = req.headers;
        let queryParams = [];
        let query = `
            SELECT 
                t.id, t.name AS teacher_name, t.email, t.role, t.status, t.last_seen,
                c.name as class, s.name AS section, sub.name AS subject
            FROM teachers t
            LEFT JOIN teacher_allocation ta ON t.id = ta.teacher
            LEFT JOIN classes c ON ta.class = c.id
            LEFT JOIN sections s ON ta.section = s.id
            LEFT JOIN subjects sub ON ta.subject = sub.id
        `;
        if (classname && section) {
            query += " WHERE c.id = ? AND s.id = ?";
            queryParams.push(classname, section);
        } else if (classname) {
            query += " WHERE c.id = ?";
            queryParams.push(classname);
        }

        query += " ORDER BY t.id";
        const [teachers] = await db.execute(query, queryParams);

        if (teachers.length === 0) {
            return res.status(404).json({ message: "No teachers found for the given filters." });
        }

        res.status(200).json({ teachers });
    } catch (error) {
        console.error("Error fetching teachers:", error.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

// POST: Add a new teacher and allocate them
const createTeacher = async (req, res) => {
    const { name, email, classname, section, subject, role } = req.body;

    // Validate required fields
    if (!name || !email || !classname || !section || !subject || !role) {
        return res.status(400).json({ message: "All fields (name, email, class, section, subject, role) are required." });
    }

    try {
        // Insert teacher into `teachers` table
        const teacherQuery = `
            INSERT INTO teachers (name, email, role, status, last_seen)
            VALUES (?, ?, ?, 'inactive', NOW())
            ON DUPLICATE KEY UPDATE name = VALUES(name), role = VALUES(role);
        `;
        await db.execute(teacherQuery, [name, email, role]);

        // Get the teacher's ID
        const [teacherData] = await db.execute("SELECT id FROM teachers WHERE email = ?", [email]);
        if (teacherData.length === 0) throw new Error("Failed to retrieve teacher ID.");
        const teacherId = teacherData[0].id;

        // Get Class ID
        const [classData] = await db.execute("SELECT id FROM classes WHERE id = ?", [classname]);
        if (classData.length === 0) throw new Error("Invalid class name.");
        const classId = classData[0].id;

        // Get Section ID
        const [sectionData] = await db.execute("SELECT id FROM sections WHERE id = ?", [section]);
        if (sectionData.length === 0) throw new Error("Invalid section name.");
        const sectionId = sectionData[0].id;

        // Get Subject ID
        const [subjectData] = await db.execute("SELECT id FROM subjects WHERE id = ?", [subject]);
        if (subjectData.length === 0) throw new Error("Invalid subject name.");
        const subjectId = subjectData[0].id;

        // Assign teacher to class, section, and subject in `teacher_allocation`
        const allocationQuery = `
            INSERT INTO teacher_allocation (teacher, class, section, subject)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE class = VALUES(class), section = VALUES(section), subject = VALUES(subject);
        `;
        await db.execute(allocationQuery, [teacherId, classId, sectionId, subjectId]);

        // If the teacher is a class teacher, add to `class_teacher` table
        if (role.toLowerCase() === "class teacher") {
            const classTeacherQuery = `
                INSERT INTO class_teacher (teacher, class, section)
                VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE class = VALUES(class), section = VALUES(section);
            `;
            await db.execute(classTeacherQuery, [teacherId, classId, sectionId]);
        }
        res.status(201).json({ message: "Teacher added and assigned successfully." });
    } catch (err) { // Rollback on error
        console.error("Error adding teacher:", err.message);
        res.status(500).json({ message: "Server error", error: err.message });
    }
};


// PUT: Update teacher details
const updateTeacher = async (req, res) => {
    const { id } = req.query;
    const { name, email, classname, section, subject, role } = req.body;

    // Validate teacher ID
    if (!id || isNaN(id)) {
        return res.status(400).json({ message: "Invalid teacher ID." });
    }

    try {

        // Check if the teacher exists
        const [teacherExists] = await db.execute("SELECT id, role FROM teachers WHERE id = ?", [id]);
        if (teacherExists.length === 0) {
            return res.status(404).json({ message: "Teacher not found." });
        }
        const previousRole = teacherExists[0].role; // Store previous role for comparison

        // Update fields dynamically
        let updateFields = [];
        let values = [];

        if (name) { updateFields.push("name = ?"); values.push(name); }
        if (email) { updateFields.push("email = ?"); values.push(email); }
        if (role) { updateFields.push("role = ?"); values.push(role); }

        if (updateFields.length > 0) {
            values.push(id);
            const updateQuery = `UPDATE teachers SET ${updateFields.join(", ")} WHERE id = ?`;
            await db.execute(updateQuery, values);
        }

        // If classname, section, or subject needs updating
        let classId = null, sectionId = null, subjectId = null;
        if (classname) {
            const [classData] = await db.execute("SELECT id FROM classes WHERE id = ?", [classname]);
            if (classData.length === 0) throw new Error("Invalid class name.");
            classId = classData[0].id;
        }
        if (section) {
            const [sectionData] = await db.execute("SELECT id FROM sections WHERE id = ?", [section]);
            if (sectionData.length === 0) throw new Error("Invalid section name.");
            sectionId = sectionData[0].id;
        }
        if (subject) {
            const [subjectData] = await db.execute("SELECT id FROM subjects WHERE id = ?", [subject]);
            if (subjectData.length === 0) throw new Error("Invalid subject name.");
            subjectId = subjectData[0].id;
        }

        // Update teacher allocation
        const [allocationExists] = await db.execute("SELECT id FROM teacher_allocation WHERE teacher = ?", [id]);

        if (allocationExists.length > 0) {
            // Update existing allocation
            let allocationUpdateFields = [];
            let allocationValues = [];

            if (classId) { allocationUpdateFields.push("class = ?"); allocationValues.push(classId); }
            if (sectionId) { allocationUpdateFields.push("section = ?"); allocationValues.push(sectionId); }
            if (subjectId) { allocationUpdateFields.push("subject = ?"); allocationValues.push(subjectId); }

            if (allocationUpdateFields.length > 0) {
                allocationValues.push(id);
                const allocationUpdateQuery = `UPDATE teacher_allocation SET ${allocationUpdateFields.join(", ")} WHERE teacher = ?`;
                await db.execute(allocationUpdateQuery, allocationValues);
            }
        } else {
            // Insert new allocation
            if (classId && sectionId && subjectId) {
                const allocationInsertQuery = `INSERT INTO teacher_allocation (teacher, class, section, subject) VALUES (?, ?, ?, ?)`;
                await db.execute(allocationInsertQuery, [id, classId, sectionId, subjectId]);
            }
        }

        // Manage `class_teacher` table based on role changes
        if (role) {
            if (role.toLowerCase() === "class teacher") {
                // Add or update class teacher
                const classTeacherQuery = `
                    INSERT INTO class_teacher (teacher_id, class_id, section_id)
                    VALUES (?, ?, ?)
                    ON DUPLICATE KEY UPDATE class_id = VALUES(class_id), section_id = VALUES(section_id);
                `;
                await db.execute(classTeacherQuery, [id, classId, sectionId]);
            } else if (previousRole.toLowerCase() === "class teacher" && role.toLowerCase() !== "class teacher") {
                // Remove from class_teacher if role is changed from "class teacher" to something else
                await db.execute("DELETE FROM class_teacher WHERE teacher_id = ?", [id]);
            }
        }

        res.status(200).json({ message: "Teacher updated successfully." });
    } catch (err) {
        console.error("Error updating teacher:", err.message);
        res.status(500).json({ message: "Server error", error: err.message });
    }
};


export {updateTeacher, getTeachers, createTeacher};

