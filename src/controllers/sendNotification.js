import admin from '../config/firebase-admin.js';
import db from '../config/db.js';

// Save token to MySQL
export const saveToken = async (req, res) => {
    try {
        console.log("📥 Received request to save token:", req.body);

        const { token } = req.body;

        if (!token || typeof token !== 'string' || token.length < 20) {
            console.error("❌ Invalid or missing token");
            return res.status(400).json({ message: 'Valid token is required' });
        }

        // Save token (INSERT IGNORE prevents duplicate errors)
        const [result] = await db.query('INSERT IGNORE INTO device_tokens (token) VALUES (?)', [token]);

        if (result.affectedRows > 0) {
            console.log('✅ Token saved:', token);
            res.json({ message: 'Token saved successfully' });
        } else {
            console.log('ℹ️ Token already exists:', token);
            res.json({ message: 'Token already exists' });
        }

    } catch (error) {
        console.error('❌ Database Error:', error);
        res.status(500).json({ message: 'Database error', error: error.message });
    }
};

// Send notifications to stored tokens
export const sendNotification = async (req, res) => {
    try {
        console.log("📥 Received request to send notification:", req.body);

        const { title, body } = req.body;

        if (!title || !body) {
            console.error("❌ Missing title or body");
            return res.status(400).json({ message: 'Title and body are required' });
        }

        // Retrieve tokens from database
        const [rows] = await db.query('SELECT token FROM device_tokens');
        if (rows.length === 0) {
            console.error("❌ No tokens found");
            return res.status(400).json({ message: 'No users to notify' });
        }

        const tokensArray = rows.map(row => row.token);
        console.log(tokensArray)
        // console.log(`📢 Sending notifications to ${tokensArray.length} tokens`);


        const message = tokensArray.map((token) => ({
          notification: {
            title,
            body,
          },
          token:token,
        }))

        console.log(message)

        // Firebase message payload
       
        // Send notifications
        const response = await admin.messaging().sendEach(message);
        console.log("✅ Firebase responses:", response);

        // Remove invalid tokens
        const invalidTokens = [];
        response.responses.forEach((resp, index) => {
            if (!resp.success && resp.error.code === "messaging/registration-token-not-registered") {
                invalidTokens.push(tokensArray[index]);
            }
        });

        if (invalidTokens.length > 0) {
            await db.query('DELETE FROM device_tokens WHERE token IN (?)', [invalidTokens]);
            console.log('🚮 Removed invalid tokens:', invalidTokens);
        }

        res.json({
            message: "✅ Notification sent successfully!",
            successCount: response.successCount,
            failureCount: response.failureCount,
            invalidTokens,
        });

    } catch (error) {
        console.error("❌ Firebase Error:", error);
        res.status(500).json({ message: "Failed to send notification", error: error.message });
    }
};



// import admin from '../config/firebase-admin.js';

// let tokensArray = []

// export const saveToken = (req, res) => {
//   const { token } = req.body

//   if (!token) {
//     return res.status(400).json({ message: 'Token is required' });
//   }

//   if (!tokensArray.includes(token)) {
//     tokensArray.push(token);
//     console.log('Stored tokens:', tokensArray)
//   }

//   res.json({ message: 'Token saved successfully' })
// }

// export const sendNotification = async (req, res) => {
//   const { title, body } = req.body

//   if (!title || !body) {
//     console.error("Missing title or body in request:", req.body)
//     return res.status(400).json({ message: 'Title and body are required' })
//   }

//   if (tokensArray.length === 0) {
//     console.error("No users to notify. Tokens list is empty.")
//     return res.status(400).json({ message: 'No users to notify' })
//   }

//   console.log("Sending notifications to tokens:", tokensArray)

//   const message = {
//     notification: { title, body },
//     tokens: tokensArray,
//   }

//   try {
//     const response = await admin.messaging().sendEachForMulticast(message)
//     console.log("Firebase responses:", response)

//     response.responses.forEach((resp, index) => {
//       if (!resp.success && resp.error.code === "messaging/registration-token-not-registered") {
//         console.log(`Removing invalid token: ${tokensArray[index]}`)
//         tokensArray.splice(index, 1); 
//       }
//     })

//     res.json({
//       message: "Notification sent successfully!",
//       tokensSent: tokensArray,
//       response,
//     })

//   } catch (error) {
//     console.error("Firebase Error:", error)
//     res.status(500).json({ message: "Failed to send notification", error: error.message })
//   }
// };