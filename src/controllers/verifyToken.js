import { adminAuth } from "../config/firebase.js";

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

export default verifyToken;

