const express = require("express");
const router = express.Router();
const moment = require("moment");
const { getId } = require("../lib/common");
const { paginateData } = require("../lib/paginate");
const websockets = require("../utils/websockets");
const { Expo } = require("expo-server-sdk");

router.post("/api/shoofiAdmin/store/list", async (req, res, next) => {
//   let expo = new Expo();

//   const messages =[{
//     to: 'ExponentPushToken[oHeITbIMMN6kbutYnEIouJ]',
//     sound: 'default',
//     body: 'This is a test notification',
//     data: { withSome: 'data' },
//   }];

//   let chunks = expo.chunkPushNotifications(messages);
// let tickets = [];
// (async () => {
//   // Send the chunks to the Expo push notification service. There are
//   // different strategies you could use. A simple one is to send one chunk at a
//   // time, which nicely spreads the load out over time:
//   for (let chunk of chunks) {
//     try {
//       let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
//       console.log(ticketChunk);
//       tickets.push(...ticketChunk);
//       // NOTE: If a ticket contains an error code in ticket.details.error, you
//       // must handle it appropriately. The error codes are listed in the Expo
//       // documentation:
//       // https://docs.expo.io/push-notifications/sending-notifications/#individual-errors
//     } catch (error) {
//       console.error(error);
//     }
//   }
// })();
    let storesLostFinal = [];
    const dbAdmin = req.app.db['shoofi'];
    const location = req.body.location;
    if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
      return res.status(400).json({ message: 'Location is required and must be numbers.' });
    }
    const storesList = await dbAdmin.stores.find().toArray();
    for (let i = 0; i < storesList.length; i++) {
      const dbName = storesList[i].appName;
      const db = req.app.db[dbName];
      const storeDataArr = await db.store.find().toArray();
      const storeData = storeDataArr[0];
      if (storeData && storeData.location && storeData.coverageRadius) {
        // Calculate distance between user and store
        const toRad = (value) => (value * Math.PI) / 180;
        const R = 6371000; // Earth radius in meters
        const dLat = toRad(location.lat - storeData.location.coordinates[1]);
        const dLon = toRad(location.lng - storeData.location.coordinates[0]);
        const lat1 = toRad(storeData.location.coordinates[1]);
        const lat2 = toRad(location.lat);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;
        if (distance <= storeData.coverageRadius) {
          storesLostFinal.push(storeData);
        }
      }
    }
    res.status(200).json(storesLostFinal);
});

router.post("/api/shoofiAdmin/category/list", async (req, res, next) => {
  const dbAdmin = req.app.db['shoofi'];
  const categoryList = await dbAdmin.categories.find().toArray();
  res.status(200).json(categoryList);
});

router.get("/api/store/download-app", async (req, res) => {
  const db = req.app.db[req.headers['db-name']];

  const userAgent = req.get('user-agent');
  if (userAgent.includes('iPhone') || userAgent.includes('iPad')) {
    const data = {
      source: 'default',
      created: new Date(),
      ipAddress: req.ip,
      type: 'IOS'
    };
    await db.downloadAppQr.insertOne(data);
    res.redirect('itms-apps://itunes.apple.com/app/6446260267');
  } else if (userAgent.includes('Android')) {
    const data = {
      source: 'default',
      created: new Date(),
      ipAddress: req.ip,
      type: 'ANDROID'
    };
    await db.downloadAppQr.insertOne(data);
    res.redirect('https://play.google.com/store/apps/details?id=com.sariq.creme.caramel');
  }
});

router.get("/api/shoofiAdmin/store/all", async (req, res, next) => {
  try {
    const dbAdmin = req.app.db['shoofi'];
    const stores = await dbAdmin.stores.find().toArray();
    res.status(200).json(stores);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch stores', error: err.message });
  }
});

module.exports = router;
