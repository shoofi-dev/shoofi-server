const express = require("express");
const router = express.Router();
const moment = require("moment");
const { getId } = require("../lib/common");

// Orders per restaurant
router.post("/api/analytics/orders-per-restaurant", async (req, res) => {
  const appName = req.headers['app-name'];
  const db = req.app.db[appName];
  const { startDate, endDate, statusList } = req.body;

  let match = {};
  if (startDate && endDate) {
    match.created = { $gte: new Date(startDate), $lte: new Date(endDate) };
  }
  if (statusList && statusList.length) {
    match.status = { $in: statusList };
  }

  try {
    const result = await db.orders.aggregate([
      { $match: match },
      { $group: {
          _id: "$branchId",
          orderCount: { $sum: 1 },
          totalSales: { $sum: "$orderPrice" }
        }
      },
      { $sort: { orderCount: -1 } }
    ]).toArray();

    res.status(200).json(result);
  } catch (ex) {
    res.status(400).json({ message: "Failed to get analytics", error: ex });
  }
});

// Deliveries by delivery company
router.post("/api/analytics/deliveries-by-company", async (req, res) => {
  const appName = req.headers['app-name'];
  const db = req.app.db[appName];
  const { startDate, endDate, companyId } = req.body;

  let match = {};
  if (startDate && endDate) {
    match.created = { $gte: new Date(startDate), $lte: new Date(endDate) };
  }
  if (companyId) {
    match.companyId = getId(companyId);
  }

  try {
    const result = await db.bookDelivery.aggregate([
      { $match: match },
      { $group: {
          _id: "$companyId",
          deliveryCount: { $sum: 1 },
          avgDeliveryTime: { $avg: "$deliveryDeltaMinutes" }
        }
      },
      { $sort: { deliveryCount: -1 } }
    ]).toArray();

    res.status(200).json(result);
  } catch (ex) {
    res.status(400).json({ message: "Failed to get analytics", error: ex });
  }
});

// Customers list & segmentation
router.post("/api/analytics/customers", async (req, res) => {
  const appName = req.headers['app-name'];
  const db = req.app.db[appName];
  const { startDate, endDate, minOrderCount } = req.body;

  let match = {};
  if (startDate && endDate) {
    match.created = { $gte: new Date(startDate), $lte: new Date(endDate) };
  }

  try {
    const result = await db.customers.aggregate([
      { $match: match },
      { $lookup: {
          from: "orders",
          localField: "_id",
          foreignField: "customerId",
          as: "orders"
        }
      },
      { $project: {
          _id: 1,
          fullName: 1,
          phone: 1,
          orderCount: { $size: "$orders" },
          totalSpent: { $sum: "$orders.orderPrice" }
        }
      },
      { $match: minOrderCount ? { orderCount: { $gte: minOrderCount } } : {} },
      { $sort: { orderCount: -1 } }
    ]).toArray();

    res.status(200).json(result);
  } catch (ex) {
    res.status(400).json({ message: "Failed to get analytics", error: ex });
  }
});

// Customer orders
router.post("/api/analytics/customer-orders", async (req, res) => {
  const appName = req.headers['app-name'];
  const db = req.app.db[appName];
  const { customerId, startDate, endDate } = req.body;

  let match = { customerId: getId(customerId) };
  if (startDate && endDate) {
    match.created = { $gte: new Date(startDate), $lte: new Date(endDate) };
  }

  try {
    const result = await db.orders.aggregate([
      { $match: match },
      { $sort: { created: -1 } }
    ]).toArray();

    res.status(200).json(result);
  } catch (ex) {
    res.status(400).json({ message: "Failed to get analytics", error: ex });
  }
});

module.exports = router; 