import admin from 'firebase-admin'
import dotenv from "dotenv";
dotenv.config();

export const initializeFirebase = () => {
  try {
    
    admin.initializeApp({
      credential: admin.credential.cert({
        type: process.env.FIREBASE_TYPE,
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        token_uri : process.env.FIREBASE_TOKEN_URI
      }),
    })

    console.log("Firebase Admin SDK initialized successfully")
  } catch (error) {
    console.error("Error initializing Firebase Admin SDK:", error)
    process.exit(1)
  }
}

export default admin