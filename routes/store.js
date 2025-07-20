const express = require("express");
const router = express.Router();
const moment = require("moment");
const { getId } = require("../lib/common");
const { paginateData } = require("../lib/paginate");
const websockets = require("../utils/websockets");
const storeService = require("../utils/store-service")
const websocketService = require("../services/websocket/websocket-service");
const momentTZ = require("moment-timezone");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });
const { uploadFile, deleteImages } = require("./product");

function getUTCOffset() {
  const guessed = momentTZ.tz.guess(); 
  console.log("guessed",guessed); 
  const israelTimezone = "Asia/Jerusalem";

  const guessedTime = momentTZ.tz(guessed);
  const guessedOffsetMinutes = guessedTime.utcOffset();
  console.log("guessedOffsetMinutes",guessedOffsetMinutes)

  if(guessed === israelTimezone){
    return 0;
  }

  // Get the current time in UTC
  const utcTime = moment.utc();

  // Get the current time in Israel timezone
  const israelTime = momentTZ.tz(israelTimezone);

  // Get the UTC offset in minutes for Israel
  const israelOffsetMinutes = israelTime.utcOffset();
  console.log("israelOffsetMinutes", israelOffsetMinutes)
  // Convert the offset to hours
  return israelOffsetMinutes;
}

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

router.post("/api/store/get-by-name", async (req, res, next) => {
  const appName = req.body.appName;
  const db = req.app.db[appName];

  const store = await db.store.findOne({ id: 1 });
  const storeStatus = storeService.isStoreOpenNow(store.openHours);
  const isStoreOpen = storeStatus.isOpen && !store.isStoreClose;

  res.status(200).json({
    isOpen: isStoreOpen,
    workingHours: storeStatus.workingHours
  });
});

router.get("/api/store/get/:appName?", async (req, res) => {
  const appName = req.params.appName;
  const db = req.app.db[appName];
  const store = await db.store.findOne({ });
  res.status(200).json(store);
});

router.post("/api/store", async (req, res, next) => {
  console.time('myFunctionTime2');

  let pageNum = 1;
  if (req.params.page) {
    pageNum = req.params.page;
  }

  let stores = await paginateData(false, req, pageNum, "store", {});

  stores.data = await Promise.all(
    stores.data.map(async (store) => {
      const storeStatus = storeService.isStoreOpenNow(store.openHours);
      const isStoreOpen = storeStatus.isOpen && !store.isStoreClose;
      let isDeliveryOpen = store.delivery_support;
      // if (store.delivery_support && store.isSendNotificationToDeliveryCompany) {
      //   const isCompanyOpen = await storeService.isDeliveryCompanyOpen(req);
      //   isDeliveryOpen = isCompanyOpen;
      // }
      delete store.credentials;
      return {
        ...store,
        isOpen: isStoreOpen,
        workingHours: storeStatus.workingHours,
        isDeliveryOpen,
        delivery_support: isDeliveryOpen
      };
    })
  );
  console.timeEnd('myFunctionTime2');

  res.status(200).json(stores);
});

router.post("/api/store/update", async (req, res, next) => {
  const appName = req.headers['app-name'];
  const db = req.app.db[appName];
  let pageNum = 1;
  if (req.params.page) {
    pageNum = req.params.page;
  }
  let storeDoc = req.body.data || req.body;
  const id = storeDoc._id;
  delete storeDoc._id;
  
  // Get the current store data to check if status is changing
  const currentStore = await db.store.findOne({ _id: getId(id) });
  const isStatusChanging = currentStore && (
    currentStore.isOpen !== storeDoc.isOpen || 
    currentStore.isStoreClose !== storeDoc.isStoreClose ||
    currentStore.isBusy !== storeDoc.isBusy ||
    currentStore.business_visible !== storeDoc.business_visible ||
    currentStore.isCoomingSoon !== storeDoc.isCoomingSoon ||
    JSON.stringify(currentStore.openHours) !== JSON.stringify(storeDoc.openHours)
  );
  

  
  await db.store.updateOne({ _id: getId(id) }, { $set: storeDoc }, {});
  
  // If store status is changing, clear the explore cache
  if (isStatusChanging) {
    console.log(`Store status changed for ${appName}, clearing explore cache`);
    const { clearExploreCacheForStore } = require('../utils/explore-cache');
    await clearExploreCacheForStore(currentStore);
    
    // Send to all customers of this app to refresh their store data
    websocketService.sendToAppCustomers('shoofi-shopping', {
      type: 'store_refresh',
      data: { 
        action: 'store_updated', 
        appName: appName,
        timestamp: Date.now() // Add timestamp for deduplication
      }
    });
  }
  
  // Send to admin users
  websocketService.sendToAppAdmins('shoofi-partner', {
    type: 'store_updated',
    data: { action: 'store_updated', appName: appName }
  }, appName);
  
  // Send to all customers of this app to refresh their store data
  websocketService.sendToAppCustomers('shoofi-shopping', {
    type: 'store_refresh',
    data: { 
      action: 'store_updated', 
      appName: appName 
    }
  });
  
  res.status(200).json({ message: "Successfully saved" });
});

router.post("/api/store/holiday/add", async (req, res, next) => {
  const appName = req.headers['app-name'];
  const db = req.app.db[appName];
  const { date } = req.body;

  try {
    await db.store.updateOne(
      { id: 1 },
      { $addToSet: { holidayDates: date } }
    );
    
    const updatedStore = await db.store.findOne({ id: 1 });
    res.status(200).json({ 
      message: "Holiday date added successfully",
      holidayDates: updatedStore.holidayDates 
    });
  } catch (error) {
    res.status(400).json({ message: "Failed to add holiday date" });
  }
});

router.post("/api/store/holiday/delete", async (req, res, next) => {
  const appName = req.headers['app-name'];
  const db = req.app.db[appName];
  const { date } = req.body;

  try {
    await db.store.updateOne(
      { id: 1 },
      { $pull: { holidayDates: date } }
    );
    
    const updatedStore = await db.store.findOne({ id: 1 });
    res.status(200).json({ 
      message: "Holiday date removed successfully",
      holidayDates: updatedStore.holidayDates 
    });
  } catch (error) {
    res.status(400).json({ message: "Failed to remove holiday date" });
  }
});



router.get("/api/store/is-should-update", async (req, res) => {
  const version = req.headers["app-version"];
  const appType = req.headers["app-type"];

  const appName = 'shoofi';
    const db = req.app.db[appName];
  const storeData = await db.store.findOne({ id: 1 });
  const isValidVersion = compareVersions(version, storeData.minVersionUpdate[appType]);
  if (!isValidVersion) {
    console.log("YESS");
    res.status(200).json(true);
  } else {
    console.log("NO");
    res.status(200).json(false);
  }
});

router.post("/api/store/add", async (req, res, next) => {
  try {
    const { appName, name_ar, name_he, ...storeData } = req.body;
    
    if (!appName) {
      return res.status(400).json({ message: "App name is required" });
    }

    const db = req.app.db[appName];
    
    // Check if store already exists
    const existingStore = await db.store.findOne({ id: 1 });
    if (existingStore) {
      return res.status(400).json({ message: "Store already exists" });
    }

    // Insert new store
    await db.store.insertOne({
      ...storeData,
      id: 1
    });
    
    // Fire websocket event
    websockets.fireWebscoketEvent({ appName, appName });

    res.status(200).json({ message: "Store added successfully" });
  } catch (error) {
    console.error("Error adding store:", error);
    res.status(500).json({ message: "Failed to add store" });
  }
});

// Get all store categories
router.get("/api/store-category/all", async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const categories = await db.categories.find().sort({ order: 1 }).toArray();
  res.status(200).json(categories);
});

// Add store category
router.post("/api/store-category/add", upload.array("img"), async (req, res) => {
  try {
    const appName = req.headers['app-name'];
    const db = req.app.db[appName];
    const { nameAR, nameHE, order } = req.body;

    if (!nameAR || !nameHE) {
      return res.status(400).json({ message: 'nameAR and nameHE are required' });
    }

    let images = [];
    if (req.files && req.files.length > 0) {
      images = await uploadFile(req.files, req, `${appName}/store-categories`);
    }

    const newCategory = {
      nameAR,
      nameHE,
      order: Number(order) || 0,
      img: images,
      createdAt: new Date(),
    };

    await db.categories.insertOne(newCategory);
    res.status(201).json(newCategory);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to add store category", error: err.message });
  }
});

// Update store category
router.post("/api/store-category/update/:id", upload.array("img"), async (req, res) => {
  try {
    const appName = req.headers['app-name'];
    const db = req.app.db[appName];
    const { id } = req.params;
    const { nameAR, nameHE, order } = req.body;

    let images = [];
    const category = await db.categories.findOne({ _id: getId(id) });
    let currentImages = category.img || [];

    if (req.files && req.files.length > 0) {
      images = await uploadFile(req.files, req, `${appName}/store-categories`);
      currentImages = images;
    }
    
    const updatedCategory = {
      nameAR,
      nameHE,
      order: Number(order) || 0,
      img: currentImages,
      updatedAt: new Date(),
    };

    await db.categories.updateOne({ _id: getId(id) }, { $set: updatedCategory });
    res.status(200).json(updatedCategory);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update store category", error: err.message });
  }
});

router.post("/api/store-category/update-order", async (req, res) => {
  try {
    const appName = req.headers['app-name'];
    const db = req.app.db[appName];
    const { categories } = req.body; // Expecting an array of {_id, order}

    if (!Array.isArray(categories)) {
      return res.status(400).json({ message: "Invalid payload, expected 'categories' array" });
    }

    const bulkOps = categories.map(cat => ({
      updateOne: {
        filter: { _id: getId(cat._id) },
        update: { $set: { order: cat.order } }
      }
    }));

    if (bulkOps.length > 0) {
      await db.categories.bulkWrite(bulkOps);
    }
    
    res.status(200).json({ message: "Category order updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update category order", error: err.message });
  }
});

// Delete store category
router.delete("/api/store-category/:id", async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const { id } = req.params;
  const category = await db.categories.findOne({ _id: getId(id) });
  if (category.img && category.img.length > 0) {
    await deleteImages(category.img, req);
  }
  await db.categories.deleteOne({ _id: getId(id) });
  res.status(200).json({ message: "Category deleted" });
});

// Manual trigger for store auto-close (for testing purposes)
router.post("/api/store/auto-close", async (req, res) => {
  try {
    const storeAutoCloseCron = require("../utils/crons/store-auto-close");
    await storeAutoCloseCron.autoCloseStores(req.app.db);
    res.status(200).json({ message: "Store auto-close job executed successfully" });
  } catch (error) {
    console.error("Error executing store auto-close:", error);
    res.status(500).json({ message: "Failed to execute store auto-close job" });
  }
});

// Manual trigger for store open reminder (for testing purposes)
router.post("/api/store/open-reminder", async (req, res) => {
  try {
    const storeOpenReminderCron = require("../utils/crons/store-open-reminder");
    await storeOpenReminderCron.sendStoreOpenReminders(req.app.db);
    res.status(200).json({ message: "Store open reminder job executed successfully" });
  } catch (error) {
    console.error("Error executing store open reminder:", error);
    res.status(500).json({ message: "Failed to execute store open reminder job" });
  }
});

// Manual trigger for order overdue checker (for testing purposes)
router.post("/api/store/check-overdue-orders", async (req, res) => {
  try {
    const orderOverdueCheckerCron = require("../utils/crons/order-overdue-checker");
    await orderOverdueCheckerCron.checkOverdueOrders(req.app.db);
    res.status(200).json({ message: "Order overdue checker job executed successfully" });
  } catch (error) {
    console.error("Error executing order overdue checker:", error);
    res.status(500).json({ message: "Failed to execute order overdue checker job" });
  }
});

// Manual trigger for delivery pickup delay checker (for testing purposes)
router.post("/api/store/check-pickup-delays", async (req, res) => {
  try {
    const deliveryPickupCheckerCron = require("../utils/crons/delivery-pickup-checker");
    await deliveryPickupCheckerCron.checkDeliveryPickupDelays(req.app.db);
    res.status(200).json({ message: "Delivery pickup delay checker job executed successfully" });
  } catch (error) {
    console.error("Error executing delivery pickup delay checker:", error);
    res.status(500).json({ message: "Failed to execute delivery pickup delay checker job" });
  }
});

// Manual trigger for delivery completion delay checker (for testing purposes)
router.post("/api/store/check-delivery-completion-delays", async (req, res) => {
  try {
    const deliveryCompletionDelayCheckerCron = require("../utils/crons/delivery-completion-delay-checker");
    await deliveryCompletionDelayCheckerCron.checkDeliveryCompletionDelays(req.app.db);
    res.status(200).json({ message: "Delivery completion delay checker job executed successfully" });
  } catch (error) {
    console.error("Error executing delivery completion delay checker:", error);
    res.status(500).json({ message: "Failed to execute delivery completion delay checker job" });
  }
});

module.exports = router;
