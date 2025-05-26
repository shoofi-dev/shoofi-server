const express = require('express');
const router = express.Router();
const colors = require("colors");
const websockets = require("../utils/websockets");

const {
    paginateData
} = require('../lib/paginate');

router.post("/api/admin/calander/disable/hour/insert", async (req, res) => {
    const appName = req.headers['app-name'];
    const db = req.app.db[appName];
    const calanderObj = {
      date: req.body.date,
      hour: req.body.hour,
    };

    try {
        await db.calander.insertOne(calanderObj);
        websockets.fireWebscoketEvent({appName});

          res.status(200).json(calanderObj);
      } catch (ex) {
        console.error(colors.red("Failed to insert calander disable hour: ", ex));
        res.status(400).json({
          message: "Customer creation failed.",
        });
      }

});

router.post("/api/admin/calander/disable/hour/insert/multi", async (req, res) => {
    const appName = req.headers['app-name'];
    const db = req.app.db[appName];
    try {
        await db.calander.insertMany(req.body);
        websockets.fireWebscoketEvent({appName});

          res.status(200).json({});
      } catch (ex) {
        console.error(colors.red("Failed to insert calander disable hour: ", ex));
        res.status(400).json({
          message: "Customer creation failed.",
        });
      }
});

router.post("/api/admin/calander/enable/hour", async (req, res) => {
    const appName = req.headers['app-name'];
    const db = req.app.db[appName];
    const calanderObj = {
      date: req.body.date,
      hour: req.body.hour,
    };

    try{
        const updateobj = { isDisabled: false };
        await db.calander.deleteOne({
            date: calanderObj.date, hour: calanderObj.hour });
            websockets.fireWebscoketEvent({appName});

        return res.status(200).json({ message: 'Disabled Hour enabled successfully updated' });
    }catch(ex){
        console.info('Error updating calander enable hour', ex);
    }

});

router.post("/api/admin/calander/enable/hour/multi", async (req, res) => {
  const appName = req.headers['app-name'];
    const db = req.app.db[appName];
    try{
        await db.calander.deleteMany({
            date: req.body.data});
            websockets.fireWebscoketEvent({appName});

        return res.status(200).json({ message: 'Disabled Hour enabled successfully updated' });
    }catch(ex){
        console.info('Error updating calander enable hour', ex);
    }

});

router.get("/api/admin/calander/disabled/hours/:date", async (req, res, next) => {
    const appName = req.headers['app-name'];
    const db = req.app.db[appName];
    const date = req.params.date;

    const calander = await db.calander
    .find({ date: date })
    // .sort({ created: -1 })
    .toArray();
    res.status(200).json(calander);
});

module.exports = router;