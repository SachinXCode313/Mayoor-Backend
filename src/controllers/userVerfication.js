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

  const query = "SELECT role FROM teachers WHERE email = ?";

  db.query(query, [email], (err, results) => {
    if (err) {
      return res.status(500).json({ error: "Database query failed" });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json({ role });
  });
}

export {verifyToken,verifyUser};

