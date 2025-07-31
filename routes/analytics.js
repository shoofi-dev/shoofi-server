const express = require("express");
const router = express.Router();
const moment = require("moment");
const { getId } = require("../lib/common");
const utcTimeService = require("../utils/utc-time");
const { ObjectId } = require("mongodb");

// Orders per restaurant
router.post("/api/analytics/orders-per-restaurant", async (req, res) => {
  const { startDate, endDate, statusList } = req.body;

  let match = {};
  if (startDate && endDate) {
    const offsetHours = utcTimeService.getUTCOffset();
    var start = moment(startDate).utcOffset(offsetHours);
    start.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });

    var end = moment(endDate).utcOffset(offsetHours);
    end.set({ hour: 23, minute: 59, second: 59, millisecond: 999 });
    
    match.created = { 
      $gte: start.format(), 
      $lte: end.format() 
    };
  }
  // Only count completed orders
  match.status = { $in: ["2","3","10","11","12"] };

  try {
    // Get all stores from shoofi database
    const shoofiDb = req.app.db['shoofi'];
    const stores = await shoofiDb.stores.find({}).toArray();
    
    let allResults = [];

    // Aggregate data from each store
    for (const store of stores) {
      try {
        const storeDb = req.app.db[store.appName];
        if (!storeDb) {
          console.warn(`Store database not found for appName: ${store.appName}`);
          continue;
        }

        // First, let's check if we have any orders in this store
        const totalOrders = await storeDb.orders.countDocuments(match);
        console.log(`Store ${store.appName}: Found ${totalOrders} orders matching criteria`);

        const result = await storeDb.orders.aggregate([
          { $match: match },
          { $group: {
              _id: "$branchId",
              orderCount: { $sum: 1 },
              totalSales: { $sum: "$orderPrice" },
              storeName: { $first: store.name || store.appName }
            }
          }
        ]).toArray();

        console.log(`Store ${store.appName}: Aggregated ${result.length} branch groups`);
        allResults = allResults.concat(result);
      } catch (error) {
        console.error(`Error processing store ${store.appName}:`, error);
      }
    }

    // Combine results by branch/store
    const combinedResults = {};
    allResults.forEach(item => {
      const key = item._id || 'unknown';
      if (!combinedResults[key]) {
        combinedResults[key] = {
          _id: key,
          orderCount: 0,
          totalSales: 0,
          storeName: item.storeName || 'Unknown Store'
        };
      }
      combinedResults[key].orderCount += item.orderCount;
      combinedResults[key].totalSales += item.totalSales;
    });

    // Convert to array and sort by order count
    const finalResult = Object.values(combinedResults).sort((a, b) => b.orderCount - a.orderCount);

    res.status(200).json(finalResult);
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

// Orders daily analytics - count and price per day
router.post("/api/analytics/orders-daily", async (req, res) => {
  const { startDate, endDate } = req.body;

  let match = {};
  if (startDate && endDate) {
    const offsetHours = utcTimeService.getUTCOffset();
    var start = moment(startDate).utcOffset(offsetHours);
    start.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });

    var end = moment(endDate).utcOffset(offsetHours);
    end.set({ hour: 23, minute: 59, second: 59, millisecond: 999 });
    
    // Since created is a string, we need to match against string format
    match.created = { 
      $gte: start.format(), 
      $lte: end.format() 
    };
  }
  // Only count completed orders
  match.status = { $in: ["2","3","10","11","12"] };

  try {
    // Get all stores from shoofi database
    const shoofiDb = req.app.db['shoofi'];
    const stores = await shoofiDb.stores.find({}).toArray();
    
    let allResults = [];

    // Aggregate data from each store
    for (const store of stores) {
      try {
        const storeDb = req.app.db[store.appName];
        if (!storeDb) {
          console.warn(`Store database not found for appName: ${store.appName}`);
          continue;
        }

        // First, let's check if we have any orders in this store
        const totalOrders = await storeDb.orders.countDocuments(match);
        console.log(`Store ${store.appName}: Found ${totalOrders} orders matching criteria`);

        const result = await storeDb.orders.aggregate([
          { $match: match },
          {
            $addFields: {
              dateStr: {
                $substr: ["$created", 0, 10] // Extract YYYY-MM-DD from ISO string
              }
            }
          },
          {
            $group: {
              _id: "$dateStr",
              orderCount: { $sum: 1 },
              totalSales: { $sum: "$orderPrice" },
              avgOrderValue: { $avg: "$orderPrice" }
            }
          },
          {
            $project: {
              _id: 0,
              date: { $dateFromString: { dateString: "$_id" } },
              orderCount: 1,
              totalSales: 1,
              avgOrderValue: 1
            }
          }
        ]).toArray();

        console.log(`Store ${store.appName}: Aggregated ${result.length} date groups`);
        allResults = allResults.concat(result);
      } catch (error) {
        console.error(`Error processing store ${store.appName}:`, error);
      }
    }

    // Combine results by date
    const combinedResults = {};
    allResults.forEach(item => {
      const dateKey = moment(item.date).format('YYYY-MM-DD');
      if (!combinedResults[dateKey]) {
        combinedResults[dateKey] = {
          date: item.date,
          orderCount: 0,
          totalSales: 0,
          avgOrderValue: 0,
          totalOrders: 0
        };
      }
      combinedResults[dateKey].orderCount += item.orderCount;
      combinedResults[dateKey].totalSales += item.totalSales;
      combinedResults[dateKey].totalOrders += item.orderCount;
    });

    // Calculate average order value for each date
    Object.values(combinedResults).forEach(item => {
      if (item.totalOrders > 0) {
        item.avgOrderValue = item.totalSales / item.totalOrders;
      }
    });

    // Convert to array and sort by date
    const finalResult = Object.values(combinedResults).sort((a, b) => 
      moment(a.date).diff(moment(b.date))
    );

    res.status(200).json(finalResult);
  } catch (ex) {
    res.status(400).json({ message: "Failed to get daily orders analytics", error: ex });
  }
});

// Orders comparison between specific days
router.post("/api/analytics/orders-comparison", async (req, res) => {
  const { dates } = req.body; // dates should be an array of date strings

  if (!dates || !Array.isArray(dates) || dates.length === 0) {
    return res.status(400).json({ message: "Dates array is required" });
  }

  try {
    // Get all stores from shoofi database
    const shoofiDb = req.app.db['shoofi'];
    const stores = await shoofiDb.stores.find({}).toArray();

    const results = await Promise.all(
      dates.map(async (dateStr) => {
        const offsetHours = utcTimeService.getUTCOffset();
        const start = moment(dateStr).utcOffset(offsetHours);
        start.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });

        const end = moment(dateStr).utcOffset(offsetHours);
        end.set({ hour: 23, minute: 59, second: 59, millisecond: 999 });

        let match = {
          created: { $gte: start.format(), $lte: end.format() },
          status: { $in: ["2","3","10","11","12"] } // Only count completed orders
        };

        let totalOrderCount = 0;
        let totalSales = 0;
        let totalOrders = 0;

        // Aggregate data from each store
        for (const store of stores) {
          try {
            const storeDb = req.app.db[store.appName];
            if (!storeDb) {
              console.warn(`Store database not found for appName: ${store.appName}`);
              continue;
            }

            const result = await storeDb.orders.aggregate([
              { $match: match },
              {
                $group: {
                  _id: null,
                  orderCount: { $sum: 1 },
                  totalSales: { $sum: "$orderPrice" },
                  avgOrderValue: { $avg: "$orderPrice" }
                }
              }
            ]).toArray();

            if (result.length > 0) {
              totalOrderCount += result[0].orderCount || 0;
              totalSales += result[0].totalSales || 0;
              totalOrders += result[0].orderCount || 0;
            }
          } catch (error) {
            console.error(`Error processing store ${store.appName} for date ${dateStr}:`, error);
          }
        }

        return {
          date: dateStr,
          orderCount: totalOrderCount,
          totalSales: totalSales,
          avgOrderValue: totalOrders > 0 ? totalSales / totalOrders : 0
        };
      })
    );

    res.status(200).json(results);
  } catch (ex) {
    res.status(400).json({ message: "Failed to get orders comparison", error: ex });
  }
});

module.exports = router; 