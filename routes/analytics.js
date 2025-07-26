const express = require("express");
const router = express.Router();
const moment = require("moment");
const { getId } = require("../lib/common");
const utcTimeService = require("../utils/utc-time");
const { ObjectId } = require("mongodb");

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

// All deliveries from delivery company db, with optional filters
router.post("/api/analytics/deliveries", async (req, res) => {
  const appName = req.headers['app-name'];
  const db = req.app.db[appName];
  const { storeId, status, startDate, endDate, companyId, driverId, orderId } = req.body;

  let match = {};
  if (storeId) {
    match.storeId = getId(storeId);
  }
  if (companyId) {
    match["company._id"] = ObjectId(companyId);
  }
  if (driverId) {
    if (Array.isArray(driverId)) {
      match["driver._id"] = { $in: driverId.map(id => getId(id)) };
    } else {
      match["driver._id"] = getId(driverId);
    }
  }
  if (status) {
    match.status = { $in: status };
  }
  if (orderId) {
    // Support both order.orderId and orderId at root
    match.$or = [
      { "order.orderId": { $regex: orderId, $options: "i" } },
      { orderId: { $regex: orderId, $options: "i" } }
    ];
  }
  if (startDate && endDate) {

    const offsetHours = utcTimeService.getUTCOffset();
    var start = moment(startDate).utcOffset(offsetHours);
      start.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });

      var end = moment(endDate).utcOffset(offsetHours);
      end.set({ hour: 23, minute: 59, second: 59, millisecond: 999 });
    match.created = { $gte: start.format(), $lte: end.format() };
  }

  try {
    const deliveries = await db.bookDelivery.find(match).toArray();
    
    // Fetch order details for each delivery
    const deliveriesWithOrders = await Promise.all(
      deliveries.map(async (delivery) => {
        try {
          // Get order details from the delivery record
          const orderInfo = delivery.order;
          if (!orderInfo || !orderInfo.orderId || !orderInfo.appName) {
            return { ...delivery, storeOrder: null };
          }

          // Get the store database using the order's appName
          const storeDb = req.app.db[orderInfo.appName];
          if (!storeDb) {
            console.warn(`Store database not found for appName: ${orderInfo.appName}`);
            return { ...delivery, storeOrder: null };
          }

          // Fetch the order from the store database
          const storeOrder = await storeDb.orders.findOne({ 
            orderId: orderInfo.orderId 
          });

          return {
            ...delivery,
            storeOrder: storeOrder || null
          };
        } catch (error) {
          console.error(`Error fetching order for delivery ${delivery._id}:`, error);
          return { ...delivery, storeOrder: null };
        }
      })
    );

    res.status(200).json(deliveriesWithOrders);
  } catch (ex) {
    res.status(400).json({ message: "Failed to get deliveries", error: ex });
  }
});

module.exports = router; 