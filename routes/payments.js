const express = require("express");
const moment = require("moment");
const router = express.Router();
const { getId } = require("../lib/common");
const { ObjectId } = require("mongodb");

// Helper function to get date range
const getDateRange = (period) => {
  const now = moment();
  let start, end;
  
  switch (period) {
    case 'day':
      start = now.clone().startOf('day');
      end = now.clone().endOf('day');
      break;
    case 'week':
      start = now.clone().startOf('week');
      end = now.clone().endOf('week');
      break;
    case 'month':
      start = now.clone().startOf('month');
      end = now.clone().endOf('month');
      break;
    default:
      start = now.clone().subtract(30, 'days');
      end = now.clone();
  }
  
  return { start: start.format(), end: end.format() };
};

// Helper function to calculate commission
const calculateCommission = (amount, commissionRate = 0.15) => {
  return amount * commissionRate;
};

// 1. PARTNER PAYMENT ROUTES

// Get partner payment summary
router.post("/api/payments/partner/summary", async (req, res) => {
  const appName = req.headers['app-name'];
  const db = req.app.db[appName];
  
  try {
    const { partnerId, period = 'month', startDate, endDate } = req.body;
    
    if (!partnerId) {
      return res.status(400).json({ message: "Partner ID is required" });
    }
    
    const dateRange = startDate && endDate 
      ? { start: moment(startDate).format(), end: moment(endDate).format() }
      : getDateRange(period);
    
    // Get orders for this partner (excluding canceled orders)
    const orders = await db.orders.find({
      orderStatus: { $ne: "Cancelled" },
      orderDate: { $gte: dateRange.start, $lte: dateRange.end }
    }).toArray();
    
    // Calculate totals
    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((sum, order) => sum + (order.orderPrice || 0), 0);
    const totalCommission = calculateCommission(totalRevenue);
    const partnerEarnings = totalRevenue - totalCommission;
    
    // Group by date for charts
    const dailyData = orders.reduce((acc, order) => {
      const date = moment(order.orderDate).format('YYYY-MM-DD');
      if (!acc[date]) {
        acc[date] = {
          date,
          orders: 0,
          revenue: 0,
          commission: 0,
          earnings: 0
        };
      }
      acc[date].orders += 1;
      acc[date].revenue += (order.orderPrice || 0);
      acc[date].commission += calculateCommission(order.orderPrice || 0);
      acc[date].earnings += (order.orderPrice || 0) - calculateCommission(order.orderPrice || 0);
      return acc;
    }, {});
    
    const dailyArray = Object.values(dailyData).sort((a, b) => 
      moment(a.date).diff(moment(b.date))
    );
    
    res.status(200).json({
      summary: {
        totalOrders,
        totalRevenue,
        totalCommission,
        partnerEarnings,
        period: period,
        dateRange: {
          start: dateRange.start,
          end: dateRange.end
        }
      },
      dailyData: dailyArray
    });
    
  } catch (error) {
    console.error("Error getting partner payment summary:", error);
    res.status(500).json({ message: "Error getting payment summary" });
  }
});

// Get partner payment details
router.post("/api/payments/partner/details", async (req, res) => {
  const appName = req.headers['app-name'];
  const db = req.app.db[appName];
  
  try {
    const { partnerId, period = 'month', startDate, endDate, page = 1, limit = 20 } = req.body;
    
    if (!partnerId) {
      return res.status(400).json({ message: "Partner ID is required" });
    }
    
    const dateRange = startDate && endDate 
      ? { start: moment(startDate).format(), end: moment(endDate).format() }
      : getDateRange(period);
    
    const skip = (page - 1) * limit;
    
    // Get orders with pagination
    const orders = await db.orders.find({
      orderStatus: { $ne: "Cancelled" },
      "orderProducts.storeId": partnerId,
      orderDate: { $gte: dateRange.start, $lte: dateRange.end }
    })
    .sort({ orderDate: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();
    
    // Get total count for pagination
    const totalOrders = await db.orders.countDocuments({
      orderStatus: { $ne: "Cancelled" },
      "orderProducts.storeId": partnerId,
      orderDate: { $gte: dateRange.start, $lte: dateRange.end }
    });
    
    // Add payment calculations to each order
    const ordersWithPayments = orders.map(order => {
      const commission = calculateCommission(order.orderPrice || 0);
      const earnings = (order.orderPrice || 0) - commission;
      
      return {
        ...order,
        commission,
        earnings,
        paymentStatus: order.orderStatus === 'Paid' ? 'paid' : 'pending'
      };
    });
    
    res.status(200).json({
      orders: ordersWithPayments,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalOrders / limit),
        totalOrders,
        hasNext: page * limit < totalOrders,
        hasPrev: page > 1
      }
    });
    
  } catch (error) {
    console.error("Error getting partner payment details:", error);
    res.status(500).json({ message: "Error getting payment details" });
  }
});

// 2. DRIVER PAYMENT ROUTES

// Get driver payment summary
router.post("/api/payments/driver/summary", async (req, res) => {
  const appName = 'delivery-company';
  const db = req.app.db[appName];
  
  try {
    const { driverId, period = 'month', startDate, endDate } = req.body;
    
    if (!driverId) {
      return res.status(400).json({ message: "Driver ID is required" });
    }
    
    const dateRange = startDate && endDate 
      ? { start: moment(startDate).format(), end: moment(endDate).format() }
      : getDateRange(period);
    
    // Get completed deliveries for this driver
    const deliveries = await db.bookDelivery.find({
      "driver._id": ObjectId(driverId),
      status: '4', // Completed deliveries
      created: { $gte: dateRange.start, $lte: dateRange.end }
    }).toArray();
    
    // Calculate totals
    const totalDeliveries = deliveries.length;
    const totalEarnings = deliveries.reduce((sum, delivery) => {
      // Calculate driver earnings based on delivery fee or commission
      const deliveryFee = delivery.price || 0;
      const commission = calculateCommission(deliveryFee, 0); // 20% commission for drivers
      return sum + (deliveryFee - commission);
    }, 0);
    
    const totalDeliveryFees = deliveries.reduce((sum, delivery) => 
      sum + (Number(delivery.order.shippingPrice) || 0), 0
    );
    
    const totalCommission = totalDeliveryFees - totalEarnings;
    
    // Group by date for charts
    const dailyData = deliveries.reduce((acc, delivery) => {
      const date = moment(delivery.created).format('YYYY-MM-DD');
      if (!acc[date]) {
        acc[date] = {
          date,
          deliveries: 0,
          fees: 0,
          commission: 0,
          earnings: 0
        };
      }
      const deliveryFee = delivery.order.shippingPrice || 0;
      const commission = calculateCommission(deliveryFee, 0);
      const earnings = deliveryFee - commission;
      
      acc[date].deliveries += 1;
      acc[date].fees += deliveryFee;
      acc[date].commission += commission;
      acc[date].earnings += earnings;
      return acc;
    }, {});
    
    const dailyArray = Object.values(dailyData).sort((a, b) => 
      moment(a.date).diff(moment(b.date))
    );
    
    res.status(200).json({
      summary: {
        totalDeliveries,
        totalDeliveryFees,
        totalCommission,
        totalEarnings,
        period: period,
        dateRange: {
          start: dateRange.start,
          end: dateRange.end
        }
      },
      dailyData: dailyArray
    });
    
  } catch (error) {
    console.error("Error getting driver payment summary:", error);
    res.status(500).json({ message: "Error getting payment summary" });
  }
});

// Get driver payment details
router.post("/api/payments/driver/details", async (req, res) => {
  const appName = 'delivery-company';
  const db = req.app.db[appName];
  
  try {
    const { driverId, period = 'month', startDate, endDate, page = 1, limit = 20 } = req.body;
    
    if (!driverId) {
      return res.status(400).json({ message: "Driver ID is required" });
    }
    
    const dateRange = startDate && endDate 
      ? { start: moment(startDate).format(), end: moment(endDate).format() }
      : getDateRange(period);
    
    const skip = (page - 1) * limit;
    
    // Get completed deliveries with pagination
    const deliveries = await db.bookDelivery.find({
      "driver._id": driverId,
      status: '0', // Completed deliveries
      created: { $gte: dateRange.start, $lte: dateRange.end }
    })
    .sort({ created: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();
    
    // Get total count for pagination
    const totalDeliveries = await db.bookDelivery.countDocuments({
      "driver._id": driverId,
      status: '0',
      created: { $gte: dateRange.start, $lte: dateRange.end }
    });
    
    // Add payment calculations to each delivery
    const deliveriesWithPayments = deliveries.map(delivery => {
      const deliveryFee = delivery.order.shippingPrice || 0;
      const commission = calculateCommission(deliveryFee, 0.20);
      const earnings = deliveryFee - commission;
      
      return {
        ...delivery,
        deliveryFee,
        commission,
        earnings,
        paymentStatus: 'paid' // Completed deliveries are considered paid
      };
    });
    
    res.status(200).json({
      deliveries: deliveriesWithPayments,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalDeliveries / limit),
        totalDeliveries,
        hasNext: page * limit < totalDeliveries,
        hasPrev: page > 1
      }
    });
    
  } catch (error) {
    console.error("Error getting driver payment details:", error);
    res.status(500).json({ message: "Error getting payment details" });
  }
});

// 3. ADMIN PAYMENT ROUTES

// Get admin payment overview
router.post("/api/payments/admin/overview", async (req, res) => {
  try {
    const { period = 'month', startDate, endDate, storeId } = req.body;
    
    const dateRange = startDate && endDate 
      ? { start: moment(startDate).format(), end: moment(endDate).format() }
      : getDateRange(period);
    
    // Get stores list to determine app names
    const dbAdmin = req.app.db['shoofi'];
    const storesList = await dbAdmin.stores.find().toArray();
    
    let totalRevenue = 0;
    let totalOrders = 0;
    let totalDeliveries = 0;
    let totalCommission = 0;
    
    // Loop through stores to get app names
    for (const store of storesList) {
      const appName = store.appName;
      if (!appName || !req.app.db[appName]) {
        continue; // Skip if no appName or database doesn't exist
      }
      
      // If storeId is provided, only process that specific store
      if (storeId && store.appName !== storeId) {
        continue;
      }
      
      const db = req.app.db[appName];
      
      // Check if this is a delivery app or order app based on collections
      const collections = await db.listCollections().toArray();
      const collectionNames = collections.map(col => col.name);
      
      if (collectionNames.includes('orders')) {
        // This is an order app (like shoofi-app)
        const ordersQuery = {
          orderStatus: { $ne: "Cancelled" },
          orderDate: { $gte: dateRange.start, $lte: dateRange.end }
        };
        
        
        const orders = await db.orders.find(ordersQuery).toArray();
        
        totalOrders += orders.length;
        const appRevenue = orders.reduce((sum, order) => sum + (order.orderPrice || 0), 0);
        totalRevenue += appRevenue;
        totalCommission += calculateCommission(appRevenue);
      } else if (collectionNames.includes('bookDelivery')) {
        // This is a delivery app (like delivery-company)
        const deliveries = await db.bookDelivery.find({
          status: '0', // Completed deliveries
          created: { $gte: dateRange.start, $lte: dateRange.end }
        }).toArray();
        
        totalDeliveries += deliveries.length;
        const deliveryFees = deliveries.reduce((sum, delivery) => 
          sum + (delivery.price || 0), 0
        );
        totalRevenue += deliveryFees;
        totalCommission += calculateCommission(deliveryFees, 0.20);
      }
    }
    
    res.status(200).json({
      overview: {
        totalRevenue,
        totalOrders,
        totalDeliveries,
        totalCommission,
        netRevenue: totalRevenue - totalCommission,
        period: period,
        dateRange: {
          start: dateRange.start,
          end: dateRange.end
        }
      }
    });
    
  } catch (error) {
    console.error("Error getting admin payment overview:", error);
    res.status(500).json({ message: "Error getting payment overview" });
  }
});

// Get admin partner payments
router.post("/api/payments/admin/partners", async (req, res) => {
  try {
    const { period = 'month', startDate, endDate, storeId } = req.body;
    
    const dateRange = startDate && endDate 
      ? { start: moment(startDate).format(), end: moment(endDate).format() }
      : getDateRange(period);
    
    // Get stores list to find order apps
    const dbAdmin = req.app.db['shoofi'];
    const storesList = await dbAdmin.stores.find().toArray();
    
    let allPartnerPayments = [];
    
    // Loop through stores to find order apps
    for (const store of storesList) {
      const appName = store.appName;
      if (!appName || !req.app.db[appName]) {
        continue;
      }
      
      const db = req.app.db[appName];
      
      // Check if this app has orders collection
      const collections = await db.listCollections().toArray();
      const collectionNames = collections.map(col => col.name);
      
      if (collectionNames.includes('orders')) {
        // Build match condition
        const matchCondition = {
          orderStatus: { $ne: "Cancelled" },
          orderDate: { $gte: dateRange.start, $lte: dateRange.end }
        };
        
        // If filtering by specific store, add store filter
        if (storeId) {
          matchCondition["orderProducts.storeId"] = storeId;
        }
        
        // Aggregate partner payments for this app
        const partnerPayments = await db.orders.aggregate([
          {
            $match: matchCondition
          },
          {
            $unwind: "$orderProducts"
          },
          {
            $group: {
              _id: "$orderProducts.storeId",
              totalOrders: { $sum: 1 },
              totalRevenue: { $sum: "$orderPrice" },
              totalCommission: { $sum: { $multiply: ["$orderPrice", 0.15] } }
            }
          },
          {
            $project: {
              partnerId: "$_id",
              totalOrders: 1,
              totalRevenue: 1,
              totalCommission: 1,
              partnerEarnings: { $subtract: ["$totalRevenue", "$totalCommission"] }
            }
          },
          {
            $sort: { totalRevenue: -1 }
          }
        ]).toArray();
        
        // Add app name to each partner payment
        const partnerPaymentsWithApp = partnerPayments.map(payment => ({
          ...payment,
          appName: appName
        }));
        
        allPartnerPayments = allPartnerPayments.concat(partnerPaymentsWithApp);
      }
    }
    
    res.status(200).json(allPartnerPayments);
    
  } catch (error) {
    console.error("Error getting admin partner payments:", error);
    res.status(500).json({ message: "Error getting partner payments" });
  }
});

// Get admin driver payments
router.post("/api/payments/admin/drivers", async (req, res) => {
  try {
    const { period = 'month', startDate, endDate, storeId } = req.body;
    
    const dateRange = startDate && endDate 
      ? { start: moment(startDate).format(), end: moment(endDate).format() }
      : getDateRange(period);
    
    // Get stores list to find delivery apps
    const dbAdmin = req.app.db['shoofi'];
    const storesList = await dbAdmin.stores.find().toArray();
    
    let allDriverPayments = [];
    
    // Loop through stores to find delivery apps
    for (const store of storesList) {
      const appName = store.appName;
      if (!appName || !req.app.db[appName]) {
        continue;
      }
      
      const db = req.app.db[appName];
      
      // Check if this app has bookDelivery collection
      const collections = await db.listCollections().toArray();
      const collectionNames = collections.map(col => col.name);
      
            if (collectionNames.includes('bookDelivery')) {
        // Build match condition for deliveries
        const matchCondition = {
          status: '0', // Completed deliveries
          created: { $gte: dateRange.start, $lte: dateRange.end }
        };
        
        // If filtering by specific store, add store filter
        if (storeId) {
          matchCondition["storeId"] = storeId;
        }
        
        // Aggregate driver payments for this app
        const driverPayments = await db.bookDelivery.aggregate([
          {
            $match: matchCondition
          },
      {
        $group: {
          _id: "$driver._id",
          driverName: { $first: "$driver.fullName" },
          driverPhone: { $first: "$driver.phone" },
          totalDeliveries: { $sum: 1 },
          totalFees: { $sum: "$price" },
          totalCommission: { $sum: { $multiply: ["$price", 0.20] } }
        }
      },
      {
        $project: {
          driverId: "$_id",
          driverName: 1,
          driverPhone: 1,
          totalDeliveries: 1,
          totalFees: 1,
          totalCommission: 1,
          totalEarnings: { $subtract: ["$totalFees", "$totalCommission"] }
        }
      },
              {
          $sort: { totalEarnings: -1 }
        }
      ]).toArray();
      
      // Add app name to each driver payment
      const driverPaymentsWithApp = driverPayments.map(payment => ({
        ...payment,
        appName: appName
      }));
      
      allDriverPayments = allDriverPayments.concat(driverPaymentsWithApp);
    }
  }
  
  res.status(200).json(allDriverPayments);
    
  } catch (error) {
    console.error("Error getting admin driver payments:", error);
    res.status(500).json({ message: "Error getting driver payments" });
  }
});

// Get payment analytics for charts
router.post("/api/payments/admin/analytics", async (req, res) => {
  try {
    const { period = 'month', startDate, endDate, groupBy = 'day', storeId } = req.body;
    
    const dateRange = startDate && endDate 
      ? { start: moment(startDate).format(), end: moment(endDate).format() }
      : getDateRange(period);
    
    const format = groupBy === 'day' ? '%Y-%m-%d' : '%Y-%m';
    const dateField = groupBy === 'day' ? 'orderDate' : 'orderDate';
    
    // Get stores list to find apps
    const dbAdmin = req.app.db['shoofi'];
    const storesList = await dbAdmin.stores.find().toArray();
    
    let allOrderAnalytics = [];
    let allDeliveryAnalytics = [];
    
    // Loop through stores to find apps
    for (const store of storesList) {
      const appName = store.appName;
      if (!appName || !req.app.db[appName]) {
        continue;
      }
      
      const db = req.app.db[appName];
      
      // Check if this app has orders collection
      const collections = await db.listCollections().toArray();
      const collectionNames = collections.map(col => col.name);
      
      if (collectionNames.includes('orders')) {
        // Build match condition for orders
        const matchCondition = {
          orderStatus: { $ne: "Cancelled" },
          orderDate: { $gte: dateRange.start, $lte: dateRange.end }
        };
        
        // If filtering by specific store, add store filter
        if (storeId) {
          matchCondition["orderProducts.storeId"] = storeId;
        }
        
        // Get orders analytics for this app
        const orderAnalytics = await db.orders.aggregate([
          {
            $match: matchCondition
          },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: format,
                  date: { $dateFromString: { dateString: "$orderDate" } }
                }
              },
              orders: { $sum: 1 },
              revenue: { $sum: "$orderPrice" },
              commission: { $sum: { $multiply: ["$orderPrice", 0.15] } }
            }
          },
          {
            $sort: { _id: 1 }
          }
        ]).toArray();
        
        // Add app name to each analytics entry
        const orderAnalyticsWithApp = orderAnalytics.map(analytics => ({
          ...analytics,
          appName: appName
        }));
        
        allOrderAnalytics = allOrderAnalytics.concat(orderAnalyticsWithApp);
      } else if (collectionNames.includes('bookDelivery')) {
        // Build match condition for deliveries
        const matchCondition = {
          status: '0',
          created: { $gte: dateRange.start, $lte: dateRange.end }
        };
        
        // If filtering by specific store, add store filter
        if (storeId) {
          matchCondition["storeId"] = storeId;
        }
        
        // Get delivery analytics for this app
        const deliveryAnalytics = await db.bookDelivery.aggregate([
          {
            $match: matchCondition
          },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: format,
                  date: { $dateFromString: { dateString: "$created" } }
                }
              },
              deliveries: { $sum: 1 },
              fees: { $sum: "$price" },
              commission: { $sum: { $multiply: ["$price", 0.20] } }
            }
          },
          {
            $sort: { _id: 1 }
          }
        ]).toArray();
        
        // Add app name to each analytics entry
        const deliveryAnalyticsWithApp = deliveryAnalytics.map(analytics => ({
          ...analytics,
          appName: appName
        }));
        
        allDeliveryAnalytics = allDeliveryAnalytics.concat(deliveryAnalyticsWithApp);
      }
    }
    
    res.status(200).json({
      orderAnalytics: allOrderAnalytics,
      deliveryAnalytics: allDeliveryAnalytics
    });
    
  } catch (error) {
    console.error("Error getting payment analytics:", error);
    res.status(500).json({ message: "Error getting payment analytics" });
  }
});

module.exports = router; 