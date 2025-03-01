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
            const { name, email } = teacherData;

            if (name && email) {
                console.log(`📩 Received data from: ${name} (${email})`);

                const currentTime = new Date();

                // Insert or update the teacher status
                db.query(
                    "INSERT INTO teachers (name, email, status, last_seen) VALUES (?, ?, 'active', ?) ON DUPLICATE KEY UPDATE status='active', last_seen=?",
                    [name, email, currentTime, currentTime],
                    (err) => {
                        if (err) {
                            console.error("❌ Database error:", err);
                            return;
                        }
                        console.log(`✅ Teacher ${name} marked as active`);
                        sendUpdatedList();
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

        let disconnectedTeacher = null;

        // Find which teacher's WebSocket has disconnected
        for (const teacher in activeTeachers) {
            if (activeTeachers[teacher] === ws) {
                disconnectedTeacher = teacher;
                break;
            }
        }

        if (disconnectedTeacher) {
            console.log(`🔄 Updating status for: ${disconnectedTeacher}`);

            const lastSeenTime = new Date();

            // Update the database to mark the teacher as inactive
            db.query(
                "UPDATE teachers SET status='inactive', last_seen=? WHERE name=?",
                [lastSeenTime, disconnectedTeacher],
                (err) => {
                    if (err) {
                        console.error("❌ Error updating teacher status:", err);
                    } else {
                        console.log(`✅ Teacher ${disconnectedTeacher} marked as inactive`);
                    }

                    // Remove teacher from activeTeachers
                    delete activeTeachers[disconnectedTeacher];
                    console.log("🟢 Active teachers after removal:", Object.keys(activeTeachers));

                    // Notify all clients
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

