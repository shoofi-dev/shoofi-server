const express = require("express");
const moment = require("moment");
const router = express.Router();
const { getId } = require("../lib/common");
const { ObjectId } = require("mongodb");
const utcTimeService = require("../utils/utc-time");

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
  const offsetHours = utcTimeService.getUTCOffset();

  try {
    const { partnerId, period = 'month', startDate, endDate } = req.body;
    
    if (!partnerId) {
      return res.status(400).json({ message: "Partner ID is required" });
    }
    
    const dateRange = startDate && endDate 
      ? { 
          start: moment(startDate).startOf('day').utcOffset(offsetHours).format(), 
          end: moment(endDate).endOf('day').utcOffset(offsetHours).format() 
        }
      : getDateRange(period);
    
    // Get orders for this partner (excluding canceled orders)
    const orders = await db.orders.find({
      status: { $in: ["2","3","10","11","12"] },
      orderDate: { $gte: dateRange.start, $lte: dateRange.end }
    }).toArray();
    
    // Calculate totals
    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((sum, order) => sum + (order.orderPrice || 0), 0);
    const totalCommission = calculateCommission(totalRevenue);
    const partnerEarnings = totalRevenue - totalCommission;

    // Calculate revenue by payment method
    const totalRevenueCreditCard = orders
      .filter(order => order.order?.payment_method === 'CREDITCARD')
      .reduce((sum, order) => sum + (order.orderPrice || 0), 0);
    const totalRevenueCash = orders
      .filter(order => order.order?.payment_method === 'CASH')
      .reduce((sum, order) => sum + (order.orderPrice || 0), 0);
    const totalRevenueCreditCardCount = orders.filter(order => order.order?.payment_method === 'CREDITCARD').length;
    const totalRevenueCashCount = orders.filter(order => order.order?.payment_method === 'CASH').length;
    const totalRevenueCount = orders.length;
    
    // Group by date for charts
    const dailyData = orders.reduce((acc, order) => {
      const date = moment(order.orderDate).utcOffset(offsetHours).format('YYYY-MM-DD');
      if (!acc[date]) {
        acc[date] = {
          date,
          orders: 0,
          revenue: 0,
          commission: 0,
          earnings: 0,
          dailyRevenueCreditCard: 0,
          dailyRevenueCash: 0,
          dailyCountCreditCard: 0,
          dailyCountCash: 0
        };
      }
      acc[date].orders += 1;
      acc[date].revenue += (order.orderPrice || 0);
      acc[date].commission += calculateCommission(order.orderPrice || 0);
      acc[date].earnings += (order.orderPrice || 0) - calculateCommission(order.orderPrice || 0);
      if (order.order?.payment_method === 'CREDITCARD') {
        acc[date].dailyRevenueCreditCard += (order.orderPrice || 0);
        acc[date].dailyCountCreditCard += 1;
      }
      if (order.order?.payment_method === 'CASH') {
        acc[date].dailyRevenueCash += (order.orderPrice || 0);
        acc[date].dailyCountCash += 1;
      }
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
        totalRevenueCreditCard,
        totalRevenueCash,
        totalRevenueCount,
        totalRevenueCreditCardCount,
        totalRevenueCashCount,
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
      ? { 
          start: moment(startDate).startOf('day').format(), 
          end: moment(endDate).endOf('day').format() 
        }
      : getDateRange(period);
    
    const skip = (page - 1) * limit;
    
    // Get orders with pagination
    const orders = await db.orders.find({
      status: { $in: ["2","3","10","11","12"] },
      "orderProducts.storeId": partnerId,
      orderDate: { $gte: dateRange.start, $lte: dateRange.end }
    })
    .sort({ orderDate: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();
    
    // Get total count for pagination
    const totalOrders = await db.orders.countDocuments({
      status: { $in: ["2","3","10","11","12"] },
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
        paymentStatus: order.status === 'Paid' ? 'paid' : 'pending'
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
      ? { 
          start: moment(startDate).startOf('day').format(), 
          end: moment(endDate).endOf('day').format() 
        }
      : getDateRange(period);
    
    // Get completed deliveries for this driver
    const deliveries = await db.bookDelivery.find({
      "driver._id": ObjectId(driverId),
      status: '4', // Completed deliveries
      created: { $gte: dateRange.start, $lte: dateRange.end }
    }).toArray();
    
    // Calculate totals
    const totalDeliveries = deliveries.length;
    const totalDeliveryFees = deliveries.reduce((sum, delivery) => 
      sum + (Number(delivery.order.shippingPrice) || 0), 0
    );
    
    const totalEarnings = totalDeliveryFees; // Driver gets full delivery fee
    
    // Group by date for charts
    const dailyData = deliveries.reduce((acc, delivery) => {
      const date = moment(delivery.created).format('YYYY-MM-DD');
      if (!acc[date]) {
        acc[date] = {
          date,
          deliveries: 0,
          fees: 0,
          earnings: 0
        };
      }
      const deliveryFee = delivery.order.shippingPrice || 0;
      
      acc[date].deliveries += 1;
      acc[date].fees += deliveryFee;
      acc[date].earnings += deliveryFee;
      return acc;
    }, {});
    
    const dailyArray = Object.values(dailyData).sort((a, b) => 
      moment(a.date).diff(moment(b.date))
    );
    
    res.status(200).json({
      summary: {
        totalDeliveries,
        totalDeliveryFees,
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
      ? { 
          start: moment(startDate).startOf('day').format(), 
          end: moment(endDate).endOf('day').format() 
        }
      : getDateRange(period);
    
    const skip = (page - 1) * limit;
    
    // Get completed deliveries with pagination
    const deliveries = await db.bookDelivery.find({
      "driver._id": ObjectId(driverId),
      status: '4', // Completed deliveries
      created: { $gte: dateRange.start, $lte: dateRange.end }
    })
    .sort({ created: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();
    
    console.log(`Found ${deliveries.length} deliveries for driver ${driverId}`);
    console.log('Date range:', dateRange);
    if (deliveries.length > 0) {
      console.log('Sample delivery structure:', JSON.stringify(deliveries[0], null, 2));
    }
    
    // Get total count for pagination
    const totalDeliveries = await db.bookDelivery.countDocuments({
      "driver._id": ObjectId(driverId),
      status: '4',
      created: { $gte: dateRange.start, $lte: dateRange.end }
    });
    
    // Add payment calculations to each delivery
    const deliveriesWithPayments = deliveries.map(delivery => {
      const deliveryFee = delivery.order.shippingPrice || 0;
      
      // Calculate actual driver payment considering coupons and payment method
      const actualDriverPayment = (() => {
        if (delivery.order.appliedCoupon && 
            delivery.order.appliedCoupon.coupon.type === "free_delivery" &&
            delivery.order.order.payment_method === "CASH") {
          // For cash payments with free_delivery coupon: driver gets discountAmount from us
          return delivery.order.appliedCoupon.discountAmount || 0;
        } else if (delivery.order.order.payment_method === "CREDITCARD") {
          // For credit card payments: driver gets full shippingPrice from us
          return deliveryFee;
        } else {
          // For cash payments without coupon: driver gets 0 from us (gets full amount from customer)
          return 0;
        }
      })();
      
      return {
        ...delivery,
        deliveryFee,
        earnings: deliveryFee,
        actualDriverPayment,
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
      ? { 
          start: moment(startDate).startOf('day').format(), 
          end: moment(endDate).endOf('day').format() 
        }
      : getDateRange(period);
    
    // Get stores list to determine app names
    const dbAdmin = req.app.db['shoofi'];
    const storesList = await dbAdmin.stores.find().toArray();
    
    let totalRevenue = 0;
    let totalOrders = 0;
    let totalDeliveries = 0;
    let totalCommission = 0;
    let totalRevenueCreditCard = 0;
    let totalRevenueCash = 0;
    let totalRevenueCreditCardCount = 0;
    let totalRevenueCashCount = 0;
    let totalRevenueCount = 0;
    
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
          status: { $in: ["2","3","10","11","12"] },
          orderDate: { $gte: dateRange.start, $lte: dateRange.end }
        };
        
        const orders = await db.orders.find(ordersQuery).toArray();
        
        totalOrders += orders.length;
        const appRevenue = orders.reduce((sum, order) => sum + (order.orderPrice || 0), 0);
        totalRevenue += appRevenue;
        totalCommission += calculateCommission(appRevenue);
        
        // Calculate revenue by payment method for orders
        const appRevenueCreditCard = orders
          .filter(order => order.order?.payment_method === 'CREDITCARD')
          .reduce((sum, order) => sum + (order.orderPrice || 0), 0);
        const appRevenueCash = orders
          .filter(order => order.order?.payment_method === 'CASH')
          .reduce((sum, order) => sum + (order.orderPrice || 0), 0);
        const appRevenueCreditCardCount = orders.filter(order => order.order?.payment_method === 'CREDITCARD').length;
        const appRevenueCashCount = orders.filter(order => order.order?.payment_method === 'CASH').length;
        
        totalRevenueCreditCard += appRevenueCreditCard;
        totalRevenueCash += appRevenueCash;
        totalRevenueCreditCardCount += appRevenueCreditCardCount;
        totalRevenueCashCount += appRevenueCashCount;
        totalRevenueCount += orders.length;
      }
        // This is a delivery app (like delivery-company)
        const deliveryDb = req.app.db['delivery-company'];

        const deliveries = await deliveryDb.bookDelivery.find({
          status: '4', // Completed deliveries
          appName: appName,
          created: { $gte: dateRange.start, $lte: dateRange.end }
        }).toArray();
        
        totalDeliveries += deliveries.length;
        const deliveryFees = deliveries.reduce((sum, delivery) => 
          sum + (delivery.price || 0), 0
        );
        // totalRevenue += deliveryFees;
        totalCommission += calculateCommission(deliveryFees, 0.20);
        
        // For deliveries, we typically don't have payment method split as they're usually cash on delivery
        // But we can add it if the delivery data has payment method information
        const deliveryRevenueCreditCard = deliveries
          .filter(delivery => delivery.paymentMethod === 'CREDITCARD')
          .reduce((sum, delivery) => sum + (delivery.price || 0), 0);
        const deliveryRevenueCash = deliveries
          .filter(delivery => delivery.paymentMethod === 'CASH')
          .reduce((sum, delivery) => sum + (delivery.price || 0), 0);
        const deliveryRevenueCreditCardCount = deliveries.filter(delivery => delivery.paymentMethod === 'CREDITCARD').length;
        const deliveryRevenueCashCount = deliveries.filter(delivery => delivery.paymentMethod === 'CASH').length;
        
        totalRevenueCreditCard += deliveryRevenueCreditCard;
        totalRevenueCash += deliveryRevenueCash;
        totalRevenueCreditCardCount += deliveryRevenueCreditCardCount;
        totalRevenueCashCount += deliveryRevenueCashCount;
        totalRevenueCount += deliveries.length;
    }
    
    res.status(200).json({
      overview: {
        totalRevenue,
        totalOrders,
        totalDeliveries,
        totalCommission,
        netRevenue: totalRevenue - totalCommission,
        totalRevenueCreditCard,
        totalRevenueCash,
        totalRevenueCount,
        totalRevenueCreditCardCount,
        totalRevenueCashCount,
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
      ? { 
          start: moment(startDate).startOf('day').format(), 
          end: moment(endDate).endOf('day').format() 
        }
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
          status: { $in: ["2","3","10","11","12"] },
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

// Get delivery companies list
router.get("/api/payments/delivery-companies", async (req, res) => {
  try {
    const db = req.app.db['delivery-company'];
    
    if (!db) {
      return res.status(500).json({ message: "Delivery company database not found" });
    }
    
    // Get delivery companies from store collection
    const deliveryCompanies = await db.store.find({
      status: true
    }, {
      projection: {
        _id: 1,
        nameAR: 1,
        nameHE: 1,
        phone: 1,
        status: 1
      }
    }).sort({ nameHE: 1 }).toArray();
    
    res.status(200).json(deliveryCompanies);
    
  } catch (error) {
    console.error("Error getting delivery companies:", error);
    res.status(500).json({ message: "Error getting delivery companies" });
  }
});

// Get drivers for a specific delivery company
router.post("/api/payments/delivery-company-drivers", async (req, res) => {
  try {
    const { deliveryCompanyId } = req.body;
    
    if (!deliveryCompanyId) {
      return res.status(400).json({ message: "Delivery company ID is required" });
    }
    
    const db = req.app.db['delivery-company'];
    
    if (!db) {
      return res.status(500).json({ message: "Delivery company database not found" });
    }
    
    // Get drivers for the specific delivery company from customers collection
    const drivers = await db.customers.find({
      role: "driver",
      companyId: deliveryCompanyId,
    }, {
      projection: {
        _id: 1,
        fullName: 1,
        phone: 1,
        companyId: 1
      }
    }).sort({ fullName: 1 }).toArray();
    
    res.status(200).json(drivers);
    
  } catch (error) {
    console.error("Error getting delivery company drivers:", error);
    res.status(500).json({ message: "Error getting delivery company drivers" });
  }
});

// Get admin driver payments
router.post("/api/payments/admin/drivers", async (req, res) => {
  try {
    const { period = 'month', startDate, endDate, deliveryCompanyId, driverId } = req.body;
    
    const dateRange = startDate && endDate 
      ? { 
          start: moment(startDate).startOf('day').format(), 
          end: moment(endDate).endOf('day').format() 
        }
      : getDateRange(period);
    
    // Use delivery-company database directly
    const db = req.app.db['delivery-company'];
    
    if (!db) {
      return res.status(500).json({ message: "Delivery company database not found" });
    }
    
    // Build match condition for deliveries
    const matchCondition = {
      status: '4', // Completed deliveries
      created: { $gte: dateRange.start, $lte: dateRange.end }
    };
    
    // If filtering by specific delivery company, add company filter
    if (deliveryCompanyId) {
      matchCondition["driver.companyId"] = deliveryCompanyId;
    }
    
    // If filtering by specific driver, add driver filter
    if (driverId) {
      matchCondition["driver._id"] = ObjectId(driverId);
    }
    
    // Aggregate driver payments from bookDelivery collection
    const driverPayments = await db.bookDelivery.aggregate([
      {
        $match: matchCondition
      },
      {
        $addFields: {
          // Calculate actual driver payment considering coupons and payment method
          actualDriverPayment: {
            $cond: [
              {
                $and: [
                  { $ifNull: ["$order.appliedCoupon", false] },
                  { $eq: ["$order.appliedCoupon.coupon.type", "free_delivery"] },
                  { $eq: ["$order.order.payment_method", "CASH"] }
                ]
              },
              // For cash payments with free_delivery coupon: driver gets discountAmount from us
              { $ifNull: ["$order.appliedCoupon.discountAmount", 0] },
              // For credit card payments: driver gets full shippingPrice from us
              {
                $cond: [
                  { $eq: ["$order.order.payment_method", "CREDITCARD"] },
                  "$order.shippingPrice",
                  // For cash payments without coupon: driver gets 0 from us (gets full amount from customer)
                  0
                ]
              }
            ]
          }
        }
      },
      {
        $group: {
          _id: "$driver._id",
          driverName: { $first: "$driver.fullName" },
          driverPhone: { $first: "$driver.phone" },
          deliveryCompanyId: { $first: "$driver.companyId" },
          totalDeliveries: { $sum: 1 },
          totalFees: { $sum: "$order.shippingPrice" },
          totalCommission: { $sum: 0 },
          // Original earnings (without coupon consideration)
          earningsByCreditCard: {
            $sum: {
              $cond: [
                { $eq: ["$order.order.payment_method", "CREDITCARD"] },
                "$order.shippingPrice",
                0
              ]
            }
          },
          earningsByCash: {
            $sum: {
              $cond: [
                { $eq: ["$order.order.payment_method", "CASH"] },
                "$order.shippingPrice",
                0
              ]
            }
          },
          // Actual driver payments (with coupon consideration)
          actualTotalEarnings: { $sum: "$actualDriverPayment" },
          actualEarningsByCreditCard: {
            $sum: {
              $cond: [
                { $eq: ["$order.order.payment_method", "CREDITCARD"] },
                "$actualDriverPayment",
                0
              ]
            }
          },
          actualEarningsByCash: {
            $sum: {
              $cond: [
                { $eq: ["$order.order.payment_method", "CASH"] },
                "$actualDriverPayment",
                0
              ]
            }
          }
        }
      },
      {
        $project: {
          driverId: "$_id",
          driverName: 1,
          driverPhone: 1,
          deliveryCompanyId: 1,
          totalDeliveries: 1,
          totalFees: 1,
          totalCommission: 1,
          totalEarnings: "$totalFees",
          earningsByCreditCard: 1,
          earningsByCash: 1,
          actualTotalEarnings: 1,
          actualEarningsByCreditCard: 1,
          actualEarningsByCash: 1
        }
      },
      {
        $sort: { totalEarnings: -1 }
      }
    ]).toArray();
    
    // Add app name to each driver payment (all from delivery-company)
    const driverPaymentsWithApp = driverPayments.map(payment => ({
      ...payment,
      appName: 'delivery-company'
    }));
    
    res.status(200).json(driverPaymentsWithApp);
    
  } catch (error) {
    console.error("Error getting admin driver payments:", error);
    res.status(500).json({ message: "Error getting driver payments" });
  }
});

// Get payment analytics for charts
router.post("/api/payments/admin/analytics", async (req, res) => {
  try {
    const { period = 'month', startDate, endDate, groupBy = 'day', deliveryCompanyId, driverId } = req.body;
    
    const dateRange = startDate && endDate 
      ? { 
          start: moment(startDate).startOf('day').format(), 
          end: moment(endDate).endOf('day').format() 
        }
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
          status: { $in: ["2","3","10","11","12"] },
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
      }
    }
    
    // Get delivery analytics from delivery-company database specifically
    const deliveryDb = req.app.db['delivery-company'];
    if (deliveryDb) {
      // Build match condition for deliveries
      const deliveryMatchCondition = {
        status: '4',
        created: { $gte: dateRange.start, $lte: dateRange.end }
      };
      
      // If filtering by specific delivery company, add company filter
      if (deliveryCompanyId) {
        deliveryMatchCondition["driver.companyId"] = deliveryCompanyId;
      }
      
      // If filtering by specific driver, add driver filter
      if (driverId) {
        deliveryMatchCondition["driver._id"] = ObjectId(driverId);
      }
      
      // Get delivery analytics from bookDelivery collection
      const deliveryAnalytics = await deliveryDb.bookDelivery.aggregate([
        {
          $match: deliveryMatchCondition
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
            commission: { $sum: 0 }
          }
        },
        {
          $sort: { _id: 1 }
        }
      ]).toArray();
      
      // Add app name to each analytics entry
      const deliveryAnalyticsWithApp = deliveryAnalytics.map(analytics => ({
        ...analytics,
        appName: 'delivery-company'
      }));
      
      allDeliveryAnalytics = allDeliveryAnalytics.concat(deliveryAnalyticsWithApp);
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