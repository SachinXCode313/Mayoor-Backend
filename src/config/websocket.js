import WebSocket, { WebSocketServer } from "ws";
import db from "./db.js";

const WSPORT = process.env.WSPORT || 3500;
const wss = new WebSocketServer({ port: WSPORT });

let activeTeachers = {};

wss.on("connection", (ws) => {
    console.log("🔵 New client connected");

    ws.on("message", (message) => {
        try {
            const teacherData = JSON.parse(message);
            const { email } = teacherData;

            if (email) {
                console.log(`📩 Received data from: ${email}`);

                const currentTime = new Date();

                // Insert or update the teacher status
                db.query(
                    "UPDATE teachers SET status = 'active', last_seen = ? WHERE email = ?",
                    [currentTime, email],
                    (err, result) => {
                        if (err) {
                            console.error("❌ Database error:", err);
                            return;
                        }

                        if (result.affectedRows === 0) {
                            console.warn(`⚠️ No teacher found with email: ${email}`);
                        } else {
                            console.log(`✅ Teacher ${name} marked as active`);
                            sendUpdatedList();
                        }
                    }
                );


                // Store active connection
                activeTeachers[name] = ws;
                console.log("🟢 Active teachers:", Object.keys(activeTeachers));
            }
        } catch (err) {
            console.error("❌ Error parsing message:", err);
        }
    });

    ws.on("close", () => {
        console.log("🔴 A client disconnected");

        let disconnectedEmail = null;

        // Find the disconnected WebSocket by matching email
        for (const email in activeTeachers) {
            if (activeTeachers[email] === ws) {
                disconnectedEmail = email;
                break;
            }
        }

        if (disconnectedEmail) {
            console.log(`🔄 Updating status for: ${disconnectedEmail}`);

            const lastSeenTime = new Date();

            db.query(
                "UPDATE teachers SET status='inactive', last_seen=? WHERE email=?",
                [lastSeenTime, disconnectedEmail],
                (err) => {
                    if (err) {
                        console.error("❌ Error updating teacher status:", err);
                    } else {
                        console.log(`✅ Teacher ${disconnectedEmail} marked as inactive`);
                    }

                    // Clean up the reference
                    delete activeTeachers[disconnectedEmail];
                    console.log("🟢 Active teachers after removal:", Object.keys(activeTeachers));

                    // Push update to all clients
                    sendUpdatedList();
                }
            );
        } else {
            console.log("⚠️ Disconnected client not found in activeTeachers");
        }
    });
});

// Send updated list to all clients
function sendUpdatedList() {
    db.query("SELECT name, status, last_seen FROM teachers", (err, results) => {
        if (err) {
            console.error("❌ Error fetching teacher list:", err);
            return;
        }

        const formattedResults = results.map((teacher) => {
            const lastSeen = new Date(teacher.last_seen);
            const currentDate = new Date();
            teacher.last_seen = lastSeen.toDateString() === currentDate.toDateString()
                ? lastSeen.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                : lastSeen.toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit" });
            return teacher;
        });

        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(formattedResults));
            }
        });
    });
}

console.log(`✅ WebSocket server is running on port ${WSPORT}`);
export default wss;

