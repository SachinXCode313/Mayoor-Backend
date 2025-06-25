// backend/firebase-admin.js
import admin from "firebase-admin";
import dotenv from "dotenv";
dotenv.config();
// Initialize Firebase Admin SDK only once


if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      type: process.env.FIREBASE_TYPE,
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
    }),
  });
}

export const adminAuth = admin.auth();
