const admin = require("firebase-admin");
const express = require("express");
const router = express.Router();
// const serviceAccount = require("../path/to/serviceAccountKey.json");

// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount),
// });

const subscribeToTopic = async (token, topic) => {
  try {
    await admin.messaging().subscribeToTopic(token, topic);
    console.log(`Token subscribed to topic: ${topic}`);
  } catch (error) {
    console.error("Error subscribing to topic:", error);
  }
};

router.post("/api/push-notification/subscribe-to-topic", async (req, res) => {
  const { token, topic } = req.body;
  if (!token || !topic) {
    return res.status(400).send("Token and topic are required.");
  }

  try {
    await subscribeToTopic(token, topic);
    res.status(200).send(`Subscribed to topic: ${topic}`);
  } catch (error) {
    res.status(500).send("Failed to subscribe to topic.");
  }
});
module.exports = router;
