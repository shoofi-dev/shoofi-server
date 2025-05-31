const express = require("express");
const router = express.Router();
const moment = require("moment");
const { getId } = require("../lib/common");
const { paginateData } = require("../lib/paginate");
const websockets = require("../utils/websockets");
const { Expo } = require("expo-server-sdk");
const { uploadFile, deleteImages } = require("./product");
var multer = require("multer");

const upload = multer({ storage: multer.memoryStorage() });

router.post("/api/shoofiAdmin/store/list", async (req, res, next) => {
//   let expo = new Expo();

//   const messages =[{
//     to: 'ExponentPushToken[oHeITbIMMN6kbutYnEIouJ]',
//     sound: 'default',
//     body: 'This is a test notification',
//     data: { withSome: 'data' },
//   }];

//   let chunks = expo.chunkPushNotifications(messages);
// let tickets = [];
// (async () => {
//   // Send the chunks to the Expo push notification service. There are
//   // different strategies you could use. A simple one is to send one chunk at a
//   // time, which nicely spreads the load out over time:
//   for (let chunk of chunks) {
//     try {
//       let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
//       console.log(ticketChunk);
//       tickets.push(...ticketChunk);
//       // NOTE: If a ticket contains an error code in ticket.details.error, you
//       // must handle it appropriately. The error codes are listed in the Expo
//       // documentation:
//       // https://docs.expo.io/push-notifications/sending-notifications/#individual-errors
//     } catch (error) {
//       console.error(error);
//     }
//   }
// })();
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
      const { name, nameAR, nameHE, extras, order } = req.body;

      if (!name || !nameAR || !nameHE) {
        return res.status(400).json({ message: 'Category name, nameAR, and nameHE are required' });
      }

      let images = [];
      if (req.files && req.files.length > 0) {
        images = await uploadFile(req.files, req, "categories");
      }

      const newCategory = {
        _id: getId(),
        name,
        nameAR,
        nameHE,
        extras: extras ? JSON.parse(extras) : [],
        image: images.length > 0 ? images[0] : '',
        order: order ? Number(order) : 0,
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
      const { name, nameAR, nameHE, extras, order } = req.body;
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
        updatedAt: new Date(),
      };
      await dbAdmin.categories.updateOne({ _id: getId(id) }, { $set: updatedCategory });
      res.status(200).json(updatedCategory);
    } catch (err) {
      res.status(500).json({ message: 'Failed to update category', error: err.message });
    }
  }
);

// Delivery Company Endpoints
router.get("/api/shoofiAdmin/delivery-companies", async (req, res) => {
  try {
    const dbAdmin = req.app.db['delivery-company'];
    const companies = await dbAdmin.store.find().sort({ order: 1 }).toArray();
    res.status(200).json(companies);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch delivery companies', error: err.message });
  }
});

router.post(
  "/api/shoofiAdmin/delivery-company/add",
  upload.array("img"),
  async (req, res) => {
    try {
      const dbAdmin = req.app.db['shoofi'];
      const { name, nameAR, nameHE, start, end, isStoreClose, isAlwaysOpen, id, location, coverageRadius, phone, email, status, order } = req.body;

      // Validation
      if (!name || !nameAR || !nameHE) {
        return res.status(400).json({ message: 'Company name, nameAR, and nameHE are required' });
      }
      if (!start || !end) {
        return res.status(400).json({ message: 'Start and end times are required' });
      }
      if (typeof isStoreClose === 'undefined' || typeof isAlwaysOpen === 'undefined') {
        return res.status(400).json({ message: 'isStoreClose and isAlwaysOpen are required' });
      }
      if (typeof id === 'undefined') {
        return res.status(400).json({ message: 'id is required' });
      }
      let parsedLocation;
      try {
        parsedLocation = typeof location === 'string' ? JSON.parse(location) : location;
      } catch (e) {
        return res.status(400).json({ message: 'Invalid location format' });
      }
      if (!parsedLocation || parsedLocation.type !== 'Point' || !Array.isArray(parsedLocation.coordinates) || parsedLocation.coordinates.length !== 2) {
        return res.status(400).json({ message: 'location must be a GeoJSON Point with coordinates [lng, lat]' });
      }
      if (!coverageRadius || isNaN(Number(coverageRadius))) {
        return res.status(400).json({ message: 'coverageRadius is required and must be a number' });
      }

      let images = [];
      if (req.files && req.files.length > 0) {
        images = await uploadFile(req.files, req, "delivery-companies");
      }

      const newCompany = {
        _id: getId(),
        name,
        nameAR,
        nameHE,
        start,
        end,
        isStoreClose: isStoreClose === 'true' || isStoreClose === true,
        isAlwaysOpen: isAlwaysOpen === 'true' || isAlwaysOpen === true,
        id: Number(id),
        location: parsedLocation,
        coverageRadius: Number(coverageRadius),
        phone: phone || '',
        email: email || '',
        status: status === 'true' || status === true,
        image: images.length > 0 ? images[0] : '',
        order: order ? Number(order) : 0,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await dbAdmin.deliveryCompanies.insertOne(newCompany);
      res.status(201).json(newCompany);
    } catch (err) {
      res.status(500).json({ message: 'Failed to add delivery company', error: err.message });
    }
  }
);

router.get("/api/shoofiAdmin/delivery-company/:id", async (req, res) => {
  try {
    const dbAdmin = req.app.db['delivery-company'];
    const { id } = req.params;
    const company = await dbAdmin.store.findOne({ _id: getId(id) });
    if (!company) {
      return res.status(404).json({ message: 'Delivery company not found' });
    }
    res.status(200).json(company);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch delivery company', error: err.message });
  }
});

router.post(
  "/api/shoofiAdmin/delivery-company/update/:id",
  upload.array("img"),
  async (req, res) => {
    try {
      const dbAdmin = req.app.db['delivery-company'];
      const { id } = req.params;
      const { name, nameAR, nameHE, start, end, isStoreClose, isAlwaysOpen, id: companyId, location, coverageRadius, phone, email, status, order } = req.body;

      // Validation
      if (!name || !nameAR || !nameHE) {
        return res.status(400).json({ message: 'Company name, nameAR, and nameHE are required' });
      }
      if (!start || !end) {
        return res.status(400).json({ message: 'Start and end times are required' });
      }
      if (typeof isStoreClose === 'undefined' || typeof isAlwaysOpen === 'undefined') {
        return res.status(400).json({ message: 'isStoreClose and isAlwaysOpen are required' });
      }
      if (typeof companyId === 'undefined') {
        return res.status(400).json({ message: 'id is required' });
      }
      let parsedLocation;
      try {
        parsedLocation = typeof location === 'string' ? JSON.parse(location) : location;
      } catch (e) {
        return res.status(400).json({ message: 'Invalid location format' });
      }
      if (!parsedLocation || parsedLocation.type !== 'Point' || !Array.isArray(parsedLocation.coordinates) || parsedLocation.coordinates.length !== 2) {
        return res.status(400).json({ message: 'location must be a GeoJSON Point with coordinates [lng, lat]' });
      }
      if (!coverageRadius || isNaN(Number(coverageRadius))) {
        return res.status(400).json({ message: 'coverageRadius is required and must be a number' });
      }

      const company = await dbAdmin.store.findOne({ _id: getId(id) });
      if (!company) {
        return res.status(404).json({ message: 'Delivery company not found' });
      }

      let image = company.image;
      if (req.files && req.files.length > 0) {
        image = (await uploadFile(req.files, req, "delivery-companies"))[0];
        if (company.image) {
          await deleteImages([company.image], req);
        }
      }

      const updatedCompany = {
        ...company,
        name,
        nameAR,
        nameHE,
        start,
        end,
        isStoreClose: isStoreClose === 'true' || isStoreClose === true,
        isAlwaysOpen: isAlwaysOpen === 'true' || isAlwaysOpen === true,
        id: Number(companyId),
        location: parsedLocation,
        coverageRadius: Number(coverageRadius),
        phone: phone || '',
        email: email || '',
        status: status === 'true' || status === true,
        image,
        order: order ? Number(order) : 0,
        updatedAt: new Date()
      };

      await dbAdmin.store.updateOne(
        { _id: getId(id) },
        { $set: updatedCompany }
      );
      res.status(200).json(updatedCompany);
    } catch (err) {
      res.status(500).json({ message: 'Failed to update delivery company', error: err.message });
    }
  }
);

router.delete("/api/shoofiAdmin/delivery-company/:id", async (req, res) => {
  try {
    const dbAdmin = req.app.db['shoofi'];
    const { id } = req.params;
    
    const company = await dbAdmin.deliveryCompanies.findOne({ _id: getId(id) });
    if (!company) {
      return res.status(404).json({ message: 'Delivery company not found' });
    }

    if (company.image) {
      await deleteImages([company.image], req);
    }

    await dbAdmin.deliveryCompanies.deleteOne({ _id: getId(id) });
    res.status(200).json({ message: 'Delivery company deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete delivery company', error: err.message });
  }
});

// Delivery Company Employees Endpoints
router.get("/api/shoofiAdmin/delivery-company/:companyId/employees", async (req, res) => {
  try {
    const db = req.app.db['delivery-company'];
    const { companyId } = req.params;
    const employees = await db.customers.find({ companyId }).toArray();
    res.status(200).json(employees);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch employees', error: err.message });
  }
});

router.post("/api/shoofiAdmin/delivery-company/:companyId/employee/add", async (req, res) => {
  try {
    const db = req.app.db['delivery-company'];
    const { companyId } = req.params;
    const { phone, role, fullName, isActive } = req.body;
    if (!phone || !role || !fullName) {
      return res.status(400).json({ message: 'phone, role, and fullName are required' });
    }
    const newEmployee = {
      phone,
      role,
      fullName,
      isActive: isActive === 'true' || isActive === true,
      companyId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = await db.customers.insertOne(newEmployee);
    res.status(201).json({ ...newEmployee, _id: result.insertedId });
  } catch (err) {
    res.status(500).json({ message: 'Failed to add employee', error: err.message });
  }
});

router.post("/api/shoofiAdmin/delivery-company/employee/update/:id", async (req, res) => {
  try {
    const db = req.app.db['delivery-company'];
    const { id } = req.params;
    const { phone, role, fullName, isActive } = req.body;
    const employee = await db.customers.findOne({ _id: getId(id) });
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    const updatedEmployee = {
      ...employee,
      phone,
      role,
      fullName,
      isActive: isActive === 'true' || isActive === true,
      updatedAt: new Date(),
    };
    await db.customers.updateOne({ _id: getId(id) }, { $set: updatedEmployee });
    res.status(200).json(updatedEmployee);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update employee', error: err.message });
  }
});

router.get("/api/shoofiAdmin/delivery-company/employee/:id", async (req, res) => {
  try {
    const db = req.app.db['delivery-company'];
    const { id } = req.params;
    const employee = await db.customers.findOne({ _id: getId(id) });
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    res.status(200).json(employee);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch employee', error: err.message });
  }
});

router.delete("/api/shoofiAdmin/delivery-company/employee/:id", async (req, res) => {
  try {
    const db = req.app.db['delivery-company'];
    const { id } = req.params;
    const employee = await db.customers.findOne({ _id: getId(id) });
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    await db.customers.deleteOne({ _id: getId(id) });
    res.status(200).json({ message: 'Employee deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete employee', error: err.message });
  }
});

router.post("/api/shoofiAdmin/stores/by-category", async (req, res) => {
  try {
    const { categoryId } = req.body;
    if (!categoryId) {
      return res.status(400).json({ message: 'categoryId is required' });
    }
    const dbAdmin = req.app.db['shoofi'];
    const storesList = await dbAdmin.stores.find().toArray();
    let result = [];
    for (let i = 0; i < storesList.length; i++) {
      const dbName = storesList[i].appName;
      const db = req.app.db[dbName];
      // Adjust the field name if your store uses a different one
      const storeDataArr = await db.store.find({ categoryId }).toArray();
      result.push(...storeDataArr);
    }
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch stores by category', error: err.message });
  }
});

module.exports = router;
