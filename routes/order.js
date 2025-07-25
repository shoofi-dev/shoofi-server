const express = require("express");
const auth = require("./auth");
const orderid = require("order-id")("key");
const websockets = require("../utils/websockets");
const smsService = require("../utils/sms");
const storeService = require("../utils/store-service");
const pushNotification = require("../utils/push-notification");
const invoiceMailService = require("../utils/invoice-mail");
const imagesService = require("../utils/images-service");
const notificationService = require("../services/notification/notification-service");
const persistentAlertsService = require("../utils/persistent-alerts");
var multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });
const turl = require("turl");
var QRCode = require("qrcode");
const axios = require("axios");
const momentTZ = require("moment-timezone");
const { getCustomerAppName } = require("../utils/app-name-helper");

// Redis utility for order duplication prevention
let redisClient = null;
// In-memory fallback for order duplication prevention
const orderCreationLocks = new Map(); // customerId -> timestamp

try {
  const Redis = require('ioredis');
  const redisOptions = {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD,
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    connectTimeout: 5000,
    commandTimeout: 3000,
    enableOfflineQueue: false
  };
  if (process.env.REDIS_URL) {
    const url = new URL(process.env.REDIS_URL);
    redisOptions.host = url.hostname;
    redisOptions.port = url.port ? parseInt(url.port, 10) : 6379;
    redisOptions.username = url.username || undefined;
    redisOptions.password = url.password || undefined;
    redisOptions.tls = url.protocol === 'rediss:' ? {} : undefined;
  }
  redisClient = new Redis(redisOptions);
  redisClient.on('error', (error) => {
    console.warn('Redis connection error for order duplication prevention:', error.message);
    redisClient = null;
  });
  redisClient.on('connect', () => {
    console.log('✅ Redis connected for order duplication prevention');
  });
} catch (error) {
  console.warn('Redis not available for order duplication prevention:', error.message);
}

// Clean up old in-memory locks every 5 minutes
setInterval(() => {
  const now = Date.now();
  const lockTimeout = 10 * 1000; // 10 seconds
  for (const [customerId, timestamp] of orderCreationLocks.entries()) {
    if (now - timestamp > lockTimeout) {
      orderCreationLocks.delete(customerId);
    }
  }
}, 5 * 60 * 1000); // 5 minutes

const { clearSessionValue, getId } = require("../lib/common");
const { paginateData } = require("../lib/paginate");
const { restrict, checkAccess } = require("../lib/auth");
const { indexOrders } = require("../lib/indexing");
const moment = require("moment");
const router = express.Router();
const deliveryService = require("../services/delivery/book-delivery");
const websocketService = require('../services/websocket/websocket-service');
const generateUniqueOrderId = () => {
  const timestamp = Date.now();
  const randomKey = Math.random().toString(36).substring(2, 8);
  const orderid = require("order-id")(`${timestamp}-${randomKey}`);
  return orderid.generate();
};
// Helper function to process credit card payment
const processCreditCardPayment = async (paymentData, orderDoc, req, customerName) => {
  const shoofiDB = req.app.db["shoofi"];
  const shoofiStoreData = await shoofiDB.store.findOne({ id: 1 });

  if (!shoofiStoreData?.credentials) {
    throw new Error("Payment credentials not configured");
  }

  const zdCreditCredentials = shoofiStoreData.credentials;

  // Prepare payment payload
  const paymentPayload = {
    TerminalNumber: zdCreditCredentials.credentials_terminal_number,
    Password: zdCreditCredentials.credentials_password,
    CardNumber: paymentData.ccToken,
    TransactionSum: orderDoc.total,
    ExtraData: orderDoc.orderId?.toString(),
    HolderID: paymentData?.id || '',
    CVV: paymentData.cvv,
    PhoneNumber: paymentData.phone,
    CustomerEmail: paymentData.email || "shoofi.dev@gmail.com",
    ZCreditInvoiceReceipt: {
      Type: "0",
      RecepientName: customerName,
      RecepientCompanyID: "",
      Address: "",
      City: "",
      ZipCode: "",
      PhoneNum: paymentData.phone,
      FaxNum: "",
      TaxRate: "17",
      Comment: "",
      ReceipientEmail: "customerinvoices@shoofi.app",
      EmailDocumentToReceipient: true,
      ReturnDocumentInResponse: "",
      Items: [{
        ItemDescription: `מוצר - ${orderDoc.orderId?.toString()}`,
        ItemQuantity: "1",
        ItemPrice: orderDoc.total?.toString(),
        IsTaxFree: "false"
      }]
    }
  };

  try {
    const response = await axios.post(
      "https://pci.zcredit.co.il/ZCreditWS/api/Transaction/CommitFullTransaction",
      paymentPayload
    );

    const paymentResult = response.data;

    if (paymentResult.HasError) {
      return {
        success: false,
        error: paymentResult.ReturnMessage || "Payment failed",
        paymentData: {
          payload: paymentPayload,
          data: paymentResult,
          status: "failed",
        },
      };
    }

    return {
      success: true,
      paymentData: {
        payload: paymentPayload,
        data: paymentResult,
        ReferenceNumber: paymentResult.ReferenceNumber,
        ZCreditInvoiceReceiptResponse:
          paymentResult.ZCreditInvoiceReceiptResponse,
        ZCreditChargeResponse: paymentResult,
        status: "success",
      },
    };
  } catch (error) {
    console.error("Payment processing error:", error);
    return {
      success: false,
      error: error.message || "Payment processing failed",
      paymentData: {
        payload: paymentPayload,
        error: error.message,
        status: "error",
      },
    };
  }
};

// Helper function to send notifications to store owners
const sendStoreOwnerNotifications = async (orderDoc, req, appName) => {
  try {
    // Get store owners/users who have access to this app
    const shoofiDB = req.app.db['shoofi'];
    const storeUsers = await shoofiDB.storeUsers.find({
      appName: appName,
    }).toArray();

    if (storeUsers.length === 0) {
      console.log(`No store users found for app: ${appName}`);
      return;
    }

    // Send persistent alert for the new order (this handles all notifications to store managers)
    try {
      await persistentAlertsService.sendPersistentAlert(orderDoc, req, appName);
      console.log(`Sent persistent alerts to ${storeUsers.length} store users for app: ${appName}`);
    } catch (error) {
      console.error("Failed to send persistent alert:", error);
      // Don't fail the entire function if persistent alert fails
    }
  } catch (error) {
    console.error("Failed to send store owner notifications:", error);
  }
};

// Helper function to send order notifications to customer
const sendOrderNotifications = async (orderDoc, req, appName) => {
  const customerDB = getCustomerAppName(req, appName);
  const customer = await customerDB.customers.findOne({
    _id: getId(orderDoc.customerId),
  });

  if (!customer) {
    console.error("Customer not found for notifications");
    return;
  }

  // Prepare notification content
  const notificationTitle = "تم استلام طلبك";
  const notificationBody = smsService.getOrderRecivedContent(
    customer.fullName,
    orderDoc.total,
    orderDoc.order.receipt_method,
    orderDoc.orderId,
    orderDoc.app_language
  );

  // Send notification to customer using notification service
  try {
    await notificationService.sendNotification({
      recipientId: orderDoc.customerId,
      title: notificationTitle,
      body: notificationBody,
      type: 'order',
      appName,
      appType:  'shoofi-shopping',
      channels: {
        websocket: true,
        push: true,
        email: false,
        sms: true
      },
      data: {
        orderId: orderDoc.orderId,
        orderStatus: orderDoc.status,
        receiptMethod: orderDoc.order.receipt_method,
        total: orderDoc.total
      },
      req,
      soundType: 'customer.wav'
    });
  } catch (error) {
    console.error("Failed to send notification to customer:", error);
  }

  // Send SMS to admin number (keeping existing functionality)
  // try {
  //   await smsService.sendSMS("0542454362", notificationBody, req);
  // } catch (error) {
  //   console.error("Failed to send SMS to admin:", error);
  // }

  // Fire websocket event for admin (keeping existing functionality)
  // websockets.fireWebscoketEvent({
  //   type: "new order",
  //   customerIds: [orderDoc.customerId],
  //   isAdmin: true,
  //   appName,
  // });

  // Send WebSocket notification to store users to refresh unviewed orders count
  websocketService.sendToAppAdmins('shoofi-partner', {
    type: 'unviewed_orders_updated',
    data: {
      orderId: orderDoc._id,
      action: 'new_order',
      timestamp: new Date().toISOString()
    },
  },appName);
};

const generateQR = async (latitude, longitude) => {
  try {
    const qrCodeURI = await QRCode.toDataURL(
      `https://www.waze.com/ul?ll=${latitude},${longitude}&navigate=yes&zoom=17`
    );
    return qrCodeURI;
  } catch (err) {
    console.error(err);
  }
};

const getUTCOffset = () => {
  const israelTimezone = "Asia/Jerusalem";

  // Get the current time in UTC
  const utcTime = moment.utc();

  // Get the current time in Israel timezone
  const israelTime = momentTZ.tz(israelTimezone);

  // Get the UTC offset in minutes for Israel
  const israelOffsetMinutes = israelTime.utcOffset();

  // Convert the offset to hours
  return israelOffsetMinutes;
};

// Helper function to get business day boundaries considering overnight hours
const getBusinessDayBoundaries = async (targetDate, req, appName) => {
  try {
    const offsetHours = getUTCOffset();
    const db = req.app.db[appName];
    
    // Get store data to check opening hours
    const store = await db.store.findOne({ id: 1 });
    const openHours = store?.openHours;
    
    if (!openHours) {
      // Fallback to simple day boundaries if no openHours configured
      const start = moment(targetDate).utcOffset(offsetHours);
      start.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });

      const end = moment(targetDate).utcOffset(offsetHours);
      end.set({ hour: 23, minute: 59, second: 59, millisecond: 999 });
      
      return { start, end };
    }

    const days = [
      "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"
    ];
    
    // Get the day of week for the target date
    const targetDay = moment(targetDate).utcOffset(offsetHours);
    const dayIdx = targetDay.day();
    const dayName = days[dayIdx];
    
    // Get the previous day
    const prevDayIdx = (dayIdx + 6) % 7;
    const prevDayName = days[prevDayIdx];
    
    const todayHours = openHours[dayName];
    const yesterdayHours = openHours[prevDayName];
    
    // Helper to parse time
    function parseTime(str, baseDate) {
      const [h, m] = str.split(":").map(Number);
      const d = moment(baseDate).utcOffset(offsetHours);
      d.hours(h).minutes(m).seconds(0).milliseconds(0);
      return d;
    }
    
    // Helper to convert time string to minutes for comparison
    function timeToMinutes(timeStr) {
      const [h, m] = timeStr.split(":").map(Number);
      return h * 60 + m;
    }
    
    // Helper to get current time in minutes
    function getCurrentTimeMinutes() {
      const now = moment().utcOffset(offsetHours);
      return now.hours() * 60 + now.minutes();
    }
    
    let businessStart, businessEnd;
    
    // Debug logging
    console.log('=== Business Day Boundaries Debug ===');
    console.log('Target date:', targetDate);
    console.log('Target day:', dayName);
    console.log('Today hours:', todayHours);
    console.log('Yesterday hours:', yesterdayHours);
    console.log('Current time minutes:', getCurrentTimeMinutes());
    console.log('Today start minutes:', todayHours ? timeToMinutes(todayHours.start) : 'N/A');
    console.log('Today end minutes:', todayHours ? timeToMinutes(todayHours.end) : 'N/A');
    console.log('Yesterday start minutes:', yesterdayHours ? timeToMinutes(yesterdayHours.start) : 'N/A');
    console.log('Yesterday end minutes:', yesterdayHours ? timeToMinutes(yesterdayHours.end) : 'N/A');
    
    // Check if yesterday had overnight hours and we're still within that business day
    if (yesterdayHours && yesterdayHours.isOpen && timeToMinutes(yesterdayHours.end) < timeToMinutes(yesterdayHours.start)) {
      const currentTimeMinutes = getCurrentTimeMinutes();
      const yesterdayEndMinutes = timeToMinutes(yesterdayHours.end);
      
      // If current time is before yesterday's end time (overnight), use yesterday's business day
      if (currentTimeMinutes < yesterdayEndMinutes) {
        console.log('Using yesterday overnight hours logic - still within yesterday business day');
        businessStart = parseTime(yesterdayHours.start, targetDay.clone().subtract(1, 'day'));
        businessEnd = parseTime(yesterdayHours.end, targetDay);
        console.log('Final businessStart:', businessStart.format());
        console.log('Final businessEnd:', businessEnd.format());
        console.log('=== End Debug ===');
        return { start: businessStart, end: businessEnd };
      }
    }
    
    // Check if today has overnight hours (end < start)
    if (todayHours && todayHours.isOpen && timeToMinutes(todayHours.end) < timeToMinutes(todayHours.start)) {
      console.log('Using today overnight hours logic');
      // Today has overnight hours, so business day starts today and ends tomorrow
      businessStart = parseTime(todayHours.start, targetDay);
      businessEnd = parseTime(todayHours.end, targetDay.clone().add(1, 'day'));
    } else if (todayHours && todayHours.isOpen) {
      console.log('Using normal today hours logic');
      // Normal same-day hours
      businessStart = parseTime(todayHours.start, targetDay);
      businessEnd = parseTime(todayHours.end, targetDay);
    } else {
      console.log('Using fallback day boundaries');
      // Store is closed today, use simple day boundaries
      businessStart = moment(targetDate).utcOffset(offsetHours);
      businessStart.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });

      businessEnd = moment(targetDate).utcOffset(offsetHours);
      businessEnd.set({ hour: 23, minute: 59, second: 59, millisecond: 999 });
    }
    
    console.log('Final businessStart:', businessStart.format());
    console.log('Final businessEnd:', businessEnd.format());
    console.log('=== End Debug ===');
    
    return { start: businessStart, end: businessEnd };
  } catch (error) {
    console.error('Error in getBusinessDayBoundaries:', error);
    // Fallback to simple day boundaries on error
    const offsetHours = getUTCOffset();
    const start = moment(targetDate).utcOffset(offsetHours);
    start.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });

    const end = moment(targetDate).utcOffset(offsetHours);
    end.set({ hour: 23, minute: 59, second: 59, millisecond: 999 });
    
    return { start, end };
  }
};

// Show orders
router.post(
  "/api/order/admin/orders/:page?",
  auth.required,
  async (req, res, next) => {
    const appName = req.headers["app-name"];
    const db = req.app.db[appName];
    let finalOrders = [];

    let pageNum = 1;
    if (req.body.pageNumber) {
      pageNum = req.body.pageNumber;
    }

    let statusList = ["1", "2", "3", "4", "5","6"];
    if (req.body.statusList) {
      statusList = req.body.statusList;
    }
    let ordersDate = null;
    if (req.body.ordersDate) {
      ordersDate = req.body.ordersDate;
    }
    let filterBy = {
      status: { $in: statusList },
    };
    const offsetHours = getUTCOffset();
    let statusCount = [];
    if (ordersDate) {
      // Use business day boundaries that handle overnight hours
      const { start, end } = await getBusinessDayBoundaries(ordersDate, req, appName);
      
      // filterBy["$or"] = [
      //   { orderDate: { $gte: start.format(), $lt: end.format() } },
      //   { datetime: { $gte: start.format(), $lt: end.format() } },
      // ];
      if (req.body.isOrderLaterSupport) {
        filterBy = {
          ...filterBy,
          orderDate: { $gte: start.format(), $lt: end.format() },
        };
      } else {
        filterBy = {
          ...filterBy,
          datetime: { $gte: start.format(), $lt: end.format() },
        };
      }

      if (req.body.isOrderLaterSupport) {
        statusCount = await db.orders
          .aggregate([
            {
              $match: {
                orderDate: {
                  $gte: start.format(),
                  $lt: end.format(),
                },
                isViewd: true,
              },
            },
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
              },
            },
          ])
          .toArray();
      } else {
        statusCount = await db.orders
          .aggregate([
            {
              $match: {
                datetime: {
                  $gte: start.format(),
                  $lt: end.format(),
                },
                isViewd: true,
              },
            },
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
              },
            },
          ])
          .toArray();
      }
    }
    if (req.body.isNotPrinted) {
      filterBy.isPrinted = false;
    }

    if (!req.body.isViewd) {
      filterBy.isViewd = true;
    }

    if (req.body.isNotViewd) {
      filterBy.isViewd = true;
    }

    let oderDirecton = 1;
    if (req.body.oderDirecton != undefined) {
      oderDirecton = req.body.oderDirecton;
    }
    console.log("=========filterBy=========", filterBy)
    // Get our paginated data
    const orders = await paginateData(true, req, pageNum, "orders", filterBy, {
      orderDate: oderDirecton,
    });
    // orders?.data?.forEach(async (order)=>{
    for (const order of orders?.data) {
      const customerDB = getCustomerAppName(req, appName);
      const customer = await customerDB.customers.findOne({
        _id: getId(order.customerId),
      });
      // const dataUri = await textToImage.generate(customer.fullName, {
      //   maxWidth: 200,
      //   textAlign: "center",
      // });
      finalOrders.push({
        ...order,
        customerDetails: {
          name: customer?.fullName || order?.name,
          phone: customer?.phone || order?.phone,
          branchId: order?.branchId,
          // recipetName: dataUri,
        },
      });
    }
    // If API request, return json
    // if(req.apiAuthenticated){
    res
      .status(200)
      .json({
        ordersList: finalOrders,
        totalItems: orders?.totalItems,
        statusCount,
      });
    // }
  }
);

router.get("/api/order/admin/not-printed", async (req, res, next) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  let finalOrders = [];

  finalOrders = await db.orders
    .find({
      isPrinted: false,
    })
    .toArray();

  res.status(200).json(finalOrders);
});

router.get("/api/order/admin/not-viewd", async (req, res, next) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];

  const orders = await db.orders
    .find({
      isViewd: false,
      status: "6",
    })
    .toArray();
  const finalOrders = [];
  for (const order of orders) {
    const customerDB = getCustomerAppName(req, appName);
    const customer = await customerDB.customers.findOne({
      _id: getId(order.customerId),
    });
    if (customer) {
      finalOrders.push({
        ...order,
        customerDetails: {
          name: customer.fullName,
          phone: customer.phone,
        },
      });
    }
  }

  res.status(200).json(finalOrders);
});

router.get("/api/order/admin/all/not-viewd",auth.required, async (req, res, next) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];

  const orders = await db.orders
    .find({
      isViewdAdminAll: false,
      status: "6",
    })
    .toArray();
  const finalOrders = [];
  for (const order of orders) {
    const customerDB = getCustomerAppName(req, appName);
    const customer = await customerDB.customers.findOne({
      _id: getId(order.customerId),
    });
    finalOrders.push({
      ...order,
      customerDetails: {
        name: customer?.fullName || order?.name,
        phone: customer?.phone || order?.phone,
        branchId: order?.branchId,
      },
    });
  }

  res.status(200).json(finalOrders);
});

router.get(
  "/api/order/customer-invoices",
  auth.required,
  async (req, res, next) => {
    const appName = req.headers["app-name"];
    const db = req.app.db[appName];
    const customerId = req.auth.id;

    const orders = await db.orders
      .find({
        customerId: customerId,
        "order.payment_method": "CREDITCARD",
      })
      .toArray();
    res.status(200).json(orders);
  }
);

// router.get(
//   "/api/order/customer-orders",
//   auth.required,
//   async (req, res, next) => {
//     const appName = req.headers['app-name'];
//     const db = req.app.db[appName];
//     const customerId = req.auth.id;
//     const offsetHours = getUTCOffset();
//     var start = moment(new Date()).subtract(1, "days").utcOffset(offsetHours);
//     start.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });

//     var end = moment(new Date()).add(1, "days").utcOffset(offsetHours);
//     end.set({ hour: 23, minute: 59, second: 59, millisecond: 999 });

//     const orders = await paginateData(
//       true,
//       req,
//       1,
//       "orders",
//       {
//         customerId,
//         orderDate: { $gte: start.format(), $lt: end.format() },
//       },
//       { created: -1 }
//     );
//     res.status(200).json(orders.data);
//   }
// );

router.get("/api/order/customer-orders", auth.required, async (req, res) => {
  const customerId = req.auth.id;
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const customerDB = getCustomerAppName(req, appName);

  try {
    const customer = await customerDB.customers.findOne({
      _id: getId(customerId),
    });
    if (!customer) {
      res.status(400).json({
        message: "Customer not found",
      });
      return;
    }

    if (!customer.orders || !customer.orders.length) {
      res.status(200).json([]);
      return;
    }

    // Group orders by their database
    const ordersByAppName = {};
    customer.orders.forEach((order) => {
      const appNameTmp = order.appName || appName; // Use the order's db if specified, otherwise use current app
      if (!ordersByAppName[appNameTmp]) {
        ordersByAppName[appNameTmp] = [];
      }
      ordersByAppName[appNameTmp].push(order.appName ? order.orderId : order);
    });

    const offsetHours = getUTCOffset();
    var start = moment(new Date()).subtract(1, "days").utcOffset(offsetHours);
    start.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });

    var end = moment(new Date()).add(1, "days").utcOffset(offsetHours);
    end.set({ hour: 23, minute: 59, second: 59, millisecond: 999 });

    // Fetch orders from each database
    const allOrders = [];
    for (const [dbName, orderIds] of Object.entries(ordersByAppName)) {
      const currentDb = req.app.db[dbName];
      const oids = orderIds.map((id) => getId(id));

      const orders = await paginateData(
        true,
        req,
        1,
        "orders",
        {
          _id: { $in: oids },
          orderDate: { $gte: start.format(), $lt: end.format() },
        },
        { created: -1 },
        currentDb // Pass the current database to paginateData
      );

      allOrders.push(...orders.data);
    }

    // Sort all orders by creation date
    allOrders.sort((a, b) => new Date(b.created) - new Date(a.created));

    res.status(200).json(allOrders);
  } catch (ex) {
    console.error(`Failed get customer orders: ${ex}`);
    res.status(400).json({ message: "Failed to get customer orders" });
  }
});

router.post("/api/order/byDate", async (req, res, next) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  let finalOrders = [];

  finalOrders = await db.orders
    .find({
      created: {
        $gte: new Date(req.body.startDate),
        $lt: new Date(req.body.endDate),
      },
    })
    .toArray();

  res.status(200).json(finalOrders);
});

router.post("/api/order/addRefund", async (req, res, next) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const parsedBodey = req.body;

  try {
    await db.orders.updateOne(
      {
        _id: getId(parsedBodey.orderId),
      },
      {
        $push: {
          refundData: parsedBodey.refundObj,
        },
      },
      { multi: false }
    );
    res.status(200).json({ msg: "refund added" });
  } catch (err) {
    res.status(400).json({ errorMessage: "refund  failed" });
  }
});

router.post("/api/order/updateCCPayment", async (req, res, next) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const shoofiDB = req.app.db["shoofi"];
  const parsedBodey = req.body;

  try {
    const shoofiStoreData = await shoofiDB.store.findOne({ id: 1 });
    const orderDoc = await db.orders.findOne({
      _id: getId(parsedBodey.orderId),
    });
    const customerId = orderDoc.customerId;
    const customerDB = getCustomerAppName(req, appName);
    const customer = await customerDB.customers.findOne({
      _id: getId(customerId),
    });
    if (!customer) {
      res.status(400).json({
        message: "Customer not found",
      });
      return;
    }

    const zdCreditCredentials = shoofiStoreData.credentials;

    const data = {
      TerminalNumber: zdCreditCredentials.credentials_terminal_number,
      Password: zdCreditCredentials.credentials_password,
      ReferenceID: parsedBodey.creditcard_ReferenceNumber,
      ZCreditChargeResponse: parsedBodey.ZCreditChargeResponse,
    };
    const docId = parsedBodey?.ZCreditInvoiceReceiptResponse?.DocumentID;
    // if (docId) {
    axios
      .post(
        "https://pci.zcredit.co.il/ZCreditWS/api/Transaction/GetTransactionStatusByReferenceId",
        data,
        { responseType: "application/json" }
      )
      .then(async (response) => {
        if (response.data.HasError) {
          // await db.orders.deleteOne({ _id: parsedBodey.orderId });
          await db.orders.updateOne(
            {
              _id: getId(parsedBodey.orderId),
            },
            {
              $set: {
                ccPaymentRefData: {
                  payload: parsedBodey,
                  data: response.data,
                },
                status: "0",
              },
            },
            { multi: false }
          );
          res.status(200).json(response.data);
          return;
        }

        let updateData = {
          ccPaymentRefData: {
            payload: parsedBodey,
            data: response.data,
          },
          status: "1",
        };
        if (orderDoc.order.receipt_method === "DELIVERY") {
          updateData.isShippingPaid = true;
        }
        await db.orders.updateOne(
          {
            _id: getId(parsedBodey.orderId),
          },
          {
            $set: updateData,
          },
          { multi: false }
        );

        const finalOrderDoc = {
          ...orderDoc,
          customerDetails: {
            name: customer.fullName,
            phone: customer.phone,
          },
        };
        // websockets.fireWebscoketEvent({
        //   type: "new order",
        //   customerIds: [customerId],
        //   isAdmin: true,
        //   appName,
        // });

        // Send WebSocket notification to store users to refresh unviewed orders count
        websocketService.sendToAppAdmins('shoofi-partner', {
          type: 'unviewed_orders_updated',
          data: {
            orderId: orderDoc._id,
            action: 'new_order',
            timestamp: new Date().toISOString()
          },
        },appName);

        // const smsContent = smsService.getOrderRecivedContent(
        //   customer.fullName,
        //   orderDoc.total,
        //   orderDoc.order.receipt_method,
        //   orderDoc.orderId,
        //   orderDoc.app_language
        // );
        // await smsService.sendSMS(customer.phone, smsContent, req);
        // await smsService.sendSMS("0542454362", smsContent, req);

        // Send notifications for successful payment
        await sendStoreOwnerNotifications(orderDoc, req, appName);
        
        // Invoice mail handling - wrapped in try-catch to continue order processing even if invoice fails
        try {
          const docId = response.data.ZCreditInvoiceReceiptResponse?.DocumentID;
          if (docId) {
            try {
              await invoiceMailService.saveInvoice(docId, req);
              
              // Only attempt URL shortening if invoice save was successful
              try {
                const shortenedUrl = await turl.shorten(
                  `https://shoofi-spaces.fra1.cdn.digitaloceanspaces.com/invoices/doc-${docId}.pdf`
                );
                
                // Update order with shortened URL - non-critical update
                try {
                  await db.orders.updateOne(
                    { _id: getId(orderDoc._id) },
                    {
                      $set: {
                        "ccPaymentRefData.url": shortenedUrl
                      },
                    },
                    { multi: false }
                  );
                } catch (urlUpdateError) {
                  console.error("Failed to update order with invoice URL:", urlUpdateError);
                }
              } catch (urlError) {
                console.error("Failed to shorten invoice URL:", urlError);
              }
            } catch (saveError) {
              console.error("Failed to save invoice:", saveError);
            }
          } else {
            console.error("No document ID in invoice response:", response.data.ZCreditInvoiceReceiptResponse);
          }
        } catch (invoiceError) {
          console.error("Invoice processing error:", invoiceError);
        }

        res.status(200).json({ errorMessage: "valid invoice doc" });
        // } else {
        //   await db.orders.updateOne(
        //     {
        //       _id: getId(parsedBodey.orderId),
        //     },
        //     {
        //       $set: {
        //         ccPaymentRefData: {
        //           payload: parsedBodey,
        //           data: 'no doc ID',
        //         },
        //         status: "0",
        //       },
        //     },
        //     { multi: false }
        //   );
        //   res.status(200).json({ errorMessage: "no invoice doc" });
        // }
      });
    // }, 120000);
    res.status(200).json({ errorMessage: "valid invoice doc" });
    // } catch (err) {
    //   res.status(400).json({ errorMessage: err?.message });
    // }
  } catch (err) {
    res.status(400).json({ errorMessage: err?.message });
  }
});

const verifiedAppName = async (req, appName, storeData) => {
  const dbShoofi = req.app.db['shoofi'];
  const storesList = await dbShoofi.stores.find({name_ar: storeData?.name_ar}).toArray();
  const foundedStore = storesList?.length > 0 ? storesList[0] : null;
  console.log("storeData?.name_ar", storeData?.name_ar);
  console.log("foundedStore", foundedStore?.appName);
  console.log("appName", appName);
  if (appName !== foundedStore?.appName) {
      console.log("foundedStore?.appName", foundedStore?.appName);
      return foundedStore?.appName;
  }
  console.log("appName", appName);
  return appName;
}

router.post(
  "/api/order/create",
  upload.array("img"),
  auth.required,
  async (req, res, next) => {
    //const appName = req.headers["app-name"];
    const appNameReq = req.headers["app-name"];
    const parsedBodey = JSON.parse(req.body.body);
    const appName = await verifiedAppName(req,appNameReq, parsedBodey?.storeData);

    const db = req.app.db[appName || appNameReq];
    const config = req.app.config;
    const customerId = parsedBodey.customerId || req.auth.id;
    const isCreditCardPay = parsedBodey.order.payment_method == "CREDITCARD";


    // Prevent order duplication using Redis lock or in-memory fallback
    const orderLockKey = `order_lock:${appName}:${customerId}`;
    const lockTimeout = 10; // 10 seconds lock timeout
    const duplicateCheckWindow = 30; // 30 seconds to check for recent orders
    let lockAcquired = false;
    
    // Try Redis lock first
    if (redisClient) {
      try {
        // Try to acquire lock
        lockAcquired = await redisClient.set(orderLockKey, Date.now(), 'EX', lockTimeout, 'NX');
        
        if (!lockAcquired) {
          console.log(`Order creation blocked - customer ${customerId} already has an active order creation in progress (Redis)`);
          return res.status(429).json({ 
            err: "Order creation in progress. Please wait a moment and try again.",
            code: "ORDER_IN_PROGRESS"
          });
        }
      } catch (redisError) {
        console.warn('Redis error during order duplication check:', redisError.message);
        // Fall back to in-memory lock
      }
    }
    
    // Fallback to in-memory lock if Redis is not available or failed
    if (!lockAcquired) {
      const now = Date.now();
      const lastOrderAttempt = orderCreationLocks.get(customerId);
      
      if (lastOrderAttempt && (now - lastOrderAttempt) < (lockTimeout * 1000)) {
        console.log(`Order creation blocked - customer ${customerId} already has an active order creation in progress (Memory)`);
        return res.status(429).json({ 
          err: "Order creation in progress. Please wait a moment and try again.",
          code: "ORDER_IN_PROGRESS"
        });
      }
      
      // Set in-memory lock
      orderCreationLocks.set(customerId, now);
    }

    // Check for recent orders from the same customer (within last 30 seconds)
    try {
      const recentOrders = await db.orders.find({
        customerId: customerId,
        created: { 
          $gte: moment().subtract(duplicateCheckWindow, 'seconds').utcOffset(getUTCOffset()).format() 
        }
      }).toArray();

      if (recentOrders.length > 0) {
        // Release the lock
        if (redisClient && lockAcquired) {
          await redisClient.del(orderLockKey);
        } else {
          orderCreationLocks.delete(customerId);
        }
        console.log(`Duplicate order prevented - customer ${customerId} has ${recentOrders.length} recent order(s)`);
 
      }
    } catch (dbError) {
      console.error('Database error during duplicate check:', dbError);
      // Continue with order creation if database check fails
    }

    const generatedOrderId = generateUniqueOrderId();
    const orderIdSplit = generatedOrderId.split("-");
    const idPart1 = orderIdSplit[0];
    const idPart2 = orderIdSplit[2];
    const newOrderId = `${idPart1}-${idPart2}`;
    console.log("newOrderId", newOrderId);
    let imagesList = [];
    if (req.files && req.files.length > 0) {
      imagesList = await imagesService.uploadImage(req.files, req, "orders");
    }
    let imageIndex = 0;
    let updatedItemsWithImages = [];
    if (imagesList?.length > 0) {
      updatedItemsWithImages = parsedBodey.order.items.map((item) => {
        if (item.clienImage) {
          imageIndex++;
          return {
            ...item,
            clienImage: imagesList[imageIndex - 1],
          };
        }
        return {
          ...item,
          clienImage: null,
        };
      });
    }
    let locationQrCode = null;
    if (parsedBodey.order.receipt_method == "DELIVERY") {
      locationQrCode = await generateQR(
        parsedBodey?.order?.geo_positioning?.latitude,
        parsedBodey?.order?.geo_positioning?.longitude
      );
    }
    const offsetHours = getUTCOffset();

    const orderDoc = {
      ...parsedBodey,
      order: {
        ...parsedBodey.order,
        items:
          updatedItemsWithImages?.length > 0
            ? updatedItemsWithImages
            : parsedBodey.order.items,
        geo_positioning: {
          ...parsedBodey.order.geo_positioning,
          qrURI: locationQrCode,
        },
      },
      created: moment(new Date()).utcOffset(offsetHours).format(),
      customerId,
      orderId: newOrderId,
      originalOrderId: generatedOrderId,
      status: isCreditCardPay ? "0" : "6", // Start with pending for credit card
      isPrinted: false,
      isViewd: false,
      isViewdAdminAll: false,
      ipAddress: req.ip,
      appName: appName,
      // Add coupon data if present
      appliedCoupon: parsedBodey.appliedCoupon || null,
    };

    // Debug log for coupon data
    if (parsedBodey.appliedCoupon) {
      console.log('Order creation - Applied coupon data:', {
        couponType: parsedBodey.appliedCoupon.coupon?.type,
        couponCode: parsedBodey.appliedCoupon.coupon?.code,
        discountAmount: parsedBodey.appliedCoupon.discountAmount,
        isFreeDelivery: parsedBodey.appliedCoupon.coupon?.type === 'free_delivery'
      });
    }

    try {
      const newDoc = await db.orders.insertOne(orderDoc);
      const orderId = newDoc.insertedId;

      const customerDB = getCustomerAppName(req, appName);
      const customer = await customerDB.customers.findOne({
        _id: getId(customerId),
      });
      if (!customer) {
        res.status(400).json({
          message: "Customer not found",
        });
        return;
      }

      if (!customer.addresses || customer.addresses.length === 0) {
        // Add the address from the order to the customer's addresses array
        if (orderDoc.order.address) {
          await customerDB.customers.updateOne(
            { _id: getId(customer._id) },
            { $push: { addresses: orderDoc.order.address } }
          );
          // Optionally, update the in-memory customer object if you use it later
          customer.addresses = [orderDoc.order.address];
        }
      }

      await customerDB.customers.findOneAndUpdate(
        { _id: getId(customerId) },
        {
          $set: {
            ...customer,
            orders: customer.orders
              ? [...customer.orders, { orderId, appName }]
              : [{ orderId, appName }],
          },
        },
        { multi: false, returnOriginal: false }
      );

      if (!isCreditCardPay) {
        // Send notification to store owners
        await sendStoreOwnerNotifications(orderDoc, req, appName);
      }

      // Track order creation centrally
      await centralizedFlowMonitor.trackOrderFlowEvent({
        orderId: orderId,
        orderNumber: orderDoc.orderId,
        sourceApp: appName,
        eventType: 'order_created',
        status: orderDoc.status,
        actor: customer?.fullName || 'Customer',
        actorId: customerId,
        actorType: 'customer',
        metadata: {
          receiptMethod: orderDoc.order.receipt_method,
          total: orderDoc.total,
          itemsCount: orderDoc.order.items?.length || 0,
          paymentMethod: orderDoc.order.payment_method,
          isCreditCardPay
        }
      });
            // Handle credit card payment server-side
            if (isCreditCardPay && parsedBodey.paymentData) {
              try {
                const paymentResult = await processCreditCardPayment(
                  parsedBodey.paymentData,
                  orderDoc,
                  req,
                  customer?.fullName
                );
      
                if (paymentResult.success) {
                  // Update order with successful payment
                  await db.orders.updateOne(
                    { _id: orderId },
                    {
                      $set: {
                        status: "6",
                        ccPaymentRefData: paymentResult.paymentData,
                        isShippingPaid: orderDoc.order.receipt_method === "DELIVERY",
                      },
                    }
                  );
      
                  // Send notifications for successful payment
                  await sendStoreOwnerNotifications(orderDoc, req, appName);
                  
                  // Track successful payment centrally
                  await centralizedFlowMonitor.trackOrderFlowEvent({
                    orderId: orderId,
                    orderNumber: orderDoc.orderId,
                    sourceApp: appName,
                    eventType: 'payment_success',
                    status: '6',
                    actor: 'Payment System',
                    actorId: 'payment_system',
                    actorType: 'system',
                    metadata: {
                      paymentMethod: 'CREDITCARD',
                      referenceNumber: paymentResult.paymentData.ReferenceNumber,
                      receiptMethod: orderDoc.order.receipt_method,
                      total: orderDoc.total
                    }
                  });
                  
                  // Invoice mail handling - wrapped in try-catch to continue order processing even if invoice fails
                  try {
                    const docId = paymentResult?.paymentData?.ZCreditInvoiceReceiptResponse?.DocumentID;
                    if (docId) {
                      try {
                        await invoiceMailService.saveInvoice(docId, req);
                        
                        // Only attempt URL shortening if invoice save was successful
                        try {
                          const shortenedUrl = await turl.shorten(
                            `https://shoofi-spaces.fra1.cdn.digitaloceanspaces.com/invoices/doc-${docId}.pdf`
                          );
                          
                          // Update order with shortened URL - non-critical update
                          try {
                            await db.orders.updateOne(
                              { _id: getId(orderId) },
                              {
                                $set: {
                                  "ccPaymentRefData.url": shortenedUrl
                                },
                              },
                              { multi: false }
                            );
                          } catch (urlUpdateError) {
                            console.error("Failed to update order with invoice URL:", urlUpdateError);
                          }
                        } catch (urlError) {
                          console.error("Failed to shorten invoice URL:", urlError);
                        }
                      } catch (saveError) {
                        console.error("Failed to save invoice:", saveError);
                      }
                    } else {
                      console.error("No document ID in invoice response:", paymentResult?.paymentData?.ZCreditInvoiceReceiptResponse);
                    }
                  } catch (invoiceError) {
                    console.error("Invoice processing error:", invoiceError);
                  }
      
                  res.status(200).json({
                    message: "Order created and payment processed successfully",
                    orderId,
                    paymentStatus: "success",
                  });
                  return;
                } else {
                  // Track payment failure centrally
                  await centralizedFlowMonitor.trackOrderFlowEvent({
                    orderId: orderId,
                    orderNumber: orderDoc.orderId,
                    sourceApp: appName,
                    eventType: 'payment_failed',
                    status: '0',
                    actor: 'Payment System',
                    actorId: 'payment_system',
                    actorType: 'system',
                    metadata: {
                      paymentMethod: 'CREDITCARD',
                      error: paymentResult.error,
                      receiptMethod: orderDoc.order.receipt_method,
                      total: orderDoc.total
                    }
                  });
                  await db.orders.updateOne(
                    { _id: orderId },
                    {
                      $set: {
                        ccPaymentRefData: paymentResult,
                      },
                    }
                  );
                  
                  // Payment failed - keep order in pending status
                  res.status(400).json({
                    message: "Order created but payment failed",
                    orderId,
                    paymentStatus: "failed",
                    paymentError: paymentResult.error,
                  });
                  return;
                }
              } catch (paymentError) {
                console.error("Payment processing error:", paymentError);
                
                // Track payment processing error centrally
                await centralizedFlowMonitor.trackOrderFlowEvent({
                  orderId: orderId,
                  orderNumber: orderDoc.orderId,
                  sourceApp: appName,
                  eventType: 'payment_error',
                  status: '0',
                  actor: 'Payment System',
                  actorId: 'payment_system',
                  actorType: 'system',
                  metadata: {
                    paymentMethod: 'CREDITCARD',
                    error: paymentError.message,
                    receiptMethod: orderDoc.order.receipt_method,
                    total: orderDoc.total
                  }
                });
                
                // Keep order in pending status if payment processing fails
                res.status(400).json({
                  message: "Order created but payment processing failed",
                  orderId,
                  paymentStatus: "error",
                  paymentError: paymentError.message,
                });
                return;
              }
            }

      res.status(200).json({
        message: "Order created successfully",
        orderId,
      });
    } catch (ex) {
      console.log(ex);
      res.status(400).json({ err: "Your order declined. Please try again" });
    } finally {
      // Release the lock (Redis or in-memory)
      if (redisClient && lockAcquired) {
        try {
          await redisClient.del(orderLockKey);
        } catch (lockError) {
          console.error('Failed to release Redis order lock:', lockError);
        }
      } else {
        // Release in-memory lock
        orderCreationLocks.delete(customerId);
      }
    }
  }
);

router.post(
  "/api/order/update/all",
  upload.array("img"),
  auth.required,
  async (req, res, next) => {
    const appName = req.headers["app-name"];
    const db = req.app.db[appName];
    const config = req.app.config;
    const parsedBodey = JSON.parse(req.body.body);
    const customerId = parsedBodey.customerId || req.auth.id;
    const db_orderId = parsedBodey.db_orderId;
    const orderId = parsedBodey.orderId;

    let imagesList = [];
    if (req.files && req.files.length > 0) {
      imagesList = await imagesService.uploadImage(req.files, req, "orders");
    }
    let imageIndex = 0;
    let updatedItemsWithImages = [];
    if (imagesList?.length > 0) {
      updatedItemsWithImages = parsedBodey.order.items.map((item) => {
        if (item.clienImage) {
          imageIndex++;
          return {
            ...item,
            clienImage: imagesList[imageIndex - 1],
          };
        }
        return {
          ...item,
          clienImage: null,
        };
      });
    }

    const orderDoc = {
      ...parsedBodey,
      order: {
        ...parsedBodey.order,
        items:
          updatedItemsWithImages?.length > 0
            ? updatedItemsWithImages
            : parsedBodey.order.items,
      },
      created: moment(new Date()).utcOffset(offsetHours).format(),
      customerId,
      orderId: orderId,
      status: "1",
      isPrinted: false,
    };

    try {
      await db.orders.updateOne(
        {
          _id: getId(db_orderId),
        },
        { $set: orderDoc },
        { multi: false }
      );

      const customerDB = getCustomerAppName(req, appName);
      const customer = await customerDB.customers.findOne({
        _id: getId(customerId),
      });
      if (!customer) {
        res.status(400).json({
          message: "Customer not found",
        });
        return;
      }

      // const smsContent = smsService.getOrderRecivedContent(
      //   customer.fullName,
      //   orderDoc.total,
      //   orderDoc.order.receipt_method,
      //   generatedOrderId,
      //   orderDoc.app_language
      // );
      //smsService.sendSMS(customer.phone, smsContent, req);
      // smsService.sendSMS("0542454362", smsContent, req);

      const finalOrderDoc = {
        ...orderDoc,
        customerDetails: {
          name: customer.fullName,
          phone: customer.phone,
        },
      };
      websockets.fireWebscoketEvent({
        type: "order updated",
        data: finalOrderDoc,
        customerIds: [customerId],
        isAdmin: true,
        appName,
      });

      indexOrders(req.app).then(() => {
        res.status(200).json({
          message: "Order created successfully",
        });
      });
    } catch (ex) {
      console.log(ex);
      res.status(400).json({ err: "Your order declined. Please try again" });
    }
  }
);

const centralizedFlowMonitor = require('../services/monitoring/centralized-flow-monitor');

router.post("/api/order/update", auth.required, async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const offsetHours = getUTCOffset();
  
  try {
    const updateobj = req.body.updateData;
    const orderId = req.body.orderId;
    
    // Get current order state
    const currentOrder = await db.orders.findOne({ _id: getId(orderId) });
    const oldStatus = currentOrder?.status;
    
    // Update order
    await db.orders.updateOne(
      {
        _id: getId(orderId),
      },
      { $set: updateobj },
      { multi: false }
    );
    
    const order = await db.orders.findOne({ _id: getId(orderId) });
    const customerId = order?.customerId;

    // Track order status change centrally
    await centralizedFlowMonitor.trackOrderFlowEvent({
      orderId: orderId,
      orderNumber: order.orderId,
      sourceApp: appName,
      eventType: 'status_change',
      status: updateobj.status,
      actor: req.user?.fullName || 'System',
      actorId: req.user?._id || 'system',
      actorType: req.user?.role || 'system',
      metadata: {
        previousStatus: oldStatus,
        statusChange: `${oldStatus} → ${updateobj.status}`,
        updateReason: updateobj.updateReason,
        receiptMethod: order.order.receipt_method
      }
    });
    // websockets.fireWebscoketEvent({
    //   type: "order status updated",
    //   data: updateobj,
    //   customerIds: [customerId],
    //   isAdmin: true,
    //   appName,
    // });
    websocketService.sendToAppAdmins('shoofi-partner', {
      type: 'order_status_updated',
      data: updateobj,
      customerIds: [customerId],
      isAdmin: true,
      appName,
    },appName);

    const customerDB = getCustomerAppName(req, appName);
    const customer = await customerDB.customers.findOne({
      _id: getId(order.customerId),
    });
    
    // Send SMS notifications for status 2 (ready)
    // if (updateobj?.status == "2") {
    //   let smsContent = "";
    //   switch (order.order.receipt_method) {
    //     case "TAKEAWAY":
    //       smsContent = smsService.getOrderTakeawayReadyContent(
    //         customer?.fullName,
    //         order.orderId,
    //         order.app_language
    //       );
    //       break;
    //     case "DELIVERY":
    //       const storeData = await db.store.findOne({ id: 1 });
    //       smsContent = smsService.getOrderDeliveryReadyContent(
    //         customer?.fullName,
    //         order.orderId,
    //         order.app_language,
    //         storeData.order_company_number
    //       );
    //   }
    //   // await smsService.sendSMS(customer?.phone, smsContent, req);
    //   // await smsService.sendSMS("0542454362", smsContent, req);
    // }

    // Send customer notifications based on status changes
    if (customer && updateobj?.status) {
      try {
        let notificationTitle = "";
        let notificationBody = "";
        let notificationType = "order";
        
        switch (updateobj.status) {
          case "1": // IN_PROGRESS
            notificationTitle = "طلبك قيد التحضير";
            notificationBody = `طلبك قيد التحضير الآن.`;
            break;
          case "2": // COMPLETED
              notificationTitle = "طلبك جاهز للاستلام";
              notificationBody = `طلبك جاهز للاستلام من المطعم.`;
            break;
          case "3": // WAITING_FOR_DRIVER
            notificationTitle = "في انتظار السائق";
            notificationBody = `طلبك جاهز وفي انتظار السائق.`;
            break;
          case "4": // CANCELLED
            notificationTitle = "تم إلغاء طلبك";
            notificationBody = `طلبك تم إلغاؤه. إذا كان لديك أي استفسار، يرجى التواصل معنا.`;
            notificationType = "order_cancelled";
            break;
          case "5": // REJECTED
            notificationTitle = "تم رفض طلبك";
            notificationBody = `عذراً، تم رفض طلبك. يرجى التواصل معنا للمزيد من المعلومات.`;
            notificationType = "order_rejected";
            break;
          // case "6": // PENDING
          //   notificationTitle = "تم استلام طلبك";
          //   notificationBody = `طلبك رقم #${order.orderId} تم استلامه وهو قيد المراجعة.`;
          //   break;
          case "7": // CANCELLED_BY_ADMIN
            notificationTitle = "تم إلغاء طلبك من قبل الإدارة";
            notificationBody = `طلبك تم إلغاؤه من قبل الإدارة. يرجى التواصل معنا للمزيد من المعلومات.`;
            notificationType = "order_cancelled_admin";
            break;
          case "8": // CANCELLED_BY_CUSTOMER
            notificationTitle = "تم إلغاء طلبك";
            notificationBody = `طلبك تم إلغاؤه بنجاح.`;
            notificationType = "order_cancelled_customer";
            break;
          // case "9": // CANCELLED_BY_DRIVER
          //   notificationTitle = "تم إلغاء الطلب من قبل السائق";
          //   notificationBody = `طلبك رقم #${order.orderId} تم إلغاؤه من قبل السائق. سيتم إعادة تعيين سائق جديد.`;
          //   notificationType = "order_cancelled_driver";
          //   break;
          // case "10": // PICKED_UP
          //   notificationTitle = "تم استلام طلبك";
          //   notificationBody = `طلبك رقم #${order.orderId} تم استلامه من المطعم.`;
          //   break;
          // case "11": // PICKED_UP_BY_DRIVER
          //   notificationTitle = "تم استلام الطلب من قبل السائق";
          //   notificationBody = `طلبك رقم #${order.orderId} تم استلامه من قبل السائق وهو في الطريق إليك.`;
          //   break;
          // case "12": // DELIVERED
          //   notificationTitle = "تم تسليم طلبك";
          //   notificationBody = `طلبك رقم #${order.orderId} تم تسليمه بنجاح. نتمنى لك وجبة شهية!`;
          //   notificationType = "delivery_complete";
          //   break;
          default:
            break;
        }
        
        if (notificationTitle && notificationBody) {
          // Determine app type based on app name
          let appType = "shoofi-app";
          if (appName.includes("partner")) {
            appType = "shoofi-partner";
          } else if (appName.includes("shoofir")) {
            appType = "shoofi-shoofir";
          }
          
          await notificationService.sendNotification({
            recipientId: order.customerId,
            title: notificationTitle,
            body: notificationBody,
            type: notificationType,
            appName: order.appName,
            appType: appType,
            channels: {
              websocket: true,
              push: true,
              email: false,
              sms: false
            },
            data: {
              orderId: order.orderId,
              orderStatus: updateobj.status,
              receiptMethod: order.order.receipt_method,
              total: order.total,
              customerName: customer.fullName
            },
            req: req,
            soundType: 'customer.wav'
          });
        }
      } catch (notificationError) {
        console.error("Failed to send customer notification:", notificationError);
        // Don't fail the order update if notification fails
      }
    }

    // Send driver notification when order is ready for pickup (status = "3")
    if (updateobj?.status === "3" && order.order.receipt_method === "DELIVERY") {
      try {
        // Find the delivery record for this order
        const deliveryDB = req.app.db["delivery-company"];
        const deliveryRecord = await deliveryDB.bookDelivery.findOne({
          bookId: order.orderId
        });

        if (deliveryRecord && deliveryRecord.driver?._id) {
          // Update delivery record to mark it as ready for pickup
          await deliveryDB.bookDelivery.updateOne(
            { bookId: order.orderId },
            { 
              $set: { 
                isReadyForPickup: true,
                readyForPickupAt: moment().utcOffset(offsetHours).format()
              }
            }
          );

          // Send notification to the assigned driver
          await notificationService.sendNotification({
            recipientId: String(deliveryRecord.driver._id),
            title: "طلب جاهز للاستلام",
            body: `طلبك جاهز للاستلام من المطعم.`,
            type: "order_ready_pickup",
            appName: "delivery-company",
            appType: "shoofi-shoofir",
            channels: {
              websocket: true,
              push: true,
              email: false,
              sms: false
            },
            data: {
              orderId: order._id,
              bookId: order.orderId,
              orderStatus: updateobj.status,
              customerName: customer?.fullName || "العميل",
              customerPhone: customer?.phone || "",
              storeName: order.storeName || "المطعم",
              isReadyForPickup: true
            },
            req: req,
            soundType: 'driver.wav'
          });
        }
      } catch (driverNotificationError) {
        console.error("Failed to send driver notification:", driverNotificationError);
        // Don't fail the order update if driver notification fails
      }
    }

    return res.status(200).json({ message: "Order successfully updated" });
  } catch (ex) {
    console.info("Error updating order", ex);
    return res.status(400).json({ message: "Failed to update the order" });
  }
});

router.post("/api/order/update/viewd", auth.required, async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];

  try {
    const updateobj = req.body.updateData;
    const offsetHours = getUTCOffset();

    let updateData = {
      isViewd: updateobj.isViewd,
      isViewdAdminAll: updateobj.isViewdAdminAll,
    };
    if (!updateobj.isOrderLaterSupport) {
      const orderDate = moment(updateobj.currentTime)
        .utcOffset(offsetHours)
        .add(updateobj.readyMinutes, "m")
        .format();
      updateData.orderDate = orderDate;
      updateData.status = "1";
    }

    await db.orders.updateOne(
      {
        _id: getId(req.body.orderId),
      },
      {
        $set: updateData,
      },
      { multi: false }
    );

    const order = await db.orders.findOne({ _id: getId(req.body.orderId) });

    // Track order viewed/approved centrally
    await centralizedFlowMonitor.trackOrderFlowEvent({
      orderId: req.body.orderId,
      orderNumber: order.orderId,
      sourceApp: appName,
      eventType: 'order_viewed',
      status: updateData.status || order.status,
      actor: req.user?.fullName || 'Store Admin',
      actorId: req.user?._id || 'store_admin',
      actorType: 'store_admin',
      metadata: {
        isViewd: updateobj.isViewd,
        isViewdAdminAll: updateobj.isViewdAdminAll,
        readyMinutes: updateobj.readyMinutes,
        isOrderLaterSupport: updateobj.isOrderLaterSupport,
        receiptMethod: order.order.receipt_method,
        previousStatus: order.status,
        newStatus: updateData.status
      }
    });

    // Clear persistent alert when order is approved (isViewd = true)
    if (updateobj.isViewd === true) {
      try {
        await persistentAlertsService.clearPersistentAlert(order._id, req, appName);
      } catch (error) {
        console.error("Failed to clear persistent alert:", error);
        // Don't fail the entire request if alert clearing fails
      }
    }

    if (order.order.receipt_method == "DELIVERY") {
      const customerDB = getCustomerAppName(req, appName);
      const customer = await customerDB.customers.findOne({
        _id: getId(order.customerId),
      });
      if (!customer) {
        res.status(400).json({
          message: "Customer not found",
        });
        return;
      }
      const storeData = await db.store.findOne({ id: 1 });
      const shoofiDB = req.app.db["shoofi"];
      const shoofiStore = await shoofiDB.store.findOne({ id: 1 });

      if (shoofiStore.isSendSmsToDeliveryCompany) {
        const smsDeliveryContent = smsService.getOrderDeliveryCompanyContent(
          customer.fullName,
          order.orderId,
          order.app_language,
          order.orderDate,
          customer.phone,
          storeData.order_company_delta_minutes
        );
        await smsService.sendSMS(
          storeData.order_company_number,
          smsDeliveryContent,
          req
        );
        // await smsService.sendSMS("0542454362", smsDeliveryContent, req);
      }
      if (shoofiStore.isSendNotificationToDeliveryCompany) {
        const deliveryData = {
          fullName: customer.fullName,
          phone: customer.phone,
          price: order.orderPrice || "",
          pickupTime: updateobj.readyMinutes,
          storeName: order.app_language == "ar" ? storeData?.name_ar : storeData?.name_he || storeData?.name_ar,
          appName: storeData.appName,
          storeId: storeData._id,
          bookId: order.orderId,
          storeLocation: storeData.location,
          coverageRadius: storeData.coverageRadius,
          customerLocation: order?.order?.geo_positioning,
          order,
          // Add coupon data if present
          appliedCoupon: order.appliedCoupon || null,
        };

        // Debug log for delivery coupon data
        if (order.appliedCoupon) {
          console.log('Delivery booking - Applied coupon data:', {
            couponType: order.appliedCoupon.coupon?.type,
            couponCode: order.appliedCoupon.coupon?.code,
            discountAmount: order.appliedCoupon.discountAmount,
            isFreeDelivery: order.appliedCoupon.coupon?.type === 'free_delivery'
          });
        }

        deliveryService.bookDelivery({ deliveryData, appDb: req.app.db });
        
        // Track delivery booking centrally
        await centralizedFlowMonitor.trackOrderFlowEvent({
          orderId: req.body.orderId,
          orderNumber: order.orderId,
          sourceApp: appName,
          eventType: 'delivery_booked',
          status: updateData.status || order.status,
          actor: 'Store Admin',
          actorId: 'store_admin',
          actorType: 'store_admin',
          metadata: {
            deliveryMethod: 'external_company',
            readyMinutes: updateobj.readyMinutes,
            customerPhone: customer.phone,
            customerName: customer.fullName,
            storeName: order.app_language == "ar" ? storeData?.name_ar : storeData?.name_he || storeData?.name_ar,
            receiptMethod: order.order.receipt_method
          }
        });
      }
    }
    // Send notification to customer about order status update
    try {
      await sendOrderNotifications(order, req, appName);
    } catch (error) {
      console.error("Failed to send customer notification:", error);
    }

    // Send notification to store users about order viewed update
    
    // Send WebSocket notification to store users to refresh unviewed orders count
    websocketService.sendToAppAdmins('shoofi-partner', {
      type: 'unviewed_orders_updated',
      data: {
        orderId: order._id,
        action: 'order_viewed',
        timestamp: new Date().toISOString()
      },
    },appName);

    // Send print notification to all store users (admins)
    try {
      websocketService.sendToAppAdmins('shoofi-partner', {
        type: 'print_order',
        data: {
          orderId: order.orderId,
          orderStatus: order.status,
          receiptMethod: order.order.receipt_method,
          total: order.total,
          action: 'print_required',
          timestamp: new Date().toISOString()
        },
      },appName);
    } catch (error) {
      console.error("Failed to send print notification:", error);
    }

    // pushNotification.pushToClient(order.customerId, "TEEEEEST", req);

    return res
      .status(200)
      .json({ message: "order viewed successfully updated" });
  } catch (ex) {
    console.info("Error updating order", ex);
    return res.status(400).json({ message: "Failed to update the order" });
  }
});

router.post("/api/order/book-delivery", auth.required, async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  try {
    const updateobj = req.body.updateData;

    await db.orders.updateOne(
      {
        _id: getId(req.body.orderId),
      },
      { $set: updateobj },
      { multi: false }
    );
    const order = await db.orders.findOne({ _id: getId(req.body.orderId) });
    const customerId = order.customerId;
    websockets.fireWebscoketEvent({
      type: "order status updated",
      data: updateobj,
      customerIds: [customerId],
      isAdmin: true,
      appName,
    });

    const customerDB = getCustomerAppName(req, appName);
    const customer = await customerDB.customers.findOne({
      _id: getId(order.customerId),
    });
    if (!customer) {
      res.status(400).json({
        message: "Customer not found",
      });
      return;
    }

    const storeData = await db.store.findOne({ id: 1 });

    if (storeData.isSendSmsToDeliveryCompany) {
      const smsContent = smsService.getOrderDeliveryCompanyContent(
        customer.fullName,
        order.orderId,
        order.app_language,
        order.orderDate,
        customer.phone
      );
      await smsService.sendSMS(storeData.order_company_number, smsContent, req);
      await smsService.sendSMS("0542454362", smsContent, req);
    }
    if (storeData.isSendNotificationToDeliveryCompany) {
      const deliveryData = {
        fullName: customer.fullName,
        phone: customer.phone,
        price: order.orderPrice || "",
        pickupTime: updateobj.readyMinutes || 0,
        storeName: order.app_language == "ar" ? storeData?.name_ar : storeData?.name_he || storeData?.name_ar,
        appName: storeData.appName,
        storeId: storeData._id,
        bookId: order.orderId,
        storeLocation: storeData.location,
        coverageRadius: storeData.coverageRadius,
        customerLocation: order?.order?.geo_positioning,
        order,
        // Add coupon data if present
        appliedCoupon: order.appliedCoupon || null,
      };
      deliveryService.bookDelivery({ deliveryData, appDb: req.app.db });
    }
    websockets.fireWebscoketEvent({
      type: "order delivery booked",
      isAdmin: true,
      appName,
    });

    return res
      .status(200)
      .json({ message: "order delivery booked successfully" });
  } catch (ex) {
    console.info("Error order delivery booked", ex);
    return res.status(400).json({ message: "order delivery booked" });
  }
});

router.post(
  "/api/order/book-custom-delivery",
  auth.required,
  async (req, res) => {
    const appName = req.headers["app-name"];
    const db = req.app.db[appName];

    const isStoreOpen = await storeService.isDeliveryCompanyOpen(req);
    if (!isStoreOpen) {
      return res.status(200).json({ isStoreOpen });
    }
    try {
      const deliveryData = req.body.deliveryData;
      const offsetHours = getUTCOffset();

      var deliveryDeltaMinutes = moment()
        .add(deliveryData.time, "m")
        .utcOffset(offsetHours)
        .format("HH:mm");
      const insertRetsult = await db.bookDelivery.insertOne({
        ...deliveryData,
        deliveryDeltaMinutes,
        isDelivered: false,
        isCanceled: false,
        created: moment(new Date()).utcOffset(offsetHours).format(),
      });

      const storeData = await db.store.findOne({ id: 1 });
      if (storeData.isSendSmsToDeliveryCompany) {
        const smsContent = smsService.getCustomOrderDeliveryCompanyContent(
          deliveryData.fullName || "",
          deliveryData.phone,
          deliveryData.price,
          deliveryDeltaMinutes
        );
        await smsService.sendSMS(
          storeData.order_company_number,
          smsContent,
          req
        );
        await smsService.sendSMS("0542454362", smsContent, req);
      }
      if (storeData.isSendNotificationToDeliveryCompany) {
        const deliveryDataX = {
          fullName: deliveryData.fullName,
          phone: deliveryData.phone,
          price: deliveryData.price || "",
          pickupTime: deliveryData.time,
          storeName: order.app_language == "ar" ? storeData?.name_ar : storeData?.name_he || storeData?.name_ar,
          appName: storeData.appName,
          storeId: storeData._id,
          bookId: insertRetsult?.insertedId.toString(),
          storeLocation: storeData.location,
          coverageRadius: storeData.coverageRadius,
          customerLocation: order?.order?.geo_positioning,
        };
        deliveryService.bookDelivery({
          deliveryData: deliveryDataX,
          appDb: req.app.db,
        });
      }

      // websockets.fireWebscoketEvent("order delivery booked");
      return res
        .status(200)
        .json({
          message: "order custom delivery booked successfully",
          isStoreOpen,
        });
    } catch (ex) {
      console.info("Error order custom delivery booked", ex);
      return res
        .status(400)
        .json({ message: "order custom delivery booke failed" });
    }
  }
);

router.post(
  "/api/order/update-custom-delivery",
  auth.required,
  async (req, res) => {
    const appName = req.headers["app-name"];
    const db = req.app.db[appName];
    try {
      let updateData = req.body.updateData;
      const id = updateData._id;
      delete updateData._id;
      await db.bookDelivery.updateOne(
        {
          _id: getId(id),
        },
        { $set: updateData },
        { multi: false }
      );

      if (updateData.isCanceled === true) {
        const storeData = await db.store.findOne({ id: 1 });
        if (storeData.isSendSmsToDeliveryCompany) {
          const smsDeliveryContent =
            smsService.getOrderDeliveryCompanyCanceledContent(
              updateData.fullName,
              updateData.deliveryDeltaMinutes,
              updateData.phone,
              updateData.price
            );
          await smsService.sendSMS(
            storeData.order_company_number,
            smsDeliveryContent,
            req
          );
          await smsService.sendSMS("0542454362", smsDeliveryContent, req);
        }
        if (storeData.isSendNotificationToDeliveryCompany) {
          const deliveryDataX = {
            bookId: id,
            status: "-1",
          };
          deliveryService.updateDelivery({
            deliveryData: deliveryDataX,
            appDb: req.app.db,
          });
        }
      }

      // websockets.fireWebscoketEvent("order delivery booked");
      return res
        .status(200)
        .json({ message: "order custom delivery updated successfully" });
    } catch (ex) {
      console.info("Error order custom delivery updated", ex);
      return res
        .status(400)
        .json({ message: "order custom delivery updated failed" });
    }
  }
);

router.post("/api/order/get-custom-delivery", async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  try {
    const isAll = req.body.isAll;
    const offsetHours = getUTCOffset();

    const startOfToday = moment()
      .utcOffset(offsetHours)
      .startOf("day")
      .subtract(7, "d");

    // Get the end of today in UTC
    const endOfToday = moment().utcOffset(offsetHours).endOf("day").add(3, "h");

    let filterBy = {
      created: {
        $gte: startOfToday.format(),
        $lte: endOfToday.format(),
      },
    };

    if (!isAll) {
      filterBy = {
        ...filterBy,
        isDelivered: false,
        isCanceled: false,
      };
    }

    const bookingList = await db.bookDelivery
      .find(filterBy)
      .sort({ created: -1 })
      .toArray();
    res.status(200).json(bookingList);
  } catch (ex) {
    console.info("Error getting delivery list", ex);
    return res.status(400).json({ message: "Error getting delivery list" });
  }
});

router.post("/api/order/printed", auth.required, async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  try {
    await db.orders.updateOne(
      {
        _id: getId(
          req.body?.orderId?.$oid ? req.body.orderId.$oid : req.body.orderId
        ),
      },
      { $set: { isPrinted: req.body.status } },
      { multi: false }
    );
    if (req.body.status === false) {
      // Send notification to store users about unprinted order
      
      try {
        websocketService.sendToAppAdmins('shoofi-partner', {
          type: 'print_not_printed',
          data: {
            orderId: req.body.orderId,
            action: 'print_not_printed',
            timestamp: new Date().toISOString()
          },
        },appName);
      } catch (error) {
        console.error("Failed to send print notification:", error);
      }
    }
    return res.status(200).json({ message: "Order successfully printed" });
  } catch (ex) {
    console.info("Error updating order", ex);
    return res.status(400).json({ message: "Failed to print the order" });
  }
});

router.post("/api/order/update-delay", auth.required, async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const offsetHours = getUTCOffset();
  
  try {
    const { orderId, delayMinutes } = req.body;
    
    if (!orderId || !delayMinutes) {
      return res.status(400).json({ message: "Order ID and delay minutes are required" });
    }

    // Get current order
    const order = await db.orders.findOne({ _id: getId(orderId) });
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Save original order date if not already saved
    const updateData = {
      originalOrderDate: order.originalOrderDate || order.orderDate,
      orderDate: moment(order.orderDate).add(delayMinutes, 'minutes').utcOffset(offsetHours).format(),
      delayUpdatedAt: moment().utcOffset(offsetHours).format(),
      delayMinutes: delayMinutes
    };

    // Update order with delay
    await db.orders.updateOne(
      { _id: getId(orderId) },
      { $set: updateData },
      { multi: false }
    );

    // Update delivery record if order is for delivery
    if (order.order.receipt_method === "DELIVERY") {
      try {
        const deliveryDB = req.app.db["delivery-company"];
        const deliveryRecord = await deliveryDB.bookDelivery.findOne({
          bookId: order.orderId
        });

        if (deliveryRecord) {
          // Calculate new pickup time based on delay
          // Parse pickupTime string (e.g., "16:05") and add delayMinutes
          let newPickupTime;
          if (deliveryRecord.pickupTime && typeof deliveryRecord.pickupTime === 'string') {
            // Parse time string like "16:05"
            const [hours, minutes] = deliveryRecord.pickupTime.split(':').map(Number);
            const totalMinutes = hours * 60 + minutes + delayMinutes;
            const newHours = Math.floor(totalMinutes / 60);
            const newMinutes = totalMinutes % 60;
            newPickupTime = `${newHours.toString().padStart(2, '0')}:${newMinutes.toString().padStart(2, '0')}`;
          } else {
            // Fallback if pickupTime is not a string or doesn't exist
            newPickupTime = (deliveryRecord.pickupTime || 0) + delayMinutes;
          }
          
          // Update delivery record with original pickup time and new pickup time
          await deliveryDB.bookDelivery.updateOne(
            { bookId: order.orderId },
            { 
              $set: { 
                originalPickupTime: deliveryRecord.originalPickupTime || deliveryRecord.pickupTime || 0,
                pickupTime: newPickupTime,
                delayUpdatedAt: moment().utcOffset(offsetHours).format(),
                delayMinutes: delayMinutes
              }
            },
            { multi: false }
          );

          console.log(`Updated delivery record for order ${order.orderId}: originalPickupTime=${deliveryRecord.originalPickupTime || deliveryRecord.pickupTime || 0}, new pickupTime=${newPickupTime}`);
        }
      } catch (deliveryUpdateError) {
        console.error("Failed to update delivery record:", deliveryUpdateError);
        // Don't fail the order update if delivery update fails
      }
    }

    // Get customer details for notifications
    const customerDB = getCustomerAppName(req, appName);
    const customer = await customerDB.customers.findOne({
      _id: getId(order.customerId),
    });

    // Send notification to customer about delay
    if (customer) {
      try {
        const notificationTitle = "تم تأخير طلبك";
        const notificationBody = `عذراً، تم تأخير طلبك بـ ${delayMinutes} دقيقة. نعتذر عن الإزعاج.`;
        
        // Determine app type based on app name
        let appType = "shoofi-app";
        if (appName.includes("partner")) {
          appType = "shoofi-partner";
        } else if (appName.includes("shoofir")) {
          appType = "shoofi-shoofir";
        }

        await notificationService.sendNotification({
          recipientId: order.customerId,
          title: notificationTitle,
          body: notificationBody,
          type: 'order_delayed',
          appName: order.appName,
          appType: appType,
          channels: {
            websocket: true,
            push: true,
            email: false,
            sms: false
          },
          data: {
            orderId: order.orderId,
            orderStatus: order.status,
            receiptMethod: order.order.receipt_method,
            total: order.total,
            delayMinutes: delayMinutes,
            newOrderDate: updateData.orderDate
          },
          req: req,
          soundType: 'customer.wav'
        });
      } catch (notificationError) {
        console.error("Failed to send customer delay notification:", notificationError);
      }
    }

    // Send notification to driver if order is assigned to delivery
    if (order.order.receipt_method === "DELIVERY") {
      try {
        // Find the delivery record for this order
        const deliveryDB = req.app.db["delivery-company"];
        const deliveryRecord = await deliveryDB.bookDelivery.findOne({
          bookId: order.orderId
        });

        if (deliveryRecord && deliveryRecord.driver?._id) {
          await notificationService.sendNotification({
            recipientId: String(deliveryRecord.driver._id),
            title: "تم تأخير الطلب",
            body: `طلب رقم #${order.orderId} تم تأخيره بـ ${delayMinutes} دقيقة.`,
            type: "order_delayed",
            appName: "delivery-company",
            appType: "shoofi-shoofir",
            channels: {
              websocket: true,
              push: true,
              email: false,
              sms: false
            },
            data: {
              orderId: order._id,
              bookId: order.orderId,
              orderStatus: order.status,
              customerName: customer?.fullName || "العميل",
              customerPhone: customer?.phone || "",
              storeName: order.storeName || "المطعم",
              delayMinutes: delayMinutes,
              newOrderDate: updateData.orderDate,
              payment_method: order.order.payment_method
            },
            req: req,
            soundType: 'driver.wav'
          });
        }
      } catch (driverNotificationError) {
        console.error("Failed to send driver delay notification:", driverNotificationError);
      }
    }

    // Track delay update centrally
    await centralizedFlowMonitor.trackOrderFlowEvent({
      orderId: orderId,
      orderNumber: order.orderId,
      sourceApp: appName,
      eventType: 'order_delayed',
      status: order.status,
      actor: req.user?.fullName || 'Store Admin',
      actorId: req.user?._id || 'store_admin',
      actorType: 'store_admin',
      metadata: {
        delayMinutes: delayMinutes,
        originalOrderDate: order.orderDate,
        newOrderDate: updateData.orderDate,
        receiptMethod: order.order.receipt_method,
        customerName: customer?.fullName || 'Unknown'
      }
    });

    // Send WebSocket notification to refresh orders in driver app
    websocketService.sendToAppAdmins('shoofi-shoofir', {
      type: 'order_delayed',
      data: {
        orderId: order._id,
        orderNumber: order.orderId,
        delayMinutes: delayMinutes,
        newOrderDate: updateData.orderDate,
        action: 'order_delayed',
        timestamp: new Date().toISOString()
      },
    }, appName);

    return res.status(200).json({ 
      message: "Order delay updated successfully",
      newOrderDate: updateData.orderDate,
      delayMinutes: delayMinutes
    });
  } catch (ex) {
    console.error("Error updating order delay:", ex);
    return res.status(400).json({ message: "Failed to update order delay" });
  }
});
function relDiff(a, b) {
  let diff = 100 * Math.abs((a - b) / ((a + b) / 2));
  if (a < b) {
    diff = diff * -1;
  }
  return diff.toFixed(2);
}
router.post("/api/order/statistics/new-orders/:page?", async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  let pageNum = 1;
  if (req.body.pageNumber) {
    pageNum = req.body.pageNumber;
  }
  const offsetHours = getUTCOffset();

  var start = moment().subtract(7, "days").utcOffset(offsetHours);
  start.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });

  var end = moment().utcOffset(offsetHours);
  end.set({ hour: 23, minute: 59, second: 59, millisecond: 999 });
  const filterBy = {
    created: { $gte: new Date(start), $lt: new Date(end) },
  };
  let newOrders = await paginateData(true, req, pageNum, "orders", filterBy, {
    created: 1,
  });

  var start2 = moment().subtract(14, "days").utcOffset(offsetHours);
  start2.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });

  var end2 = moment().subtract(8, "days").utcOffset(offsetHours);
  end2.set({ hour: 23, minute: 59, second: 59, millisecond: 999 });
  const filterBy2 = {
    created: { $gte: new Date(start2), $lt: new Date(end2) },
  };
  const prevWeekNewOrders = await paginateData(
    true,
    req,
    pageNum,
    "orders",
    filterBy2,
    {
      created: 1,
    }
  );
  const percentDeff = relDiff(
    newOrders.totalItems,
    prevWeekNewOrders.totalItems
  );
  newOrders.percentDeff = percentDeff;
  try {
    res.status(200).json(newOrders);
  } catch (ex) {
    console.error(colors.red("Failed to search customer: ", ex));
    res.status(400).json({
      message: "Customer search failed.",
    });
  }
});

router.post("/api/order/admin/all-orders/:page?", async (req, res) => {
  try {
    let appName = req.headers["app-name"];
    let allOrders = [];
    let totalItems = 0;
    const pageNum = req.body.pageNumber || 1;
    const pageSize = 10;
    const skip = (pageNum - 1) * pageSize;

    // Date filter if provided
    let dateFilter = {};
    if (req.body.startDate && req.body.endDate) {
      const offsetHours = getUTCOffset();

      var start = moment(req.body.startDate).utcOffset(offsetHours);
      start.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });

      var end = moment(req.body.endDate).utcOffset(offsetHours);
      end.set({ hour: 23, minute: 59, second: 59, millisecond: 999 });

      dateFilter = {
        orderDate: { $gte: start.format(), $lt: end.format() },
      };
    }

    // Status filter if provided
    let statusFilter = {};
    if (req.body.status && req.body.status.length > 0) {
      statusFilter = { status: { $in: req.body.status } };
    }

    // Combine filters
    let filterBy = {
      ...dateFilter,
      ...statusFilter,
    };

    // Add orderId filter if provided
    if (req.body.orderId) {
      filterBy = { orderId: { $regex: req.body.orderId, $options: 'i' } };
    }

    // If no appName, loop over all stores in shoofi DB
    if (!appName || appName === 'shoofi') {
      const dbShoofi = req.app.db['shoofi'];
      const storesList = await dbShoofi.stores.find().toArray();
      // City filter if provided
      let filteredStores = storesList;
      if (req.body.cityIds && req.body.cityIds.length > 0) {
        filteredStores = storesList.filter((store) =>
          req.body.cityIds.includes(store.cityId)
        );
      }
      for (const store of filteredStores) {
        const db = req.app.db[store.appName];
        if (!db) continue;
        const storeOrders = await db.orders
          .find(filterBy)
          .sort({ created: -1 })
          .toArray();
        // Add store info to each order
        const ordersWithStoreInfo = storeOrders.map((order) => ({
          ...order,
          storeName: store.storeName,
          storeAppName: store.appName,
        }));
        allOrders = [...allOrders, ...ordersWithStoreInfo];
      }
    } else {
      // If appName is provided, only fetch from that app's DB
      const dbAdmin = req.app.db[appName];
      const storesList = await dbAdmin.stores.find().toArray();
      // City filter if provided
      let filteredStores = storesList;
      if (req.body.cityIds && req.body.cityIds.length > 0) {
        filteredStores = storesList.filter((store) =>
          req.body.cityIds.includes(store.cityId)
        );
      }
      for (const store of filteredStores) {
        const db = req.app.db[store.appName];
        if (!db) continue;
        const storeOrders = await db.orders
          .find(filterBy)
          .sort({ created: -1 })
          .toArray();
        // Add store info to each order
        const ordersWithStoreInfo = storeOrders.map((order) => ({
          ...order,
          storeName: store.storeName,
          storeAppName: store.appName,
        }));
        allOrders = [...allOrders, ...ordersWithStoreInfo];
      }
    }

    // Sort all orders by creation date
    allOrders.sort((a, b) => new Date(b.created) - new Date(a.created));

    // Get total count before pagination
    totalItems = allOrders.length;

    // Apply pagination
    const paginatedOrders = allOrders.slice(skip, skip + pageSize);

    // Get customer details for each order
    const finalOrders = [];
    for (const order of paginatedOrders) {
      const customerDB = getCustomerAppName(req, order.storeAppName);
      const customer = await customerDB.customers.findOne({
        _id: getId(order.customerId),
      });

      finalOrders.push({
        ...order,
        customerDetails: {
          name: customer?.fullName || order?.name,
          phone: customer?.phone || order?.phone,
          branchId: order?.branchId,
        },
      });
    }

    res.status(200).json({
      ordersList: finalOrders,
      totalItems,
      currentPage: pageNum,
      totalPages: Math.ceil(totalItems / pageSize),
    });
  } catch (error) {
    console.error("Error fetching all orders:", error);
    res.status(400).json({ message: "Failed to fetch orders" });
  }
});
// Get only active orders for the authenticated customer
router.get("/api/order/customer-active-orders", auth.required, async (req, res) => {
  const customerId = req.auth.id;
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const customerDB = getCustomerAppName(req, appName);

  const appType = req.headers["app-type"];
  // Active statuses (from frontend: inProgressStatuses = ["1"])
  const activeStatuses = ["1","3","6","2","11"];
  let customer = null;
  try {
    if(appType === 'shoofi-shoofir'){
      customer = await customerDB.customers.findOne({
        _id: getId(customerId),
      });
    }else if(appType === 'shoofi-partner'){
      customer = await customerDB.storeUsers.findOne({
        _id: getId(customerId),
      });
    }else{
      customer = await customerDB.customers.findOne({
        _id: getId(customerId),
      });
    }
      if (!customer) {
      res.status(400).json({
        message: "Customer not found",
      });
      return;
    }

    if (!customer.orders || !customer.orders.length) {
      res.status(200).json([]);
      return;
    }

    // Group orders by their database
    const ordersByAppName = {};
    customer.orders.forEach((order) => {
      const appNameTmp = order.appName || appName; // Use the order's db if specified, otherwise use current app
      if (!ordersByAppName[appNameTmp]) {
        ordersByAppName[appNameTmp] = [];
      }
      ordersByAppName[appNameTmp].push(order.appName ? order.orderId : order);
    });

    // Fetch active orders from each database
    const allOrders = [];
    for (const [dbName, orderIds] of Object.entries(ordersByAppName)) {
      const currentDb = req.app.db[dbName];
      const oids = orderIds.map((id) => getId(id));

      const offsetHours = getUTCOffset();
      const fortyEightHoursAgo = moment().subtract(48, "hours").utcOffset(offsetHours).format();
      
      const orders = await paginateData(
        true,
        req,
        1,
        "orders",
        {
          _id: { $in: oids },
          status: { $in: activeStatuses },
          orderDate: { $gte: fortyEightHoursAgo },
        },
        { created: -1 },
        currentDb // Pass the current database to paginateData
      );

      allOrders.push(...orders.data);
    }

    // Sort all orders by creation date
    allOrders.sort((a, b) => new Date(b.created) - new Date(a.created));

    res.status(200).json(allOrders);
  } catch (ex) {
    console.error(`Failed get customer active orders: ${ex}`);
    res.status(400).json({ message: "Failed to get customer active orders" });
  }
});

// Generate invoice image endpoint
router.post("/api/order/generate-invoice-image", auth.required, async (req, res) => {
  try {
    const { orderId, appName } = req.body;
    
    if (!orderId || !appName) {
      return res.status(400).json({ 
        success: false, 
        message: "orderId and appName are required" 
      });
    }

    const db = req.app.db['pizza-alshams'];
    if (!db) {
      return res.status(400).json({ 
        success: false, 
        message: "Database not found for appName" 
      });
    }

    // Get the order
    const order = await db.orders.findOne({ orderId: orderId });
    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: "Order not found" 
      });
    }

    // Get customer details
    const customerDB = getCustomerAppName(req, appName);
    const customer = await customerDB.customers.findOne({
      _id: getId(order.customerId),
    });

    // Get store data
    const storeData = await db.store.findOne({ id: 1 });

    // Generate invoice HTML
    const invoiceHTML = generateInvoiceHTML(order, customer, storeData);
    
    // Validate HTML content
    if (!invoiceHTML || invoiceHTML.trim().length === 0) {
      console.error(`Generated HTML is empty for order ${orderId}`);
      return res.status(500).json({ 
        success: false, 
        message: "Generated HTML is empty" 
      });
    }
    
    // Debug: Log the HTML content
    console.log(`Generated HTML for order ${orderId}:`, invoiceHTML.substring(0, 500) + '...');
    
    // Convert HTML to image
    const textToImage = require('text-to-image');
    const imageBuffer = await textToImage.generate(invoiceHTML, {
      maxWidth: 820,
      fontSize: 16,
      fontFamily: 'Arial',
      lineHeight: 24,
      margin: 20,
      bgColor: 'white',
      textColor: 'black'
    });

    // Validate the generated image buffer
    if (!imageBuffer || imageBuffer.length === 0) {
      console.error(`Generated image buffer is empty for order ${orderId}, trying fallback`);
      
      // Fallback: Generate a simple text-based image
      try {
        const fallbackText = `Order: ${orderId}\nCustomer: ${customer?.fullName || order?.name || 'Unknown'}\nTotal: ₪${getOrderTotalPrice(order)}`;
        const fallbackBuffer = await textToImage.generate(fallbackText, {
          maxWidth: 400,
          fontSize: 20,
          fontFamily: 'Arial',
          lineHeight: 30,
          margin: 20,
          bgColor: 'white',
          textColor: 'black'
        });
        
        if (fallbackBuffer && fallbackBuffer.length > 0) {
          console.log(`Generated fallback image for order ${orderId}, buffer size: ${fallbackBuffer.length} bytes`);
          res.setHeader('Content-Type', 'image/png');
          res.setHeader('Content-Disposition', `inline; filename="invoice-${orderId}.png"`);
          res.send(fallbackBuffer);
          return;
        }
      } catch (fallbackError) {
        console.error(`Fallback image generation also failed for order ${orderId}:`, fallbackError);
      }
      
      return res.status(500).json({ 
        success: false, 
        message: "Generated image is empty" 
      });
    }

    console.log(`Successfully generated image for order ${orderId}, buffer size: ${imageBuffer.length} bytes`);

    // Set response headers
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="invoice-${orderId}.png"`);
    
    // Send the image buffer
    res.send(imageBuffer);

  } catch (error) {
    console.error("Error generating invoice image:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to generate invoice image" 
    });
  }
});

// Helper function to get order total price
function getOrderTotalPrice(order) {
  return order?.total || 0;
}

// Helper function to generate invoice HTML
function generateInvoiceHTML(order, customer, storeData) {
  const moment = require('moment');
  const i18n = require('../locales/en.json'); // You might need to adjust this path

  const getShippingPrice = (order) => {
    return order.shippingPrice - (order.appliedCoupon?.coupon?.type === "free_delivery" ? order.appliedCoupon.discountAmount : 0);
  };

  const getIconByPaymentMethod = (method) => {
    switch (method) {
      case 'CASH': return '💵';
      case 'CARD': return '💳';
      default: return '💰';
    }
  };

  const getIconByShippingMethod = (method) => {
    switch (method) {
      case 'DELIVERY': return '🚚';
      case 'PICKUP': return '🏪';
      default: return '📦';
    }
  };

  // Generate items HTML
  const itemsHTML = order.order.items && order.order.items.length > 0 
    ? order.order.items.map(item => `
      <div style="margin: 10px 0; padding: 10px; border: 2px solid #000;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="flex: 1;">
            <span style="font-size: 18px; font-weight: bold;">X${item.qty || 1}</span>
            <span style="font-size: 18px; margin-left: 10px;">${item.nameAR || item.nameHE || item.name || 'Item'}</span>
          </div>
          <div style="font-size: 18px; font-weight: bold;">₪${(item.price || 0) * (item.qty || 1)}</div>
        </div>
      </div>
    `).join('')
    : '<div style="margin: 10px 0; padding: 10px; border: 2px solid #000; text-align: center;">No items</div>';

  return `
    <!DOCTYPE html>
    <html dir="rtl">
    <head>
      <meta charset="UTF-8">
      <style>
        body { 
          font-family: Arial, sans-serif; 
          margin: 0; 
          padding: 20px; 
          background: white; 
          direction: rtl;
          min-height: 200px;
        }
        .header { text-align: center; margin-bottom: 20px; }
        .logo { width: 200px; height: 100px; margin: 0 auto; }
        .customer-info { margin: 20px 0; text-align: center; }
        .customer-name { font-size: 24px; font-weight: bold; margin: 5px 0; }
        .customer-phone { font-size: 18px; margin: 5px 0; }
        .order-details { margin: 20px 0; }
        .order-row { 
          display: flex; 
          justify-content: space-between; 
          align-items: center; 
          padding: 10px; 
          border: 2px solid #000; 
          margin: 5px 0; 
        }
        .order-number { font-size: 20px; font-weight: bold; }
        .time-info { font-size: 18px; }
        .items-section { margin: 20px 0; }
        .total-section { 
          margin: 20px 0; 
          border-top: 3px solid #000; 
          padding-top: 10px; 
        }
        .total-row { 
          display: flex; 
          justify-content: space-between; 
          align-items: center; 
          padding: 5px 0; 
          font-size: 20px; 
          font-weight: bold; 
        }
        .note { margin: 10px 0; font-size: 16px; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="logo">🏪 ${storeData?.name_ar || storeData?.name_he || 'Store'}</div>
      </div>
      
      <div class="customer-info">
        <div class="customer-name">${customer?.fullName || order?.name || 'Customer'}</div>
        <div class="customer-phone">${customer?.phone || order?.phone || 'Phone'}</div>
      </div>
      
      <div class="order-details">
        <div class="order-row">
          <span>${getIconByPaymentMethod(order.order?.payment_method || 'UNKNOWN')} ${order.order?.payment_method || 'UNKNOWN'}</span>
          <span>${getIconByShippingMethod(order.order?.receipt_method || 'UNKNOWN')} ${order.order?.receipt_method || 'UNKNOWN'}</span>
        </div>
        
        <div class="order-row">
          <span>Order Sent Time:</span>
          <span>${moment(order.datetime || new Date()).format("HH:mm")}</span>
        </div>
        
        <div class="order-row">
          <span>Collect Time:</span>
          <span>${moment(order.orderDate || new Date()).format("HH:mm")}</span>
        </div>
        
        <div class="order-row">
          <span>Order Number:</span>
          <span class="order-number">${order.orderId || 'N/A'}</span>
        </div>
      </div>
      
      <div class="items-section">
        ${itemsHTML}
      </div>
      
      ${order.note ? `<div class="note"><strong>Note:</strong> ${order.note}</div>` : ''}
      
      ${order.order?.receipt_method === 'DELIVERY' ? `
        <div class="total-row">
          <span>Order Price:</span>
          <span>₪${order.orderPrice || 0}</span>
        </div>
        <div class="total-row">
          <span>Delivery Price:</span>
          <span>₪${getShippingPrice(order)}</span>
        </div>
      ` : ''}
      
      <div class="total-row">
        <span>Final Price:</span>
        <span>₪${getOrderTotalPrice(order)}</span>
      </div>
      
      ${order.order?.locationText ? `
        <div class="note">
          <strong>Address:</strong> ${order.order.locationText}
        </div>
      ` : ''}
    </body>
    </html>
  `;
}

module.exports = router;
