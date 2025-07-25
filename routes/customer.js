const express = require("express");
const router = express.Router();
const colors = require("colors");
const auth = require("./auth");
const smsService = require("../utils/sms");
const APP_CONSTS = require("../consts/consts");
const { paginateData } = require("../lib/paginate");
const moment = require("moment");
const utmTimeService = require("../utils/utc-time");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const pushNotification = require("../utils/push-notification");
const { getCustomerAppName } = require("../utils/app-name-helper");

const passport = require("passport");
const authService = require("../utils/auth-service");
const { getId, clearCustomer, sanitize } = require("../lib/common");
const rateLimit = require("express-rate-limit");
const { validateJson } = require("../lib/schema");
const { restrict } = require("../lib/auth");
const customerAddressController = require('../controllers/customerAddressController');
const { isTestAuth, isTestPhone } = require("../config/test-phones");

const apiLimiter = rateLimit({
  windowMs: 300000, // 5 minutes
  max: 5,
});

function compareVersions(version1, version2) {
  const v1Components = version1.split(".").map(Number);
  const v2Components = version2.split(".").map(Number);

  for (let i = 0; i < Math.max(v1Components.length, v2Components.length); i++) {
    const v1Part = v1Components[i] || 0;
    const v2Part = v2Components[i] || 0;

    if (v1Part > v2Part) {
      return true;
      // return `${version1} is greater than ${version2}`;
    } else if (v1Part < v2Part) {
      return false;

      //return `${version1} is less than ${version2}`;
    }
  }
  return true;
  //return `${version1} is equal to ${version2}`;
}

router.post("/api/customer/validateAuthCode", async (req, res) => {
  const appName = req.headers["app-name"];
  const appType = req.headers["app-type"];
  const db = req.app.db[appName];
  const customerObj = {
    phone: req.body.phone,
    authCode: req.body.authCode,
  };
  let customer = null;
  let customerDB = null;
  let collection = null;
  if(appType === 'shoofi-shoofir'){
    const deliveryDB = req.app.db['delivery-company'];
    customer = await deliveryDB.customers.findOne({ phone: customerObj.phone });
    customerDB = deliveryDB;
    collection = "customers";
  }else if(appType === 'shoofi-partner'){
    const shoofiDB = req.app.db['shoofi'];
    customer = await shoofiDB.storeUsers.findOne({ phone: customerObj.phone });
    customerDB = shoofiDB;
    collection = "storeUsers";
  }else{
    const shoofiDB = req.app.db['shoofi'];
    customer = await shoofiDB.customers.findOne({ phone: customerObj.phone });
    customerDB = shoofiDB;
    collection = "customers";
  }
  if (customer === undefined || customer === null) {
    res.status(400).json({
      message: "A customer with that phone does not exist.",
    });
    return;
  }

  if (
    customer.authCode == customerObj.authCode ||
    isTestAuth(customerObj.phone, customerObj.authCode)
  ) {
    const customerNewUpdate = {
      ...customer,
      authCode: undefined,
    };

    try {
      authService.toAuthJSON(customerNewUpdate, req).then(async (result) => {
          const updatedCustomer = await customerDB[collection].findOneAndUpdate(
          { _id: getId(customer._id) },
          {
            $set: result,
          },
          { multi: false, returnOriginal: false }
        );

        res
          .status(200)
          .json({ message: "Customer updated", data: updatedCustomer.value });
      });
    } catch (ex) {
      console.error(colors.red(`Failed updating customer: ${ex}`));
      res
        .status(400)
        .json({ message: "Failed to update customer", error_code: -1 });
    }
  } else {
    res.status(200).json({
      err_code: -3,
    });
    return;
  }
});

router.post("/api/customer/create", async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const shoofiDB = req.app.db['shoofi'];
  const deliveryDB = req.app.db['delivery-company'];
  const appType = req.headers["app-type"];
  const random4DigitsCode = Math.floor(1000 + Math.random() * 9000);
  const customerObj = {
    phone: sanitize(req.body.phone),
    authCode: random4DigitsCode,
    created: new Date(),
    addresses: [],
  };

  // const schemaResult = validateJson("newCustomer", customerObj);
  // if (!schemaResult.result) {
  //   res.status(400).json(schemaResult.errors);
  //   return;
  // }

  
  let customer = null;
  let customerDB = null;
  let findByKey= null;
  let collection = null;
  if(appType === 'shoofi-shoofir'){
    customer = await deliveryDB.customers.findOne({ phone: req.body.phone });
    customerDB = deliveryDB;
    findByKey = "phone";
    collection = "customers";
  }else if(appType === 'shoofi-partner'){
    customer = await shoofiDB.storeUsers.findOne({ phone: req.body.phone });
    customerDB = shoofiDB;
    findByKey = "phone";
    collection = "storeUsers";
  }else{
    customer = await shoofiDB.customers.findOne({ phone: req.body.phone });
    customerDB = shoofiDB;
    findByKey = "phone";
    collection = "customers";
  }

  if (customer) {
      const updatedCustomer = await customerDB[collection].findOneAndUpdate(
      { [findByKey]: req.body.phone },
      {
        $set: { ...customer, authCode: random4DigitsCode, token: null },
      },
      { multi: false, returnOriginal: false }
    );
    if (!isTestPhone(customer.phone)) {
      const smsContent = smsService.getVerifyCodeContent(
        random4DigitsCode,
        req.body?.language
      );
      await smsService.sendSMS(customer.phone, smsContent, req);
    }
    res
      .status(200)
      .json({ phone: req.body.phone, isBlocked: customer.isBlocked });
    return;
  }

  if(appType === 'shoofi-shoofir' || appType === 'shoofi-partner'){
    res.status(400).json({
      message: "الرجاء التواصل مع الدعم الفني للحصول على المساعدة",
    });
    return;
  }

  try {
    await customerDB[collection].insertOne(customerObj);
    if (!isTestPhone(customerObj.phone)) {
      const smsContent = smsService.getVerifyCodeContent(
        random4DigitsCode,
        req.body?.language
      );
      await smsService.sendSMS(customerObj.phone, smsContent, req);
    }
    res.status(200).json(customerObj);
  } catch (ex) {
    console.error(colors.red("Failed to insert customer: ", ex));
    res.status(400).json({
      message: "Customer creation failed.",
    });
  }
});

router.post("/api/customer/create/lead", async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const customerDB = getCustomerAppName(req, appName);
  const customerObj = {
    fullName: req.body.fullName,
    phone: sanitize(req.body.phone),
    branchId: req.body.branchId,
    created: new Date(),
    status: APP_CONSTS.USER_STATUS.LEAD,
    coursesList: [],
    preferredDays: req.body.preferredDays || [],
    email: req.body.email || '',
    acceptEmails: req.body.acceptEmails || false,
    preferSummer: req.body.preferSummer || false
  };

  // const customer = await db.customers.findOne({ phone: req.body.phone });
  // if (customer) {
  //   const updatedCustomer = await db.customers.findOneAndUpdate(
  //     { phone: req.body.phone },
  //     {
  //       $set: { ...customer, authCode: random4DigitsCode, token: null },
  //     },
  //     { multi: false, returnOriginal: false }
  //   );
  //   if (
  //     // customer.phone !== "0542454362" &&
  //     customer.phone !== "0528602121" &&
  //     customer.phone !== "1234567891" &&
  //     customer.phone !== "1234567892" &&
  //     customer.phone !== "1234567893" &&
  //     customer.phone !== "1234567894" &&
  //     customer.phone !== "1234567895" &&
  //     customer.phone !== "1234567899"
  //   ) {
  //     const smsContent = smsService.getVerifyCodeContent(random4DigitsCode, req.body?.language);
  //     await smsService.sendSMS(customer.phone, smsContent, req);
  //   }
  //   res.status(200).json({ phone: req.body.phone, isBlocked: customer.isBlocked  });
  //   return;
  // }

  try {
    await customerDB.customers.insertOne(customerObj);
    pushNotification.pushToClient(
      "66a66acf5ae71b2df134b989",
      "تسجيل جديد",
      { type: APP_CONSTS.NOTEFICATION_TYPES_WOF.NEW_LEAD },
      req
    );
    const smsContent = smsService.wofLeadRegisterContent(customerObj.fullName, customerObj.phone, customerObj.branchId, customerObj.preferredDays);
    await smsService.sendSMS("0509088100", smsContent, req);
    await smsService.sendSMS("0542454362", smsContent, req);
    res.status(200).json(customerObj);
  } catch (ex) {
    console.error(colors.red("Failed to insert customer lead: ", ex));
    res.status(400).json({
      message: "Customer lead creation failed.",
    });
  }
});

router.post("/api/customer/admin-create", async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const customerDB = getCustomerAppName(req, appName);

  const customerObj = {
    phone: sanitize(req.body.phone),
    created: new Date(),
  };

  const schemaResult = validateJson("newCustomer", customerObj);
  if (!schemaResult.result) {
    res.status(400).json(schemaResult.errors);
    return;
  }

  const customer = await customerDB.customers.findOne({ phone: req.body.phone });
  if (customer) {
    res.status(200).json({
      phone: customer.phone,
      fullName: customer.fullName,
      isAdmin: customer.isAdmin,
      customerId: customer._id,
      isBlocked: customer.isBlocked,
      isExist: true,
    });
    return;
  }
  // email is ok to be used.
  try {
    const newCustomer = await customerDB.customers.insertOne(customerObj);
    const customerInsertedId = newCustomer.insertedId;
    const customer = await customerDB.customers.findOne({
      _id: getId(customerInsertedId),
    });
    res.status(200).json({
      phone: customer.phone,
      fullName: customer.fullName,
      isAdmin: customer.isAdmin,
      customerId: customer._id,
    });
  } catch (ex) {
    console.error(colors.red("Failed to insert customer: ", ex));
    res.status(400).json({
      message: "Customer creation failed.",
    });
  }
});

router.post("/api/customer/orders-old", auth.required, async (req, res) => {
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
    if (customer.orders) {
      var ids = customer.orders;

      var oids = [];
      ids.forEach(function (item) {
        oids.push(getId(item));
      });

      const orders = await paginateData(
        true,
        req,
        1,
        "orders",
        {
          _id: { $in: oids },
        },
        { created: -1 }
      );
      res.status(200).json(orders);
    } else {
      res.status(200).json([]);
    }
  } catch (ex) {
    console.error(colors.red(`Failed get customer: ${ex}`));
    res.status(400).json({ message: "Failed to get customer" });
  }
});

router.post("/api/customer/orders", auth.required, async (req, res) => {
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
    customer.orders.forEach(order => {
      const appNameTmp = order.appName || appName; // Use the order's db if specified, otherwise use current app
      if (!ordersByAppName[appNameTmp]) {
        ordersByAppName[appNameTmp] = [];
      }
      ordersByAppName[appNameTmp].push(order.appName ? order.orderId : order);
    });

    // Fetch orders from each database
    const allOrders = [];
    for (const [dbName, orderIds] of Object.entries(ordersByAppName)) {
      const currentDb = req.app.db[dbName];
      const oids = orderIds.map(id => getId(id));
      
      const orders = await paginateData(
        true,
        req,
        1,
        "orders",
        {
          _id: { $in: oids },
        },
        { created: -1 },
        currentDb // Pass the current database to paginateData
      );
      
      allOrders.push(...orders.data);
    }

    // Sort all orders by creation date
    allOrders.sort((a, b) => new Date(b.created) - new Date(a.created));

    res.status(200).json({
      data: allOrders,
      totalItems: allOrders.length,
      totalPages: 1,
      currentPage: 1
    });
  } catch (ex) {
    console.error(colors.red(`Failed get customer orders: ${ex}`));
    res.status(400).json({ message: "Failed to get customer orders" });
  }
});

router.get("/api/customer/details", auth.required, async (req, res) => {
  const customerId = req.auth.id;
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const deliveryDB = req.app.db['delivery-company'];
  const shoofiDB = req.app.db['shoofi'];
  const appType = req.headers["app-type"];
  let customer = null;
  let customerDB = null;


  try {
    if(appType === 'shoofi-shoofir'){
      const driverCustomer = await deliveryDB.customers.findOne({ _id: getId(customerId), });  
      if(driverCustomer){
        customer = driverCustomer;
        customerDB = deliveryDB;
      }else{
        customer = await shoofiDB.customers.findOne({ _id: getId(customerId), });
        customerDB = shoofiDB;
      }
    }else if(appType === 'shoofi-partner'){
      customer = await shoofiDB.storeUsers.findOne({ _id: getId(customerId), });
      customerDB = shoofiDB;
    }else{
      customer = await shoofiDB.customers.findOne({ _id: getId(customerId), });
      customerDB = shoofiDB;
    }
    if (!customer) {
      res.status(400).json({
        message: "Customer not found",
      });
      return;
    }


    res.status(200).json({
      message: "Customer details get success",
      data: {
        phone: customer.phone,
        fullName: customer.fullName,
        isAdmin: customer.isAdmin,
        customerId,
        roles: customer.roles,
        planId: customer?.planId,
        branchId: customer?.branchId,
        status: customer?.status,
        appName: customer?.appName,
        isDriver: customer?.isDriver
      },
    });
  } catch (ex) {
    console.error(colors.red(`Failed get customer: ${ex}`));
    res.status(400).json({ message: "Failed to get customer" });
  }
});

router.post("/api/customer/update-name", auth.required, async (req, res) => {
  const customerId = req.body.customerId || req.auth.id;
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const customerDB = getCustomerAppName(req, appName);
  const appType = req.headers["app-type"];
  let collection = null;
  const customerObj = {
    fullName: req.body.fullName,
  };

  if(appType === 'shoofi-shoofir'){
    customer = await customerDB.customers.findOne({
      _id: getId(customerId),
    });
    collection = "customers";
  }else if(appType === 'shoofi-partner'){
    customer = await customerDB.storeUsers.findOne({ _id: getId(customerId), });
    collection = "storeUsers";
  }else{
    customer = await customerDB.customers.findOne({ _id: getId(customerId), });
    collection = "customers";
  }
  if (!customer) {
    res.status(400).json({
      message: "Customer not found",
    });
    return;
  }
  try {
    const updatedCustomer = await customerDB[collection].findOneAndUpdate(
      { _id: getId(customerId) },
      {
        $set: { ...customer, fullName: req.body.fullName },
      },
      { multi: false, returnOriginal: false }
    );
    res.status(200).json({
      message: "Customer updated",
      customer: { fullName: updatedCustomer.value.fullName },
    });
  } catch (ex) {
    console.error(colors.red(`Failed updating customer: ${ex}`));
    res.status(400).json({ message: "Failed to update customer" });
  }
});

router.post("/api/customer/update", auth.required, async (req, res) => {
  const customerId = req.body.customerId || req.auth.id;
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const customerDB = getCustomerAppName(req, appName);

  const updateData = req.body;
  delete updateData._id;

  const customer = await customerDB.customers.findOne({
    _id: getId(customerId),
  });
  if (!customer) {
    res.status(400).json({
      message: "Customer not found",
    });
    return;
  }
  try {
    const updatedCustomer = await customerDB.customers.findOneAndUpdate(
      { _id: getId(customerId) },
      {
        $set: { ...customer, ...updateData },
      },
      { multi: false, returnOriginal: false }
    );
    res.status(200).json({
      message: "Customer updated",
    });
  } catch (ex) {
    console.error(colors.red(`Failed updating customer: ${ex}`));
    res.status(400).json({ message: "Failed to update customer" });
  }
});

router.post("/api/customer/lead/update", auth.required, async (req, res) => {
  const customerId = req.body.customerId || req.auth.id;
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const customerDB = getCustomerAppName(req, appName);

  const updateData = req.body;
  delete updateData._id;

  const customer = await customerDB.customers.findOne({
    _id: getId(customerId),
  });
  if (!customer) {
    res.status(400).json({
      message: "Customer not found",
    });
    return;
  }
  try {
    const updatedCustomer = await customerDB.customers.findOneAndUpdate(
      { _id: getId(customerId) },
      {
        $set: {
          fullName: updateData.fullName,
          status: updateData.status,
        },
        $push: { coursesList: updateData?.coursePackage },
      },
      { multi: false, returnOriginal: false }
    );
    const stores = await db.store.find().toArray();
    const branch = stores[0];
    const appleAppLink = `itms-apps://itunes.apple.com/app/${branch.appleAppId}`;
    const androidAppLink = `https://play.google.com/store/apps/details?id=${branch.androidAppId}`;
    const smsContent = smsService.wofLeadAssignedToCourseContent(
      customer.fullName,
      appleAppLink,
      androidAppLink,
      updateData?.payLink
    );
    await smsService.sendSMS(updatedCustomer.phone, smsContent, req);
    res.status(200).json({
      message: "Customer updated",
    });
  } catch (ex) {
    console.error(colors.red(`Failed updating customer: ${ex}`));
    res.status(400).json({ message: "Failed to update customer" });
  }
});


// world of swimming START

router.post("/api/customer/lead/update/status", auth.required, async (req, res) => {
  const customerId = req.body.customerId || req.auth.id;
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const customerDB = getCustomerAppName(req, appName);

  const updateData = req.body;
  delete updateData._id;

  const customer = await customerDB.customers.findOne({
    _id: getId(customerId),
  });
  if (!customer) {
    res.status(400).json({
      message: "Customer not found",
    });
    return;
  }
  try {
    const updatedCustomer = await customerDB.customers.findOneAndUpdate(
      { _id: getId(customerId) },
      {
        $set: {
          ...updateData
        },
      },
      { multi: false, returnOriginal: false }
    );
    res.status(200).json({
      message: "Customer updated",
    });
  } catch (ex) {
    console.error(colors.red(`Failed updating customer: ${ex}`));
    res.status(400).json({ message: "Failed to update customer" });
  }
});

router.post("/api/customer/update-plan", auth.required, async (req, res) => {
  const customerId = req.body.customerId || req.auth.id;
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
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
  21;
  try {
    await customerDB.customers.findOneAndUpdate(
      { _id: getId(customerId) },
      {
        $set: { ...customer, planId: req.body.planId },
      },
      { multi: false, returnOriginal: false }
    );
    res.status(200).json({
      message: "Customer updated",
    });
  } catch (ex) {
    console.error(colors.red(`Failed updating customer plan id: ${ex}`));
    res.status(400).json({ message: "Failed to update customer plan id" });
  }
});

router.post(
  "/api/customer/update-plan-branch",
  auth.required,
  async (req, res) => {
    const customerId = req.body.customerId || req.auth.id;
    const appName = req.headers["app-name"];
    const db = req.app.db[appName];
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
    21;
    try {
      await customerDB.customers.findOneAndUpdate(
        { _id: getId(customerId) },
        {
          $set: {
            ...customer,
            planId: req.body.planId,
            branchId: req.body.branchId,
          },
        },
        { multi: false, returnOriginal: false }
      );
      res.status(200).json({
        message: "Customer updated",
      });
    } catch (ex) {
      console.error(colors.red(`Failed updating customer plan id: ${ex}`));
      res.status(400).json({ message: "Failed to update customer plan id" });
    }
  }
);

// world of swimming END

// logout the customer
router.post("/api/customer/logout", auth.required, async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const {
    auth: { id },
  } = req;
  const customerDB = getCustomerAppName(req, appName);
  await customerDB.customers.findOneAndUpdate(
    { _id: getId(id) },
    {
      $set: { token: null },
    },
    { multi: false, returnOriginal: false }
  );

  res.status(200).json({ data: "logout success" });
});

router.post("/api/customer/delete", auth.required, async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const appType = req.headers['app-type'];
  const {
    auth: { id },
  } = req;
  let customerDB = null;
  let collection = null;
  if(appType === 'shoofi-shoofir'){
    customerDB = req.app.db['delivery-company'];
    collection = "customers";
  }else if(appType === 'shoofi-partner'){
    customerDB = req.app.db['shoofi'];
    collection = "storeUsers";
  }else{
    customerDB = req.app.db['shoofi'];
    collection = "customers";
  }
  await customerDB[collection].deleteOne({ _id: getId(id) });
  res.status(200).json({ data: "blocked success" });
});

// logout the customer
router.get("/customer/logout", (req, res) => {
  // Clear our session
  clearCustomer(req);
  res.redirect("/customer/login");
});

router.post("/api/customer/search-customer", async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const customerDB = getCustomerAppName(req, appName);
  const searchQuery = req.body.searchQuery;
  const userStatus = req.body?.userStatus;
  const page = parseInt(req.body.page) || 1;
  const limit = parseInt(req.body.limit) || 20;
  const skip = (page - 1) * limit;
  
  let query = {};

  if (searchQuery && searchQuery.trim().length >= 3) {
    // Use text search if available, otherwise use regex
    if (searchQuery.trim().length >= 3) {
      query = {
        $or: [
          { phone: { $regex: `^${searchQuery}`, $options: "i" } }, // Starts with for better performance
          { fullName: { $regex: searchQuery, $options: "i" } },
        ],
      };
    }
  }

  try {
    // Get total count for pagination
    const totalCount = await customerDB.customers.countDocuments(query);
    
    // Get paginated results
    const customers = await customerDB.customers
      .find(query)
      .sort({ fullName: 1 }) // Sort by name for consistent results
      .skip(skip)
      .limit(limit)
      .project({ 
        _id: 1, 
        fullName: 1, 
        phone: 1,
        email: 1 
      }) // Only return needed fields
      .toArray();

    res.status(200).json({
      customers,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit)
      }
    });
  } catch (ex) {
    console.error(colors.red("Failed to search customer: ", ex));
    res.status(400).json({
      message: "Customer search failed.",
    });
  }
});

function relDiff(a, b) {
  let diff = 100 * Math.abs((a - b) / ((a + b) / 2));
  if (a < b) {
    diff = diff * -1;
  }
  return diff.toFixed(2);
}

router.post("/api/customer/new-customers/:page?", async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const customerDB = getCustomerAppName(req, appName);
  let pageNum = 1;
  if (req.body.pageNumber) {
    pageNum = req.body.pageNumber;
  }
  var start = moment().subtract(7, "days").utcOffset(120);
  start.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });

  var end = moment().utcOffset(120);
  end.set({ hour: 23, minute: 59, second: 59, millisecond: 999 });
  const filterBy = {
    created: { $gte: new Date(start), $lt: new Date(end) },
  };
  let newCustomers = await paginateData(
    true,
    req,
    pageNum,
    "customers",
    filterBy,
    {
      created: 1,
    }
  );

  var start2 = moment().subtract(14, "days").utcOffset(120);
  start2.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });

  var end2 = moment().subtract(8, "days").utcOffset(120);
  end2.set({ hour: 23, minute: 59, second: 59, millisecond: 999 });
  const filterBy2 = {
    created: { $gte: new Date(start2), $lt: new Date(end2) },
  };
  const prevWeekNewCustomers = await paginateData(
    true,
    req,
    pageNum,
    "customers",
    filterBy2,
    {
      created: 1,
    }
  );
  const percentDeff = relDiff(
    newCustomers.totalItems,
    prevWeekNewCustomers.totalItems
  );
  newCustomers.percentDeff = percentDeff;
  try {
    res.status(200).json(newCustomers);
  } catch (ex) {
    console.error(colors.red("Failed to search customer: ", ex));
    res.status(400).json({
      message: "Customer search failed.",
    });
  }
});

router.post("/api/customer/get-customers/:page?", async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const customerDB = getCustomerAppName(req, appName);
  let pageNum = 1;
  if (req.body.pageNumber) {
    pageNum = req.body.pageNumber;
  }
  let filterBy = req.body.filterBy;

  if (filterBy?._id) {
    if (Array.isArray(filterBy._id)) {
      // Convert array of strings to ObjectIds
      filterBy._id = { $in: filterBy._id.map((id) => getId(id)) };
    } else {
      // Convert single string to ObjectId
      filterBy._id = getId(filterBy._id);
    }
  }
  let customers = [];
  if (appName === "world-of-swimming") {
    const customersRes = await customerDB.customers.find(filterBy).toArray();
 customers = await Promise.all(
  customersRes.map(async (customer) => {
    const courseInList = customer.coursesList?.find(course =>{
      if(filterBy['coursesList.courseId']){
        if(course.courseId?.toString() === filterBy['coursesList.courseId'].toString()){
          return course;
        }
      }else{
        if(course.isActive){
          return course;
        }
      }
    }
      
    );

    if (courseInList) {
      const courseData = await db.courses.findOne({ _id: getId(courseInList.courseId) });
      customer.courseData = courseData;
      customer.coursePackage = courseInList;
    }

    return customer;
  })
);

  } else {
    customers = await paginateData(true, req, pageNum, "customers", filterBy, {
      created: 1,
    });
  }

  try {
    res.status(200).json(customers);
  } catch (ex) {
    console.error(colors.red("Failed to get customers: ", ex));
    res.status(400).json({
      message: "Customers get failed.",
    });
  }
});

router.post(
  "/api/customer/update-notification-token",
  auth.required,
  async (req, res) => {
    const customerId = req.body.customerId || req.auth.id;
    const appName = req.headers["app-name"];  
    const db = req.app.db[appName];
    const appType = req.headers['app-type'];

    let customer = null;
    let customerDB = null;
    let collection = null;
    if(appType === 'shoofi-shoofir'){
      const deliveryDB = req.app.db['delivery-company'];
      customer = await deliveryDB.customers.findOne({  _id: getId(customerId), });
      customerDB = deliveryDB;
      collection = "customers";
    }else if(appType === 'shoofi-partner'){
      const shoofiDB = req.app.db['shoofi'];
      customer = await shoofiDB.storeUsers.findOne({  _id: getId(customerId), });
      customerDB = shoofiDB;
      collection = "storeUsers";
    }else{
      const shoofiDB = req.app.db['shoofi'];
      customer = await shoofiDB.customers.findOne({  _id: getId(customerId), });
      customerDB = shoofiDB;
      collection = "customers";
    }


    if (!customer) {
      res.status(200).json({
        message: "Customer not found",
      });
      return;
    }
    try {
      const updatedCustomer = await customerDB[collection].findOneAndUpdate(
        { _id: getId(customerId) },
        {
          $set: { notificationToken: req.body.notificationToken },
        },
        { multi: false }
      );
      res.status(200).json({
        message: "Customer updated",
        customer: {
          notificationToken: updatedCustomer.value.notificationToken,
        },
      });
    } catch (ex) {
      console.error(colors.red(`Failed updating customer: ${ex}`));
      res.status(200).json({ message: "Failed to update customer" });
    }
  }
);

router.post("/api/customer/pay", auth.required, async (req, res, next) => {
  const customerId = req.body.customerId || req.auth.id;

  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const customerDB = getCustomerAppName(req, appName);
  const parsedBodey = req.body;

  try {
    const storeData = await db.store.findOne({ id: 1 });
    const paymentData = {};
    const customer = await customerDB.customers.findOne({
      _id: getId(customerId),
    });
    if (!customer) {
      res.status(400).json({
        message: "Customer not found",
      });
      return;
    }

    const zdCreditCredentials = storeData.credentials;

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
        // if (response.data.HasError) {
        //   // await db.orders.deleteOne({ _id: parsedBodey.orderId });
        //   await db.orders.updateOne(
        //     {
        //       _id: getId(parsedBodey.orderId),
        //     },
        //     {
        //       $set: {
        //         ccPaymentRefData: {
        //           payload: parsedBodey,
        //           data: response.data,
        //         },
        //         status: "0",
        //       },
        //     },
        //     { multi: false }
        //   );
        //   res.status(200).json(response.data);
        //   return;
        // }
        const offsetHours = utmTimeService.getUTCOffset();
        let current = moment().utcOffset(offsetHours);

        await customerDB.customers.updateOne(
          {
            _id: getId(customerId),
          },
          {
            $push: {
              paymentHistory: {
                data: parsedBodey,
                zCreditResponse: response.data,
                date: current,
                status: "2",
              },
            },
          },
          { multi: false }
        );

        // const finalpaymentData = {
        //   ...paymentData,
        //   customerDetails: {
        //     name: customer.fullName,
        //     phone: customer.phone,
        //   },
        // };
        // websockets.fireWebscoketEvent("new order", finalpaymentData);

        // const smsContent = smsService.getOrderRecivedContent(
        //   customer.fullName,
        //   paymentData.total,
        //   paymentData.order.receipt_method,
        //   paymentData.orderId,
        //   paymentData.app_language
        // );
        // await smsService.sendSMS(customer.phone, smsContent, req);
        // await smsService.sendSMS("0542454362", smsContent, req);

        // setTimeout(async () => {
        // await invoiceMailService.saveInvoice(docId, req);

        // await turl
        //   .shorten(
        //     `https://creme-caramel-images.fra1.cdn.digitaloceanspaces.com/invoices/doc-${docId}.pdf`
        //   )
        //   .then(async (res) => {
        //     await db.orders.updateOne(
        //       {
        //         _id: getId(parsedBodey.orderId),
        //       },
        //       {
        //         $set: {
        //           ccPaymentRefData: {
        //             payload: parsedBodey,
        //             data: response.data,
        //             url: res,
        //           },
        //         },
        //       },
        //       { multi: false }
        //     );

        //     // const invoiceSmsContent =
        //     //   smsService.getOrderInvoiceContent(res);
        //     // //smsService.sendSMS(customer.phone, smsContent, req);
        //     // smsService.sendSMS("0542454362", invoiceSmsContent, req);
        //   })
        //   .catch((err) => {
        //     //res.status(400).json({ errorMessage: err?.message });
        //   });

        // res.status(200).json(response.data);
      });
    // }, 120000);
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
  } catch (err) {
    res.status(400).json({ errorMessage: err?.message });
  }
});

router.post(
  "/api/customer/add/payment",
  auth.required,
  async (req, res, next) => {
    const { customerId, courseId, data } = req.body;

    const appName = req.headers["app-name"];
    const db = req.app.db[appName];
    const customerDB = getCustomerAppName(req, appName);

    const customer = await customerDB.customers.findOne({
      _id: getId(customerId),
    });

    if (!customer) {
      res.status(400).json({ message: "Customer not found" });
      return;
    }

    const offsetHours = utmTimeService.getUTCOffset();
    const currentTime = moment().utcOffset(offsetHours).format();

    const paymentRecord = {
      courseId,
      data,
      created: currentTime,
      id: uuidv4(),
    };

    const updateResult = await customerDB.customers.updateOne(
      {
        _id: getId(customerId),
        "coursesList.courseId": courseId, // Find the correct course in the array
      },
      {
        $push: {
          "coursesList.$.paymentHistory": paymentRecord, // Push into the matched course's paymentHistory
        },
      }
    );

    if (updateResult.modifiedCount === 0) {
      res.status(400).json({ message: "Failed to add payment - course not found" });
      return;
    }

    res.status(200).json({ message: "Payment added successfully" });
  }
);

// Address management endpoints
router.post('/api/customer/:customerId/addresses/add', customerAddressController.addAddress);
router.get('/api/customer/:customerId/addresses', customerAddressController.getAddresses);
router.put('/api/customer/:customerId/addresses/:addressId', customerAddressController.updateAddress);
router.delete('/api/customer/:customerId/addresses/:addressId', customerAddressController.deleteAddress);
router.patch('/api/customer/:customerId/addresses/:addressId/default', customerAddressController.setDefaultAddress);

// Get customer by ID for admin use
router.get('/api/customer/:customerId', async (req, res) => {
  const appName = req.headers["app-name"];
  const customerDB = getCustomerAppName(req, appName);
  
  try {
    const customer = await customerDB.customers.findOne({
      _id: getId(req.params.customerId)
    });
    
    if (!customer) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }
    
    res.status(200).json({
      _id: customer._id,
      fullName: customer.fullName,
      phone: customer.phone
    });
  } catch (error) {
    console.error('Error fetching customer:', error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Store Users Management Routes
router.get('/api/customer/store-users/:appName', async (req, res) => {
  const shoofiDB = req.app.db['shoofi'];
  
  try {
    const users = await shoofiDB.storeUsers.find({
      appName: req.params.appName
    }).toArray();
    
    res.status(200).json({
      data: users
    });
  } catch (error) {
    console.error('Error fetching store users:', error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get('/api/customer/store-users/:appName/:userId', async (req, res) => {
  const shoofiDB = req.app.db['shoofi'];
  
  try {
    const user = await shoofiDB.storeUsers.findOne({
      _id: getId(req.params.userId),
      appName: req.params.appName
    });
    
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    
    res.status(200).json({
      data: user
    });
  } catch (error) {
    console.error('Error fetching store user:', error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post('/api/customer/store-users/:appName', async (req, res) => {
  const shoofiDB = req.app.db['shoofi'];
  
  try {
    // Check if user already exists
    const existingUser = await shoofiDB.storeUsers.findOne({
      phone: req.body.phone,
      appName: req.params.appName
    });
    
    if (existingUser) {
      res.status(400).json({ message: "User with this phone number already exists" });
      return;
    }
    
    const userData = {
      phone: req.body.phone,
      fullName: req.body.fullName,
      isAdmin: req.body.isAdmin || false,
      roles: req.body.roles || [],
      appName: req.params.appName,
      created: new Date(),
      orders: []
    };
    
    const result = await shoofiDB.storeUsers.insertOne(userData);
    
    res.status(201).json({
      message: "User created successfully",
      data: { ...userData, _id: result.insertedId }
    });
  } catch (error) {
    console.error('Error creating store user:', error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.put('/api/customer/store-users/:appName/:userId', async (req, res) => {
  const shoofiDB = req.app.db['shoofi'];
  
  try {
    const updateData = {
      fullName: req.body.fullName,
      isAdmin: req.body.isAdmin || false,
      roles: req.body.roles || []
    };
    
    const result = await shoofiDB.storeUsers.findOneAndUpdate(
      {
        _id: getId(req.params.userId),
        appName: req.params.appName
      },
      {
        $set: updateData
      },
      { returnOriginal: false }
    );
    
    if (!result.value) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    
    res.status(200).json({
      message: "User updated successfully",
      data: result.value
    });
  } catch (error) {
    console.error('Error updating store user:', error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.delete('/api/customer/store-users/:appName/:userId', async (req, res) => {
  const shoofiDB = req.app.db['shoofi'];
  
  try {
    const result = await shoofiDB.storeUsers.deleteOne({
      _id: getId(req.params.userId),
      appName: req.params.appName
    });
    
    if (result.deletedCount === 0) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    
    res.status(200).json({
      message: "User deleted successfully"
    });
  } catch (error) {
    console.error('Error deleting store user:', error);
    res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
