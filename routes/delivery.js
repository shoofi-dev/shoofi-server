const express = require("express");
const moment = require("moment");
const router = express.Router();
const momentTZ = require("moment-timezone");
const { getId } = require("../lib/common");
const pushNotificationWebService = require("../utils/push-notification/push-web");
const { uploadFile, deleteImages } = require("./product");
var multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

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

router.post("/api/delivery/book", async (req, res) => {
  const appName = req.headers['app-name'];
    const db = req.app.db[appName];
  try {
    const deliveryData = req.body.deliveryData;
    const offsetHours = getUTCOffset();

    var deliveryDeltaMinutes = moment()
      .add(deliveryData.pickupTime, "m")
      .utcOffset(offsetHours)
      .format("HH:mm");
    await db.bookDelivery.insertOne({
      ...deliveryData,
      deliveryDeltaMinutes,
      status: "1",
      created: moment(new Date()).utcOffset(offsetHours).format(),
    });
    const adminCustomer = await db.customers.find({role:'admin'}).toArray();
    pushNotificationWebService.sendNotificationToDevice(adminCustomer[0].notificationToken, {storeName: deliveryData?.storeName});

    // websockets.fireWebscoketEvent("order delivery booked");
    return res
      .status(200)
      .json({ message: "order custom delivery booked successfully" });
  } catch (ex) {
    console.info("Error order custom delivery booked", ex);
    return res
      .status(400)
      .json({ message: "order custom delivery booke failed" });
  }
});
router.post("/api/delivery/create-customer", async (req, res) => {
  const appName = req.headers['app-name'];
    const db = req.app.db[appName];
  try {
    const customerData = req.body.customerData;
    const offsetHours = getUTCOffset();


    await db.customers.insertOne({
      ...customerData,
      created: moment(new Date()).utcOffset(offsetHours).format(),
    });

    // websockets.fireWebscoketEvent("order delivery booked");
    return res
      .status(200)
      .json({ message: "order custom delivery booked successfully" });
  } catch (ex) {
    console.info("Error order custom delivery booked", ex);
    return res
      .status(400)
      .json({ message: "order custom delivery booke failed" });
  }
});
router.post("/api/delivery/employe-list", async (req, res) => {
  const appName = req.headers['app-name'];
    const db = req.app.db[appName];
    const companyId = req.body.companyId;
  try {
    const employesList = await db.customers.find({role:'employe', companyId: (companyId)}).toArray();
    // websockets.fireWebscoketEvent("order delivery booked");
    return res
      .status(200)
      .json(employesList);
  } catch (ex) {
    console.info("Error order custom delivery booked", ex);
    return res
      .status(400)
      .json({ message: "order custom delivery booke failed" });
  }
});

router.post("/api/delivery/employe-payments", async (req, res) => {
  const appName = req.headers['app-name'];
    const db = req.app.db[appName];

    var start = moment().subtract(7, 'days').utcOffset(120);
    start.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });
  
    var end = moment().utcOffset(120);
    end.set({ hour: 23, minute: 59, second: 59, millisecond: 999 });
    const filterBy = {
      created: { $gte: start.format(), $lt: end.format() },
      status: { $ne: "0" },
    };
  try {
    const employePayments =  await db.bookDelivery.aggregate([
      {
        $match: filterBy  // Filter records based on date range
      },
      {
        $project: {
          assignee: 1,  // Include the delivery man (assignee)
          created: 1,   // Keep the created field as is
          // Convert 'created' string to Date type, add the UTC offset and format as 'YYYY-MM-DD'
          date: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: {
                $add: [
                  { $dateFromString: { dateString: "$created" } }, // Convert the created string to Date
                  120 * 60 * 1000 // Add UTC+120 milliseconds to adjust time
                ]
              }
            }
          }
        }
      },
      {
        $group: {
          _id: { assignee: "$assignee", date: "$date" },  // Group by assignee and formatted date
          orderCount: { $sum: 1 }  // Count the number of orders per day per delivery man
        }
      },
      {
        $group: {
          _id: "$_id.assignee",  // Group by assignee
          dailyOrders: {  // Create an array of daily order counts
            $push: { date: "$_id.date", orderCount: "$orderCount" }
          }
        }
      },
      {
        $project: {
          assignee: "$_id",  // Include assignee's ID
          dailyOrders: 1     // Include the daily orders array
        }
      },
      {
        $sort: { "assignee": 1 }  // Sort by assignee
      }
    ]).toArray()
    
    // websockets.fireWebscoketEvent("order delivery booked");
    return res
      .status(200)
      .json(employePayments);
  } catch (ex) {
    console.info("Error order custom delivery booked", ex);
    return res
      .status(400)
      .json({ message: "order custom delivery booke failed" });
  }
});


router.post("/api/delivery/list", async (req, res) => {
  const appName = req.headers['app-name'];
    const db = req.app.db[appName];
  try {
    const customerId = req.body.customerId;
    const isAllWeek = req.body.isAllWeek;
    const customer = await db.customers.findOne({
      _id: getId(customerId),
    });
    if (!customer) {
      res.status(400).json({
        message: "Customer not found",
      });
      return;
    }
    
    const statusList = req.body.statusList || ["1", "2", "3","-1"];
    const offsetHours = getUTCOffset();
    

    let startOfToday = moment()
      .utcOffset(offsetHours)
      .startOf("day")
      

      if(isAllWeek){
        startOfToday.subtract(7, "d");
      }

    // Get the end of today in UTC
    const endOfToday = moment().utcOffset(offsetHours).endOf("day").add(3, "h");

    let filterBy = {
      created: {
        $gte: startOfToday.format(),
        $lte: endOfToday.format(),
      },
    };

    if (statusList) {
      filterBy = {
        ...filterBy,
        status: { $in: statusList },
      };
    }

      filterBy = {
        ...filterBy,
        companyId: getId(customer.companyId),
      };

    if(customer.role === "employe"){
      filterBy = {
        ...filterBy,
        assignee: customerId,
        status: { $ne: "1" },
      };
    }


    if(customer.role === "store"){
      filterBy = {
        ...filterBy,
        storeId: String(getId(customer._id))
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

router.post("/api/delivery/update", async (req, res) => {
  const appName = req.headers['app-name'];
    const db = req.app.db[appName];
  try {
    let updateData = req.body;
    const id = updateData._id;
    delete updateData._id;
    const order = await db.bookDelivery.findOne({
      _id: getId(id),
    });

    let isPushEmploye = false;
    let isPushAdmin = false;
    if(order.status === "1" && updateData.status === "2"){
      isPushEmploye = true;
    }
    if (updateData.status === "0") {
      isPushEmploye = true;
    }
    if (updateData.status === "-1") {
      isPushEmploye = true;
      isPushAdmin = true;
    }
    await db.bookDelivery.updateOne(
      {
        _id: getId(id),
      },
      { $set: updateData },
      { multi: false }
    );

    if(isPushEmploye && updateData?.assignee){
      const employe = await db.customers.findOne({
        _id: getId(updateData?.assignee),
      });
      pushNotificationWebService.sendNotificationToDevice(employe?.notificationToken, {storeName: updateData?.storeName}, updateData?.status)
    }
    if(isPushAdmin){
      const adminCustomer = await db.customers.find({role:'admin'}).toArray();
      pushNotificationWebService.sendNotificationToDevice(adminCustomer[0].notificationToken, {storeName: updateData?.storeName}, updateData?.status);
    }

    return res
      .status(200)
      .json({ message: "order custom delivery updated successfully" });
  } catch (ex) {
    console.info("Error order custom delivery updated", ex);
    return res
      .status(400)
      .json({ message: "order custom delivery updated failed" });
  }
});


// --- Area Management ---

// List all areas
router.get('/api/delivery/areas', async (req, res) => {
  const db = req.app.db['delivery-company'];
  const areas = await db.areas.find().toArray();
  res.json(areas);
});

// Add area
router.post('/api/delivery/area/add', async (req, res) => {
  const db = req.app.db['delivery-company'];
  const { name, geometry, cityId } = req.body;
  if (!name || !geometry || !cityId) return res.status(400).json({ message: 'Name, geometry and cityId required' });
  const area = { name, geometry, cityId, createdAt: new Date(), updatedAt: new Date() };
  const result = await db.areas.insertOne(area);
  res.status(201).json({ ...area, _id: result.insertedId });
});

// Update area
router.post('/api/delivery/area/update/:id', async (req, res) => {
  const db = req.app.db['delivery-company'];
  const { id } = req.params;
  const { name, geometry, cityId } = req.body;
  await db.areas.updateOne({ _id: getId(id) }, { $set: { name, geometry, cityId, updatedAt: new Date() } });
  res.json({ message: 'Area updated' });
});

// Delete area
router.delete('/api/delivery/area/:id', async (req, res) => {
  const db = req.app.db['delivery-company'];
  const { id } = req.params;
  await db.areas.deleteOne({ _id: getId(id) });
  res.json({ message: 'Area deleted' });
});

// Get single area by ID
router.get('/api/delivery/area/:id', async (req, res) => {
  const db = req.app.db['delivery-company'];
  const { id } = req.params;
  const area = await db.areas.findOne({ _id: getId(id) });
  if (!area) return res.status(404).json({ message: 'Area not found' });
  res.json(area);
});

// --- Company Supported Areas ---

// List supported areas/prices for a company
router.get('/api/delivery/company/:companyId/areas', async (req, res) => {
  const db = req.app.db['delivery-company'];
  const { companyId } = req.params;
  const company = await db.store.findOne({ _id: getId(companyId) });
  res.json(company?.supportedAreas || []);
});

// Add area/price to company
router.post('/api/delivery/company/:companyId/area/add', async (req, res) => {
  const db = req.app.db['delivery-company'];
  const { companyId } = req.params;
  const { areaId, price, minOrder, eta } = req.body;
  if (!areaId || price == null) return res.status(400).json({ message: 'areaId and price required' });
  await db.store.updateOne(
    { _id: getId(companyId) },
    { $push: { supportedAreas: { areaId: getId(areaId), price, minOrder, eta } } }
  );
  res.json({ message: 'Area added to company' });
});

// Update price/minOrder/eta for area
router.post('/api/delivery/company/:companyId/area/update/:areaId', async (req, res) => {
  const db = req.app.db['delivery-company'];
  const { companyId, areaId } = req.params;
  const { price, minOrder, eta } = req.body;
  await db.store.updateOne(
    { _id: getId(companyId), 'supportedAreas.areaId': getId(areaId) },
    { $set: { 'supportedAreas.$.price': price, 'supportedAreas.$.minOrder': minOrder, 'supportedAreas.$.eta': eta } }
  );
  res.json({ message: 'Area updated for company' });
});

// Remove area from company
router.delete('/api/delivery/company/:companyId/area/:areaId', async (req, res) => {
  const db = req.app.db['delivery-company'];
  const { companyId, areaId } = req.params;
  await db.store.updateOne(
    { _id: getId(companyId) },
    { $pull: { supportedAreas: { areaId: getId(areaId) } } }
  );
  res.json({ message: 'Area removed from company' });
});

// Get a single supported area for a company
router.get('/api/delivery/company/:companyId/area/:areaId', async (req, res) => {
  const db = req.app.db['delivery-company'];
  const { companyId, areaId } = req.params;
  const company = await db.store.findOne({ _id: getId(companyId) });
  if (!company) return res.status(404).json({ message: 'Company not found' });
  const area = (company.supportedAreas || []).find(a => a.areaId.equals(getId(areaId)));
  if (!area) return res.status(404).json({ message: 'Area not found for this company' });
  res.json(area);
});

// --- Price by Location ---

router.post('/api/delivery/company/price-by-location', async (req, res) => {
  const db = req.app.db['delivery-company'];
  const { companyId, lat, lng } = req.body;
  if (!companyId || lat == null || lng == null) return res.status(400).json({ message: 'companyId, lat, lng required' });

  // Find area containing the point
  const area = await db.areas.findOne({
    geometry: {
      $geoIntersects: {
        $geometry: { type: "Point", coordinates: [lng, lat] }
      }
    }
  });
  if (!area) return res.status(404).json({ message: 'No delivery area found for this location' });

  // Find company and area price
  const company = await db.store.findOne({ _id: getId(companyId) });
  if (!company) return res.status(404).json({ message: 'Company not found' });
  const areaInfo = (company.supportedAreas || []).find(a => a.areaId.equals(area._id));
  if (!areaInfo) return res.status(404).json({ message: 'Company does not support this area' });

  res.json({
    areaId: area._id,
    areaName: area.name,
    price: areaInfo.price,
    minOrder: areaInfo.minOrder,
    eta: areaInfo.eta
  });
});

// --- City Management ---

// List all cities
router.get('/api/delivery/cities', async (req, res) => {
  const db = req.app.db['delivery-company'];
  const cities = await db.cities.find().toArray();
  res.json(cities);
});

// Add city
router.post('/api/delivery/city/add', async (req, res) => {
  const db = req.app.db['delivery-company'];
  const { nameAR, nameHE, geometry } = req.body;
  if (!nameAR || !nameHE || !geometry) return res.status(400).json({ message: 'Name and geometry required' });
  const city = { nameAR, nameHE, geometry, createdAt: new Date(), updatedAt: new Date() };
  const result = await db.cities.insertOne(city);
  res.status(201).json({ ...city, _id: result.insertedId });
});

// Update city
router.post('/api/delivery/city/update/:id', async (req, res) => {
  const db = req.app.db['delivery-company'];
  const { id } = req.params;
  const { nameAR, nameHE, geometry } = req.body;
  await db.cities.updateOne({ _id: getId(id) }, { $set: { nameAR, nameHE, geometry, updatedAt: new Date() } });
  res.json({ message: 'City updated' });
});

// Delete city
router.delete('/api/delivery/city/:id', async (req, res) => {
  const db = req.app.db['delivery-company'];
  const { id } = req.params;
  await db.cities.deleteOne({ _id: getId(id) });
  res.json({ message: 'City deleted' });
});

// Get single city by ID
router.get('/api/delivery/city/:id', async (req, res) => {
  const db = req.app.db['delivery-company'];
  const { id } = req.params;
  const city = await db.cities.findOne({ _id: getId(id) });
  if (!city) return res.status(404).json({ message: 'City not found' });
  res.json(city);
});

// Delivery Company Endpoints
router.get("/api/delivery/companies", async (req, res) => {
  try {
    const db = req.app.db['delivery-company'];
    const companies = await db.store.find().sort({ order: 1 }).toArray();
    res.status(200).json(companies);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch delivery companies', error: err.message });
  }
});

router.post(
  "/api/delivery/company/add",
  upload.array("img"),
  async (req, res) => {
    try {
      const db = req.app.db['delivery-company'];
      const { nameAR, nameHE, start, end, isStoreClose, isAlwaysOpen, phone, email, status, supportedCities } = req.body;

      // Validation
      if (!nameAR || !nameHE) {
        return res.status(400).json({ message: 'nameAR, and nameHE are required' });
      }
      if (!start || !end) {
        return res.status(400).json({ message: 'Start and end times are required' });
      }
      if (typeof isStoreClose === 'undefined' || typeof isAlwaysOpen === 'undefined') {
        return res.status(400).json({ message: 'isStoreClose and isAlwaysOpen are required' });
      }




      let parsedSupportedCities = [];
      try {
        parsedSupportedCities = typeof supportedCities === 'string' ? JSON.parse(supportedCities) : supportedCities;
      } catch (e) {
        return res.status(400).json({ message: 'Invalid supportedCities format' });
      }
      const newCompanyId = getId();
      let images = [];
      if (req.files && req.files.length > 0) {
        images = await uploadFile(req.files, req, `delivery-companies/${newCompanyId}/logo`);
      }

      const newCompany = {
        _id: newCompanyId,
        nameAR,
        nameHE,
        start,
        end,
        isStoreClose: isStoreClose === 'true' || isStoreClose === true,
        isAlwaysOpen: isAlwaysOpen === 'true' || isAlwaysOpen === true,
        phone: phone || '',
        email: email || '',
        status: status === 'true' || status === true,
        image: images.length > 0 ? images[0] : '',
        supportedCities: parsedSupportedCities.map(id => getId(id)),
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await db.store.insertOne(newCompany);
      res.status(201).json(newCompany);
    } catch (err) {
      res.status(500).json({ message: 'Failed to add delivery company', error: err.message });
    }
  }
);

router.get("/api/delivery/company/:id", async (req, res) => {
  try {
    const db = req.app.db['delivery-company'];
    const { id } = req.params;
    const company = await db.store.findOne({ _id: getId(id) });
    if (!company) {
      return res.status(404).json({ message: 'Delivery company not found' });
    }
    res.status(200).json(company);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch delivery company', error: err.message });
  }
});

router.post(
  "/api/delivery/company/update/:id",
  upload.array("img"),
  async (req, res) => {
    try {
      const db = req.app.db['delivery-company'];
      const { id } = req.params;
      const { nameAR, nameHE, start, end, isStoreClose, isAlwaysOpen, id: companyId, phone, email, status, order, supportedCities } = req.body;

      // Validation
      if (!nameAR || !nameHE) {
        return res.status(400).json({ message: 'Company nameAR, and nameHE are required' });
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
      let parsedSupportedCities = [];
      try {
        parsedSupportedCities = typeof supportedCities === 'string' ? JSON.parse(supportedCities) : supportedCities;
      } catch (e) {
        return res.status(400).json({ message: 'Invalid supportedCities format' });
      }

      const company = await db.store.findOne({ _id: getId(id) });
      if (!company) {
        return res.status(404).json({ message: 'Delivery company not found' });
      }

      let image = company.image;
      if (req.files && req.files.length > 0) {
        image = (await uploadFile(req.files, req, `delivery-companies/${companyId}/logo`))[0];
        if (company.image) {
          await deleteImages([company.image], req);
        }
      }

      const updatedCompany = {
        ...company,
        nameAR,
        nameHE,
        start,
        end,
        isStoreClose: isStoreClose === 'true' || isStoreClose === true,
        isAlwaysOpen: isAlwaysOpen === 'true' || isAlwaysOpen === true,
        id: Number(companyId),
        phone: phone || '',
        email: email || '',
        status: status === 'true' || status === true,
        image,
        order: order ? Number(order) : 0,
        supportedCities: parsedSupportedCities.map(id => getId(id)),
        updatedAt: new Date()
      };

      await db.store.updateOne(
        { _id: getId(id) },
        { $set: updatedCompany }
      );
      res.status(200).json(updatedCompany);
    } catch (err) {
      res.status(500).json({ message: 'Failed to update delivery company', error: err.message });
    }
  }
);

router.delete("/api/delivery/company/:id", async (req, res) => {
  try {
    const db = req.app.db['delivery-company'];
    const { id } = req.params;
    
    const company = await db.store.findOne({ _id: getId(id) });
    if (!company) {
      return res.status(404).json({ message: 'Delivery company not found' });
    }

    if (company.image) {
      await deleteImages([company.image], req);
    }

    await db.store.deleteOne({ _id: getId(id) });
    res.status(200).json({ message: 'Delivery company deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete delivery company', error: err.message });
  }
});

// Get companies by city
router.get("/api/delivery/companies/by-city/:cityId", async (req, res) => {
  try {
    const db = req.app.db['delivery-company'];
    const { cityId } = req.params;
    const companies = await db.store.find({ 
      supportedCities: { $elemMatch: { $eq: getId(cityId) } }
    }).sort({ order: 1 }).toArray();
    res.status(200).json(companies);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch companies by city', error: err.message });
  }
});

// Delivery Company Employees Endpoints
router.get("/api/delivery/company/:companyId/employees", async (req, res) => {
  try {
    const db = req.app.db['delivery-company'];
    const { companyId } = req.params;
    const employees = await db.customers.find({ companyId }).toArray();
    res.status(200).json(employees);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch employees', error: err.message });
  }
});

router.post("/api/delivery/company/:companyId/employee/add", async (req, res) => {
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

router.post("/api/delivery/company/employee/update/:id", async (req, res) => {
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

router.get("/api/delivery/company/employee/:id", async (req, res) => {
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

router.delete("/api/delivery/company/employee/:id", async (req, res) => {
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

// Get areas by city
router.get('/api/delivery/areas/by-city/:cityId', async (req, res) => {
  try {
    const db = req.app.db['delivery-company'];
    const { cityId } = req.params;
    const areas = await db.areas.find({ cityId: cityId }).toArray();
    res.status(200).json(areas);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch areas by city', error: err.message });
  }
});


module.exports = router;
