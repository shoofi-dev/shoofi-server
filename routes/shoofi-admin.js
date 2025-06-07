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

const upload = multer({ storage: multer.memoryStorage() });

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


router.post('/api/shoofiAdmin/available-stores', async (req, res) => {
  try {
    const { lat, lng } = req.body.location;
    if (!lat || !lng) {
      return res.status(400).json({ message: 'lat and lng are required' });
    }

    const deliveryDB = req.app.db['delivery-company'];
    const shoofiDB = req.app.db['shoofi'];
    
    const availableStores = await RestaurantAvailabilityService.getAvailableStores(
      deliveryDB,
      shoofiDB,
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

router.get("/api/store/download-app", async (req, res) => {
  const db = req.app.db[req.headers['db-name']];

  const userAgent = req.get('user-agent');
  if (userAgent.includes('iPhone') || userAgent.includes('iPad')) {
    const data = {
      source: 'default',
      created: new Date(),
      ipAddress: req.ip,
      type: 'IOS'
    };
    await db.downloadAppQr.insertOne(data);
    res.redirect('itms-apps://itunes.apple.com/app/6446260267');
  } else if (userAgent.includes('Android')) {
    const data = {
      source: 'default',
      created: new Date(),
      ipAddress: req.ip,
      type: 'ANDROID'
    };
    await db.downloadAppQr.insertOne(data);
    res.redirect('https://play.google.com/store/apps/details?id=com.sariq.creme.caramel');
  }
});

router.get("/api/shoofiAdmin/store/all", async (req, res, next) => {
  try {
    const dbAdmin = req.app.db['shoofi'];
    const stores = await dbAdmin.stores.find().toArray();
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
      const { name, nameAR, nameHE, extras, order, supportedGeneralCategoryIds } = req.body;
      if (!name || !nameAR || !nameHE) {
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
        name,
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
router.post("/api/shoofiAdmin/store/add", upload.array("img"), async (req, res) => {
  try {
    const dbAdmin = req.app.db['shoofi'];
    const { appName, name_ar, name_he, business_visible, categoryIds, supportedCities, phone, address, supportedGeneralCategoryIds } = req.body;

    if (!appName || !name_ar || !name_he || !categoryIds || !supportedCities) {
      return res.status(400).json({ message: 'All required fields are missing' });
    }

    let logo = '';
    if (req.files && req.files.length > 0) {
      const images = await uploadFile(req.files, req, "stores");
      logo = images[0];
    }

    const newStore = {
      _id: getId(),
      storeLogo: logo,
      appName,
      name_ar,
      name_he,
      business_visible: business_visible === 'true',
      categoryIds: JSON.parse(categoryIds).map(categoryId => getId(categoryId)),
      supportedCities: JSON.parse(supportedCities).map(cityId => getId(cityId)),
      supportedGeneralCategoryIds: supportedGeneralCategoryIds ? JSON.parse(supportedGeneralCategoryIds).map(id => getId(id)) : [],
      phone: phone || '',
      address: address || '',
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
    res.status(200).json(store);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch store', error: err.message });
  }
});

router.post("/api/shoofiAdmin/store/update/:id", upload.array("img"), async (req, res) => {
  try {
    const dbAdmin = req.app.db['shoofi'];
    const { id } = req.params;
    const { appName, name_ar, name_he, business_visible, categoryIds, supportedCities, phone, address, supportedGeneralCategoryIds } = req.body;

    if (!appName || !name_ar || !name_he || !categoryIds || !supportedCities) {
      return res.status(400).json({ message: 'All required fields are missing' });
    }

    const store = await dbAdmin.stores.findOne({ _id: getId(id) });
    if (!store) {
      return res.status(404).json({ message: 'Store not found' });
    }

    let logo = store.storeLogo;
    if (req.files && req.files.length > 0) {
      const images = await uploadFile(req.files, req, "stores");
      logo = images[0];
      if (store.storeLogo) {
        await deleteImages([store.storeLogo], req);
      }
    }

    const updatedStore = {
      ...store,
      storeLogo: logo,
      appName,
      name_ar,
      name_he,
      business_visible: business_visible === 'true',
      categoryIds: JSON.parse(categoryIds).map(categoryId => getId(categoryId)),
      supportedCities: JSON.parse(supportedCities).map(cityId => getId(cityId)),
      supportedGeneralCategoryIds: supportedGeneralCategoryIds ? JSON.parse(supportedGeneralCategoryIds).map(id => getId(id)) : store.supportedGeneralCategoryIds || [],
      phone: phone || store.phone || '',
      address: address || store.address || '',
      updatedAt: new Date()
    };

    await dbAdmin.stores.updateOne({ _id: getId(id) }, { $set: updatedStore });
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
    const { ObjectId } = require('mongodb');
    const stores = await dbAdmin.stores.find({
      supportedCities: { $elemMatch: { $eq: ObjectId(cityId) } }
    }).toArray();
    res.status(200).json(stores);
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

module.exports = router;
