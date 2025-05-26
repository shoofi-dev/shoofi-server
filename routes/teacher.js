const express = require('express');
const router = express.Router();
const websockets = require("../utils/websockets");
const utmTimeService = require("../utils/utc-time");
const moment = require("moment");
const auth = require("./auth");
const colors = require("colors");
const {
  getId,
  clearCustomer,
  sanitize,
} = require("../lib/common");


router.post("/api/admin/teacher/create", async (req, res, next) => {
    const appName = req.headers['app-name'];
    const db = req.app.db[appName];
    const { name, role } = req.body;

    const newTeacher = {
        name,
        role,
      };

    await db.teachers.insertOne(newTeacher);
    // websockets.fireWebscoketEvent();
    res.status(200).json({ message: "Successfully created teacher" });
  });
router.post("/api/admin/teacher/get-list", async (req, res, next) => {
    const appName = req.headers['app-name'];
    const db = req.app.db[appName];
    const filter = req.body || {};

    const teachersList = await db.teachers.find(filter).toArray();
    // websockets.fireWebscoketEvent();
    res.status(200).json(teachersList);
  });

  module.exports = router;