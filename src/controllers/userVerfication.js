import { adminAuth } from "../config/firebase.js";
import db from "../config/db.js";

const verifyToken = async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).send({ message: "Token is required." });
  }

  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    console.log("User verified and authorized.");
    res.status(200).send({
      success: true,
      message: "User verified",
      user: decodedToken,
    });
  } catch (error) {
    console.error("Error verifying token:", error);
    res.status(401).send({ success: false, message: "Unauthorized" });
  }
};

const verifyUser = (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  const roleQuery = "SELECT id, role FROM teachers WHERE email = ?";

  db.query(roleQuery, [email], (err, results) => {
    if (err) return res.status(500).json({ error: "Database query failed" });

    if (results.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const teacherId = results[0].id;
    const role = results[0].role;

    if (role !== "teacher") {
      return res.json({ role }); // just send the role for non-teachers
    }

    const allocationQuery = `
      SELECT 
        classes.name AS class_name, 
        sections.name AS section_name, 
        subjects.name AS subject_name
      FROM teacher_allocation
      JOIN classes ON teacher_allocation.class = classes.id
      JOIN sections ON teacher_allocation.section = sections.id
      JOIN subjects ON teacher_allocation.subject = subjects.id
      WHERE teacher_allocation.teacher = ?
    `;

    db.query(allocationQuery, [teacherId], (err, allocations) => {
      if (err) return res.status(500).json({ error: "Failed to fetch allocations" });

      return res.json({
        role,
        allocations: allocations.map(a => ({
          class: a.class_name,
          section: a.section_name,
          subject: a.subject_name
        }))
      });
    });
  });
};


export {verifyToken,verifyUser};

