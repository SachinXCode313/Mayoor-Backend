import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();
// Create database connection pool
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    port : process.env.DB_PORT,
    waitForConnections: true,
    // connectionLimit: process.env.DB_CONNECTION_LIMIT,
    queueLimit: 0,
    
});

(async () => {
    try {
        const connection = await db.getConnection();
        console.log("✅ Database connection established successfully!");
        connection.release(); // Release connection back to pool
    } catch (error) {
        console.error("❌ Database connection failed:", error.message);
    }
})();

export default db;

