import { adminAuth } from "../config/firebase.js";
import db from "../config/db.js";

const verifyUser = async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ message: "Token is required." });
  }

  try {
    // Step 1: Verify Firebase Token
    const decodedToken = await adminAuth.verifyIdToken(token);
    const email = decodedToken.email;

    if (!email) {
      return res.status(400).json({ error: "Email not found in token." });
    }

    // Step 2: Get Role & ID using await
    const [teacherResults] = await db.execute(
      "SELECT id, role FROM teachers WHERE email = ?",
      [email]
    );

    if (teacherResults.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const teacherId = teacherResults[0].id;
    const role = teacherResults[0].role;

    // Step 3: If not a teacher, just return role
    if (role !== "teacher") {
      return res.status(200).json({
        success: true,
        message: "User verified",
        role,
        user: decodedToken,
      });
    }

    // Step 4: If teacher, fetch allocations
    const [allocations] = await db.execute(
      `
      SELECT 
        classes.name AS class_name, 
        sections.name AS section_name, 
        subjects.name AS subject_name
      FROM teacher_allocation
      JOIN classes ON teacher_allocation.class = classes.id
      JOIN sections ON teacher_allocation.section = sections.id
      JOIN subjects ON teacher_allocation.subject = subjects.id
      WHERE teacher_allocation.teacher = ?
      `,
      [teacherId]
    );

    return res.status(200).json({
      success: true,
      message: "User verified",
      role,
      user: decodedToken,
      allocations: allocations.map((a) => ({
        class: a.class_name,
        section: a.section_name,
        subject: a.subject_name,
      })),
    });
  } catch (error) {
    console.error("Token verification failed:", error);
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
};

export { verifyUser };
