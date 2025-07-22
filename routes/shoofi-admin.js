const express = require("express");
const router = express.Router();
const moment = require("moment");
const { getId } = require("../lib/common");
const { paginateData } = require("../lib/paginate");
const websockets = require("../utils/websockets");
const { Expo } = require("expo-server-sdk");
const { uploadFile, deleteImages } = require("./product");
var multer = require("multer");
const RestaurantAvailabilityService = require("../services/delivery/RestaurantAvailabilityService");
const { getDb } = require("../lib/db");
const { MongoClient } = require("mongodb");
const DatabaseInitializationService = require('../services/database/DatabaseInitializationService');
const adsRouter = require("./ads");
const websocketService = require('../services/websocket/websocket-service');

const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  // limits: {
  //   fileSize: 2 * 1024 * 1024 // 5MB limit
  // }
});

// Create separate upload handlers for different file fields
const uploadFields = upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'cover_sliders', maxCount: 10 } // Allow up to 10 cover images
]);

router.post("/api/shoofiAdmin/store/list", async (req, res, next) => {
    let storesLostFinal = [];
    const dbAdmin = req.app.db['shoofi'];
    const location = req.body.location;
    if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
      return res.status(400).json({ message: 'Location is required and must be numbers.' });
    }
    const storesList = await dbAdmin.stores.find().toArray();
    for (let i = 0; i < storesList.length; i++) {
      const dbName = storesList[i].appName;
      const db = req.app.db[dbName];
      const storeDataArr = await db.store.find().toArray();
      const storeData = storeDataArr[0];
      if (storeData && storeData.location && storeData.coverageRadius) {
        // Calculate distance between user and store
        const toRad = (value) => (value * Math.PI) / 180;
        const R = 6371000; // Earth radius in meters
        const dLat = toRad(location.lat - storeData.location.coordinates[1]);
        const dLon = toRad(location.lng - storeData.location.coordinates[0]);
        const lat1 = toRad(storeData.location.coordinates[1]);
        const lat2 = toRad(location.lat);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;
        if (distance <= storeData.coverageRadius) {
          storesLostFinal.push(storeData);
        }
      }
    }
    res.status(200).json(storesLostFinal);
});

router.get("/api/shoofiAdmin/store/z-cr", async (req, res, next) => {
  const db = req.app.db['shoofi'];
  const storeData = await db.store.findOne({ id: 1 });
  const credentials = storeData.credentials;
  res.status(200).json(credentials);
});

router.post("/api/shoofiAdmin/store/update", async (req, res, next) => {
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
    type: 'shoofi_store_updated',
    data: { action: 'store_updated', appName: appName }
  }, appName);
  
  res.status(200).json({ message: "Successfully saved" });
});

router.post('/api/shoofiAdmin/available-stores', async (req, res) => {
  try {
    const lat = req.body.location.lat || req.body.location[1];
    const lng = req.body.location.lng || req.body.location[0];
    if (!lat || !lng) {
      return res.status(400).json({ message: 'lat and lng are required' });
    }

    const deliveryDB = req.app.db['delivery-company'];
    const shoofiDB = req.app.db['shoofi'];
    
    const availableStores = await RestaurantAvailabilityService.getAvailableStores(
      deliveryDB,
      shoofiDB,
      req.app.db,
      Number(lat),
      Number(lng)
    );

    res.json(availableStores);
  } catch (error) {
    console.error('Error getting available stores:', error);
    res.status(500).json({ error: 'Failed to get available stores' });
  }
});

router.get("/api/shoofiAdmin/category/list", async (req, res, next) => {
  const dbAdmin = req.app.db['shoofi'];
  const categoryList = await dbAdmin.categories.find().toArray();
  res.status(200).json(categoryList);
});
router.post("/api/shoofiAdmin/category/list", async (req, res, next) => {
  const dbAdmin = req.app.db['shoofi'];
  const categoryList = await dbAdmin.categories.find().toArray();
  res.status(200).json(categoryList);
});

router.get("/api/store/download-app/:appType?/:linkSource?", async (req, res) => {
  let appN = "";
  if (req.params.appType) {
    appN = req.params.appType;
  } else {
    appN = req.headers["app-name"];
  }
  const db = req.app.db['shoofi'];
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
      appType: appN,
      linkSource: req.params?.linkSource
    };
    await db.downloadAppQr.insertOne(data);
    res.redirect(`itms-apps://itunes.apple.com/app/${branch.appleAppIdDownload[appN]}`);
  } else if (userAgent.includes("Android")) {
    const data = {
      source: "default",
      created: new Date(),
      ipAddress: req.ip,
      type: "ANDROID",
      appType: appN,
      linkSource: req.params?.linkSource
    };
    await db.downloadAppQr.insertOne(data);
    res.redirect(
      `https://play.google.com/store/apps/details?id=${branch.androidAppIdDownload[appN]}`
    );
  }
});

router.get("/api/shoofiAdmin/store/all", async (req, res, next) => {
  try {
    const dbAdmin = req.app.db['shoofi'];
    const all = req.query.all === 'true';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const search = req.query.search;
    
    // Build search query
    let searchQuery = {};
    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      searchQuery = {
        $or: [
          { name_ar: searchRegex },
          { name_he: searchRegex },
          { appName: searchRegex },
          { descriptionAR: searchRegex },
          { descriptionHE: searchRegex }
        ]
      };
    }
    
    let stores, total;
    if (all) {
      stores = await dbAdmin.stores.find(searchQuery).toArray();
      total = stores.length;
      res.status(200).json({ stores });
    } else {
      stores = await dbAdmin.stores.find(searchQuery)
        .skip(skip)
        .limit(limit)
        .toArray();
      total = await dbAdmin.stores.countDocuments(searchQuery);
      res.status(200).json({
        stores,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: limit
        }
      });
    }
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch stores', error: err.message });
  }
});

router.get("/api/shoofiAdmin/store/all-stores", async (req, res, next) => {
  try {
    const dbAdmin = req.app.db['shoofi'];
    const search = req.query.search;
    
    // Build search query
    let searchQuery = {};
    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      searchQuery = {
        $or: [
          { name_ar: searchRegex },
          { name_he: searchRegex },
          { appName: searchRegex },
          { descriptionAR: searchRegex },
          { descriptionHE: searchRegex }
        ]
      };
    }
    
    const stores = await dbAdmin.stores.find(searchQuery).toArray();
    
    res.status(200).json(stores);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch stores', error: err.message });
  }
});

router.post(
  "/api/shoofiAdmin/category/add",
  upload.array("img"),
  async (req, res, next) => {
    try {
      const dbAdmin = req.app.db['shoofi'];
      const { nameAR, nameHE, extras, order, supportedGeneralCategoryIds } = req.body;

      if (!nameAR || !nameHE) {
        return res.status(400).json({ message: 'Category nameAR, and nameHE are required' });
      }

      let images = [];
      if (req.files && req.files.length > 0) {
        images = await uploadFile(req.files, req, "categories");
      }

      const newCategory = {
        _id: getId(),
        nameAR,
        nameHE,
        extras: extras ? JSON.parse(extras) : [],
        image: images.length > 0 ? images[0] : '',
        order: order ? Number(order) : 0,
        supportedGeneralCategoryIds: supportedGeneralCategoryIds ? JSON.parse(supportedGeneralCategoryIds).map(id => getId(id)) : [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await dbAdmin.categories.insertOne(newCategory);
      res.status(201).json(newCategory);
    } catch (err) {
      res.status(500).json({ message: 'Failed to add category', error: err.message });
    }
  }
);

router.get("/api/shoofiAdmin/category/:id", async (req, res) => {
  try {
    const dbAdmin = req.app.db['shoofi'];
    const { id } = req.params;
    const category = await dbAdmin.categories.findOne({ _id: getId(id) });
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }
    res.status(200).json(category);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch category', error: err.message });
  }
});

router.post(
  "/api/shoofiAdmin/category/update/:id",
  upload.array("img"),
  async (req, res, next) => {
    try {
      const dbAdmin = req.app.db['shoofi'];
      const { id } = req.params;
      const { nameAR, nameHE, extras, order, supportedGeneralCategoryIds } = req.body;
      if (!nameAR || !nameHE) {
        return res.status(400).json({ message: 'Category name, nameAR, and nameHE are required' });
      }
      const category = await dbAdmin.categories.findOne({ _id: getId(id) });
      if (!category) {
        return res.status(404).json({ message: 'Category not found' });
      }
      let image = category.image;
      if (req.files && req.files.length > 0) {
        image = (await uploadFile(req.files, req, "categories"))[0];
        if (category.image) {
          await deleteImages([category.image], req);
        }
      }
      const updatedCategory = {
        ...category,
        nameAR,
        nameHE,
        extras: extras ? JSON.parse(extras) : [],
        image,
        order: order ? Number(order) : 0,
        supportedGeneralCategoryIds: supportedGeneralCategoryIds ? JSON.parse(supportedGeneralCategoryIds).map(id => getId(id)) : category.supportedGeneralCategoryIds || [],
        updatedAt: new Date(),
      };
      await dbAdmin.categories.updateOne({ _id: getId(id) }, { $set: updatedCategory });
      res.status(200).json(updatedCategory);
    } catch (err) {
      res.status(500).json({ message: 'Failed to update category', error: err.message });
    }
  }
);

router.post("/api/shoofiAdmin/stores/by-category", async (req, res) => {
  try {
    const { categoryId } = req.body;
    if (!categoryId) {
      return res.status(400).json({ message: 'categoryId is required' });
    }
    const dbAdmin = req.app.db['shoofi'];
    const storesList = await dbAdmin.stores.find({categoryIds: { $in: [getId(categoryId)] }}).toArray();
    let result = [];
    for (let i = 0; i < storesList.length; i++) {
      const dbName = storesList[i].appName;
      const db = req.app.db[dbName];
      // Adjust the field name if your store uses a different one
      const storeDataArr = await db.store.find({}).toArray();
      result.push({store: storesList[i], storeData: storeDataArr[0]});
    }
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch stores by category', error: err.message });
  }
});

// Store Management APIs
router.post("/api/shoofiAdmin/store/add", uploadFields, async (req, res) => {
  try {
    const dbAdmin = req.app.db['shoofi'];
    const { appName, name_ar, name_he, business_visible, categoryIds, supportedCities, phone, address, supportedGeneralCategoryIds, lat, lng, descriptionAR, descriptionHE } = req.body;

    if (!appName || !name_ar || !name_he || !categoryIds || !supportedCities) {
      return res.status(400).json({ message: 'All required fields are missing' });
    }

    let logo = '';
    let cover_sliders = [];
    
    if (req.files) {
      if (req.files['logo'] && req.files['logo'][0]) {
        const logoFile = req.files['logo'][0];
        const logoImages = await uploadFile([logoFile], req, `stores/${appName}/logo`);
        logo = logoImages[0];
      }
      
      if (req.files['cover_sliders']) {
        const coverFiles = req.files['cover_sliders'];
        const coverImages = await uploadFile(coverFiles, req, `stores/${appName}/cover_sliders`);
        cover_sliders = coverImages;
      }
    }

    let location = undefined;
    if (lat !== undefined && lng !== undefined) {
      location = {
        type: 'Point',
        coordinates: [Number(lng), Number(lat)]
      };
    }

    const newStore = {
      _id: getId(),
      storeLogo: logo,
      cover_sliders: cover_sliders,
      appName,
      name_ar,
      name_he,
      descriptionAR: descriptionAR || '',
      descriptionHE: descriptionHE || '',
      business_visible: business_visible === 'true',
      categoryIds: JSON.parse(categoryIds).map(categoryId => getId(categoryId)),
      supportedCities: JSON.parse(supportedCities).map(cityId => getId(cityId)),
      supportedGeneralCategoryIds: supportedGeneralCategoryIds ? JSON.parse(supportedGeneralCategoryIds).map(id => getId(id)) : [],
      phone: phone || '',
      address: address || '',
      ...(location ? { location } : {}),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await dbAdmin.stores.insertOne(newStore);

    // Initialize the new store's database
    const client = new MongoClient(process.env.DB_CONNECTION_STRING, { useNewUrlParser: true, useUnifiedTopology: true });
    await client.connect();
    
    // Initialize the new database using the service
    const db = await DatabaseInitializationService.initializeDatabase(appName, client);
    
    // Add the new database to the app's db object
    req.app.db[appName] = db;

    res.status(201).json(newStore);
  } catch (err) {
    res.status(500).json({ message: 'Failed to add store', error: err.message });
  }
});

router.get("/api/shoofiAdmin/store/:id", async (req, res) => {
  try {
    const dbAdmin = req.app.db['shoofi'];
    const { id } = req.params;
    const store = await dbAdmin.stores.findOne({ _id: getId(id) });
    if (!store) {
      return res.status(404).json({ message: 'Store not found' });
    }
    // If location exists, add lat/lng for frontend compatibility
    if (store.location && Array.isArray(store.location.coordinates)) {
      store.lat = store.location.coordinates[1];
      store.lng = store.location.coordinates[0];
    }
    res.status(200).json(store);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch store', error: err.message });
  }
});

router.post("/api/shoofiAdmin/store/update/:id", uploadFields, async (req, res) => {
  try {
    const dbAdmin = req.app.db['shoofi'];
    const { id } = req.params;
    const { appName, name_ar, name_he, business_visible, categoryIds, supportedCities, phone, address, supportedGeneralCategoryIds, lat, lng, descriptionAR, descriptionHE, isCoomingSoon } = req.body;

    if (!appName || !name_ar || !name_he || !categoryIds || !supportedCities) {
      return res.status(400).json({ message: 'All required fields are missing' });
    }

    const store = await dbAdmin.stores.findOne({ _id: getId(id) });
    if (!store) {
      return res.status(404).json({ message: 'Store not found' });
    }

    let logo = store.storeLogo;
    let cover_sliders = store.cover_sliders || [];

    if (req.files) {
      if (req.files['logo'] && req.files['logo'][0]) {
        const logoFile = req.files['logo'][0];
        const logoImages = await uploadFile([logoFile], req, `stores/${appName}/logo`);
        logo = logoImages[0];
        if (store.storeLogo) {
          await deleteImages([store.storeLogo], req);
        }
      }
      
      if (req.files['cover_sliders']) {
        const coverFiles = req.files['cover_sliders'];
        const coverImages = await uploadFile(coverFiles, req, `stores/${appName}/cover_sliders`);
        cover_sliders = [...cover_sliders, ...coverImages];
      }
    }

    // Handle existing cover sliders that should be kept
    const existingCoverSliders = req.body.existing_cover_sliders 
      ? (Array.isArray(req.body.existing_cover_sliders) 
          ? req.body.existing_cover_sliders 
          : [req.body.existing_cover_sliders])
      : [];
    
    // Remove deleted cover sliders
    const deletedSliders = store.cover_sliders?.filter(slider => 
      !existingCoverSliders.includes(slider.uri)
    ) || [];
    
    if (deletedSliders.length > 0) {
      await deleteImages(deletedSliders, req);
    }

    // Keep existing sliders that weren't deleted and add new ones
    const existingSliders = store.cover_sliders?.filter(slider => 
      existingCoverSliders.includes(slider.uri)
    ) || [];
    // if(deletedSliders?.length > 0){
    //   cover_sliders = cover_sliders?.filter(slider => 
    //     !deletedSliders.includes(slider.uri)
    //   ) || [];
    // }


       // Remove deletedSliders from cover_sliders
    if (Array.isArray(deletedSliders) && deletedSliders.length > 0) {
      const deletedSlidersWithoutUri = deletedSliders.map((slider) => slider.uri);
      cover_sliders = cover_sliders.filter(slider => !deletedSlidersWithoutUri.includes(slider.uri));
    }
    // Combine existing and new sliders
    if (deletedSliders?.length === 0) {
      const allSliders = [...existingSliders, ...cover_sliders];
      const seen = new Set();
      cover_sliders = allSliders.filter(slider => {
        if (seen.has(slider.uri)) return false;
        seen.add(slider.uri);
        return true;
      });
    }

    let location = store.location;
    if (lat !== undefined && lng !== undefined) {
      location = {
        type: 'Point',
        coordinates: [Number(lng), Number(lat)]
      };
    }

    const updatedStore = {
      ...store,
      storeLogo: logo,
      cover_sliders: cover_sliders,
      appName,
      name_ar,
      name_he,
      descriptionAR: descriptionAR || store.descriptionAR || '',
      descriptionHE: descriptionHE || store.descriptionHE || '',
      business_visible: business_visible === 'true',
      categoryIds: JSON.parse(categoryIds).map(categoryId => getId(categoryId)),
      supportedCities: JSON.parse(supportedCities).map(cityId => getId(cityId)),
      supportedGeneralCategoryIds: supportedGeneralCategoryIds ? JSON.parse(supportedGeneralCategoryIds).map(id => getId(id)) : store.supportedGeneralCategoryIds || [],
      phone: phone || store.phone || '',
      address: address || store.address || '',
      ...(location ? { location } : {}),
      isCoomingSoon: isCoomingSoon === 'true',
      updatedAt: new Date()
    };

    await dbAdmin.stores.updateOne({ _id: getId(id) }, { $set: updatedStore });
    
    // Check if store status is changing
    const isStatusChanging = store && (
      store.business_visible !== updatedStore.business_visible ||
      store.isCoomingSoon !== updatedStore.isCoomingSoon
    );
    
    // If store status is changing, send websocket notification to customers
    if (isStatusChanging) {
      console.log(`Store status changed for ${appName}, sending websocket notification`);
      await clearExploreCacheForStore(store);

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
      type: 'shoofi_store_updated',
      data: { action: 'store_updated', appName: appName }
    }, appName);
    
    res.status(200).json(updatedStore);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update store', error: err.message });
  }
});

router.delete("/api/shoofiAdmin/store/:id", async (req, res) => {
  try {
    const dbAdmin = req.app.db['shoofi'];
    const { id } = req.params;
    const store = await dbAdmin.stores.findOne({ _id: getId(id) });
    if (!store) {
      return res.status(404).json({ message: 'Store not found' });
    }
    if (store.storeLogo) {
      await deleteImages([store.storeLogo], req);
    }
    await dbAdmin.stores.deleteOne({ _id: getId(id) });
    res.status(200).json({ message: 'Store deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete store', error: err.message });
  }
});

router.get("/api/shoofiAdmin/store/by-city/:cityId", async (req, res, next) => {
  try {
    const dbAdmin = req.app.db['shoofi'];
    const cityId = req.params.cityId;
    const all = req.query.all === 'true';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const search = req.query.search;
    const { ObjectId } = require('mongodb');
    
    // Build base query for city filtering
    const cityQuery = {
      supportedCities: { $elemMatch: { $eq: ObjectId(cityId) } }
    };
    
    // Build search query
    let searchQuery = {};
    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      searchQuery = {
        $or: [
          { name_ar: searchRegex },
          { name_he: searchRegex },
          { appName: searchRegex },
          { descriptionAR: searchRegex },
          { descriptionHE: searchRegex }
        ]
      };
    }
    
    // Combine city and search queries
    const combinedQuery = searchQuery.$or ? 
      { $and: [cityQuery, searchQuery] } : 
      cityQuery;
    
    let stores, total;
    if (all) {
      stores = await dbAdmin.stores.find(combinedQuery).toArray();
      total = stores.length;
      res.status(200).json({ stores });
    } else {
      stores = await dbAdmin.stores.find(combinedQuery)
        .skip(skip)
        .limit(limit)
        .toArray();
      total = await dbAdmin.stores.countDocuments(combinedQuery);
      res.status(200).json({
        stores,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: limit
        }
      });
    }
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch stores by city', error: err.message });
  }
});

router.delete("/api/shoofiAdmin/category/:id", async (req, res) => {
  try {
    const dbAdmin = req.app.db['shoofi'];
    const { id } = req.params;
    const category = await dbAdmin.categories.findOne({ _id: getId(id) });
    
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    // Delete the category image if it exists
    if (category.image && category.image.uri) {
      await deleteImages([category.image], req);
    }

    await dbAdmin.categories.deleteOne({ _id: getId(id) });
    res.status(200).json({ message: 'Category deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete category', error: err.message });
  }
});

// Add WebSocket monitoring endpoints
router.get('/admin/websocket/stats', async (req, res) => {
  try {
      const stats = await websocketService.getStats();
      res.status(200).json(stats);
  } catch (error) {
      res.status(500).json({ error: error.message });
  }
});

router.get('/admin/websocket/connections', async (req, res) => {
  try {
      const connections = [];
      for (const [userId, client] of websocketService.clients) {
          connections.push({
              userId,
              appName: client.appName,
              appType: client.appType,
              connectedAt: new Date(client.connectedAt).toISOString(),
              lastPing: new Date(client.lastPing).toISOString(),
              serverId: client.serverId
          });
      }
      res.status(200).json(connections);
  } catch (error) {
      res.status(500).json({ error: error.message });
  }
});

// New endpoint for explore screen with server-side filtering and area-based caching
router.get("/api/shoofiAdmin/explore/categories-with-stores", async (req, res) => {
  try {
    
    const dbAdmin = req.app.db['shoofi'];
    const location = req.query.location ? JSON.parse(req.query.location) : null;
    
    // Require location parameter
    if (!location || (location.lat === undefined && location.coordinates === undefined)) {
      return res.status(400).json({ 
        error: 'Location is required', 
        message: 'Please provide location coordinates to fetch available stores' 
      });
    }

    // Validate location coordinates
    const lat = location.lat || location.coordinates?.[1];
    const lng = location.lng || location.coordinates?.[0];
    
    if (typeof lat !== 'number' || typeof lng !== 'number' || 
        isNaN(lat) || isNaN(lng) || 
        lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ 
        error: 'Invalid location coordinates', 
        message: 'Please provide valid latitude and longitude coordinates' 
      });
    }

    // Check cache first (with shorter TTL due to store status changes)
    // Use area-based caching: if location is in a delivery area, cache by area ID
    // This ensures all users in the same area get the same cached results
    let cacheKey = 'explore_categories_default';
    let area = null;
    
    const deliveryDB = req.app.db['delivery-company'];
    
    // Find the area containing the location
    area = await deliveryDB.areas.findOne({
      geometry: {
        $geoIntersects: {
          $geometry: { type: "Point", coordinates: [lng, lat] }
        }
      }
    });
    
    console.log(`Area lookup for location (${lat}, ${lng}): ${area ? area.name : 'no area found'}`);
    
    if (area) {
      cacheKey = `explore_categories_area_${area._id}`;
    } else {
      cacheKey = `explore_categories_no_area_${lat}_${lng}`;
    }
    
    const cachedData = await getExploreCache(cacheKey);
    console.log(`Cache lookup for key: ${cacheKey}, found: ${cachedData ? 'yes' : 'no'}`);
    if (cachedData) {
      console.log('Explore categories served from cache');
      return res.status(200).json(cachedData);
    }

    // Get available stores using the same service as available-stores endpoint
    const availableStoresData = await RestaurantAvailabilityService.getAvailableStores(
      deliveryDB,
      dbAdmin,
      req.app.db,
      lat,
      lng
    );

    // Extract only the stores (not delivery companies) and filter by open status
    const availableStores = availableStoresData
      .map(storeData => ({
        store: storeData.store,
        storeData: {
          ...storeData.store,
          distance: null // Distance calculation is handled by the service
        }
      }));

    // Get all categories
    const allCategories = await dbAdmin.categories.find().toArray();
    
    // Group stores by category
    const storesByCategory = {};
    availableStores.forEach((storeData) => {
      if (storeData.store.categoryIds) {
        storeData.store.categoryIds.forEach((categoryId) => {
          const categoryIdStr = categoryId.$oid || categoryId;
          if (!storesByCategory[categoryIdStr]) {
            storesByCategory[categoryIdStr] = [];
          }
          storesByCategory[categoryIdStr].push(storeData);
        });
      }
    });

    // Create categories with stores data
    const categoriesWithStores = allCategories
      .filter(category => storesByCategory[category._id])
      .map(category => ({
        category: category,
        stores: storesByCategory[category._id] || []
      }))
      .filter(item => item.stores.length > 0) // Only include categories with stores
      .sort((a, b) => (a.category.order || 0) - (b.category.order || 0)); // Sort by category order

    // Cache the result (shorter TTL for store status changes)
    await setExploreCache(cacheKey, categoriesWithStores, 5 * 60 * 1000); // 5 minutes

    console.log(`Explore categories generated with ${categoriesWithStores.length} categories and ${availableStores.length} available stores for area: ${area ? area.name : 'no area'}`);

    res.status(200).json(categoriesWithStores);

  } catch (error) {
    console.error('Error fetching explore categories:', error);
    res.status(500).json({ error: 'Failed to fetch explore categories', details: error.message });
  }
});

// Import shared cache utility
const {
  getExploreCache,
  setExploreCache,
  clearExploreCache,
  clearExploreCacheForArea,
  clearExploreCacheForLocation,
  clearExploreCacheForStore,
  getCacheStats
} = require('../utils/explore-cache');

// Endpoint to clear explore cache
router.post("/api/shoofiAdmin/explore/clear-cache", async (req, res) => {
  try {
    exploreCache.clear();
    res.status(200).json({ message: 'Explore cache cleared successfully' });
  } catch (error) {
    console.error('Error clearing explore cache:', error);
    res.status(500).json({ error: 'Failed to clear explore cache' });
  }
});

// Endpoint to get explore cache stats
router.get("/api/shoofiAdmin/explore/cache-stats", async (req, res) => {
  try {
    const stats = getCacheStats();
    res.status(200).json(stats);
  } catch (error) {
    console.error('Error getting explore cache stats:', error);
    res.status(500).json({ error: 'Failed to get explore cache stats' });
  }
});

// Debug endpoint to test area lookup
router.post("/api/shoofiAdmin/explore/debug-area", async (req, res) => {
  try {
    const { location } = req.body;
    if (!location || (location.lat === undefined && location.coordinates === undefined)) {
      return res.status(400).json({ error: 'Location is required' });
    }

    const deliveryDB = req.app.db['delivery-company'];
    const lat = location.lat || location.coordinates?.[1];
    const lng = location.lng || location.coordinates?.[0];

    const area = await deliveryDB.areas.findOne({
      geometry: {
        $geoIntersects: {
          $geometry: { type: "Point", coordinates: [lng, lat] }
        }
      }
    });

    const cacheKey = area ? `explore_categories_area_${area._id}` : `explore_categories_no_area_${lat}_${lng}`;
    const cachedData = await getExploreCache(cacheKey);
    const stats = getCacheStats();

    res.status(200).json({
      location: { lat, lng },
      area: area ? { id: area._id, name: area.name } : null,
      cacheKey,
      hasCachedData: !!cachedData,
      cacheSize: stats.size
    });
  } catch (error) {
    console.error('Error in debug area endpoint:', error);
    res.status(500).json({ error: 'Failed to debug area lookup' });
  }
});

router.use("/api/ads", adsRouter);

module.exports = router;
