const express = require("express");
const router = express.Router();
const moment = require("moment");
const { getId } = require("../lib/common");
const { paginateData } = require("../lib/paginate");
const websockets = require("../utils/websockets");
const storeService = require("../utils/store-service")
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
    const isOpenHours = storeService.checkIsStoreOpenHours(store.start, store.end);
    const isOpenDays = storeService.checkIsStoreOpenDay('Sunday', store.end) || store?.isOpendAllDays;
    let isStoreOpen = (isOpenHours && isOpenDays && !store.isStoreClose) || (store.isAlwaysOpen && !store.isStoreClose);


  res.status(200).json({
    isOpen: isStoreOpen
  });
});

router.get("/api/store/get/:appName?", async (req, res) => {
  const appName = req.params.appName;
  const db = req.app.db[appName];
  const store = await db.store.findOne({ });
  res.status(200).json(store);
});

router.post("/api/store", async (req, res, next) => {
  let pageNum = 1;
  if (req.params.page) {
    pageNum = req.params.page;
  }

  let stores = await paginateData(false, req, pageNum, "store", {});

  stores.data = await Promise.all(
    stores.data.map(async (store) => {
      const isOpenHours = storeService.checkIsStoreOpenHours(store.start, store.end);
      const isOpenDays = storeService.checkIsStoreOpenDay('Sunday', store.end) || store?.isOpendAllDays;
      console.log("isOpenDays", isOpenDays);
      console.log("isOpenHours", isOpenHours);
      console.log("!store.isStoreClose", !store.isStoreClose);
  
      let isStoreOpen = (isOpenHours && isOpenDays && !store.isStoreClose) || (store.isAlwaysOpen && !store.isStoreClose);
      console.log("isStoreOpen", isStoreOpen);
  
      let isDeliveryOpen = store.delivery_support;
      // if (store.delivery_support && store.isSendNotificationToDeliveryCompany) {
      //   const isCompanyOpen = await storeService.isDeliveryCompanyOpen(req);
      //   isDeliveryOpen = isCompanyOpen;
      // }
      delete store.credentials;
      return {
        ...store,
        isOpen: isStoreOpen,
        isDeliveryOpen,
        delivery_support: isDeliveryOpen
      };
    })
  );
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
  await db.store.updateOne({ _id: getId(id) }, { $set: storeDoc }, {});
  websockets.fireWebscoketEvent({appName, appName});
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

router.get("/api/store/download-app/:appName?", async (req, res) => {
  let appN = "";
  if (req.params.appName) {
    appN = req.params.appName;
  } else {
    appN = req.headers["app-name"];
  }
  const db = req.app.db[appN || 'pizza-gmel'];
  const stores = await db.store.find().toArray();
  const branch = stores[0];

  const userAgent = req.get("user-agent");
  console.log("====Download app====", req.headers);
  if (userAgent.includes("iPhone") || userAgent.includes("iPad")) {
    const data = {
      source: "default",
      created: new Date(),
      ipAddress: req.ip,
      type: "IOS",
      appName: appN
    };
    await db.downloadAppQr.insertOne(data);
    res.redirect(`itms-apps://itunes.apple.com/app/${branch.appleAppId}`);
  } else if (userAgent.includes("Android")) {
    const data = {
      source: "default",
      created: new Date(),
      ipAddress: req.ip,
      type: "ANDROID",
    };
    await db.downloadAppQr.insertOne(data);
    res.redirect(
      `https://play.google.com/store/apps/details?id=${branch.androidAppId}`
    );
  }
});

router.get("/api/store/is-should-update", async (req, res) => {
  const version = req.headers["app-version"];
  const appName = req.headers['app-name'];
    const db = req.app.db[appName];
  const storeData = await db.store.findOne({ id: 1 });
  const isValidVersion = compareVersions(version, storeData.minVersion);
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
  const categories = await db.categories.find().toArray();
  res.status(200).json(categories);
});

// Add store category
router.post("/api/store-category/add", upload.array("img"), async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const { nameAR, nameHE } = req.body;
  let images = [];
  if (req.files && req.files.length > 0) {
    images = await uploadFile(req.files, req, `stores/${appName}/categories`);
  }
  const newCategory = {
    _id: getId(),
    nameAR,
    nameHE,
    img: images,
  };
  await db.categories.insertOne(newCategory);
  res.status(201).json(newCategory);
});

// Update store category
router.post("/api/store-category/update/:id", upload.array("img"), async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const { id } = req.params;
  const { nameAR, nameHE } = req.body;
  const category = await db.categories.findOne({ _id: getId(id) });
  let images = category.img;
  if (req.files && req.files.length > 0) {
    images = await uploadFile(req.files, req, `stores/${appName}/categories`);
    if (category.img && category.img.length > 0) {
      await deleteImages(category.img, req);
    }
  }
  const updatedCategory = {
    ...category,
    nameAR,
    nameHE,
    img: images,
  };
  await db.categories.updateOne({ _id: getId(id) }, { $set: updatedCategory });
  res.status(200).json(updatedCategory);
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

module.exports = router;
