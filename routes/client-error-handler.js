const express = require("express");
const router = express.Router();
const auth = require("./auth");
const { paginateData } = require("../lib/paginate");

router.post("/api/error-handler/insert-client-error", async (req, res) => {
  const appName = req.headers['app-name'];
    const db = req.app.db[appName];
  try {
    const error = req.body.error;
    const stackTrace = req.body.stackTrace;
    const createdDate = req.body.createdDate;
    const customerId = req.body.customerId;
    const allErrorBody = req.body;


    const errorDoc = {
      error,
      stackTrace,
      createdDate,
      customerId,
      allErrorBody
    };

    await db.clientError.insertOne(errorDoc);
    return res.status(200).json({ message: "error successfully inserted" });
  } catch (ex) {
    console.info("Failed to insert the error", ex);
    return res.status(400).json({ message: "Failed to insert the error" });
  }
});

router.post(
  "/api/error-handler/get-client-error",
  // auth.required,
  async (req, res, next) => {
    const appName = req.headers['app-name'];
    const db = req.app.db[appName];
    let finalOrders = [];

    let pageNum = 1;
    if (req.body.pageNumber) {
      pageNum = req.body.pageNumber;
    }
    try {
      const errors = await paginateData(true, req, pageNum, "clientError", {}, {
        createdDate: -1,
      });
      res.status(200).json({data: errors, totalItems: errors?.totalItems});
    } catch (ex) {
      console.info("Failed to insert the error", ex);
      return res.status(400).json({ message: "Failed to insert the error" });
    }
  }
);

module.exports = router;
