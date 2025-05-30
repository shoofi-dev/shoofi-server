const moment = require("moment");
const utcTimeService = require("../../utils/utc-time");
const pushNotificationWebService = require("../../utils/push-notification/push-web");
const { getId } = require("../../lib/common");
const APP_CONSTS = require("../../consts/consts");

async function bookDelivery({ deliveryData, appDb }) {
  try {
    const db = appDb["delivery-company"];
    // Your logic (e.g., saving to DB, calling an external API)
    const offsetHours = utcTimeService.getUTCOffset();

    var deliveryDeltaMinutes = moment()
      .add(deliveryData.pickupTime, "m")
      .utcOffset(offsetHours)
      .format("HH:mm");

    let companyId = null;
    let companyName = null;
    // Only apply logic for stores not in SARI_APPS_DB_LIST
    if (
      deliveryData.appName &&
      !APP_CONSTS.SARI_APPS_DB_LIST.includes(deliveryData.appName) &&
      deliveryData.storeLocation &&
      deliveryData.coverageRadius
    ) {
      const bestCompany = await findBestDeliveryCompany({
        storeLocation: deliveryData.storeLocation,
        appDb
      });
      if (bestCompany) {
        companyId = bestCompany._id;
        companyName = bestCompany.name;
      }
    }

    await db.bookDelivery.insertOne({
      ...deliveryData,
      deliveryDeltaMinutes,
      status: "1",
      created: moment(new Date()).utcOffset(offsetHours).format(),
      companyId,
      companyName,
    });
    if(APP_CONSTS.SARI_APPS_DB_LIST.includes(deliveryData.appName)){
      const adminCustomer = await db.customers.find({
        role: "admin",
        $or: [
          { companyId: { $exists: false } },
          { companyId: null }
        ]
      }).toArray();
      pushNotificationWebService.sendNotificationToDevice(
        adminCustomer[0].notificationToken,
        { storeName: deliveryData?.storeName }
      );
    }else{
      const adminCustomer = await db.customers.find({
        role: "admin",
        companyId: companyId
      }).toArray();
      if(adminCustomer.length > 0){
      pushNotificationWebService.sendNotificationToDevice(
        adminCustomer[0].notificationToken,
        { storeName: deliveryData?.storeName }
      );
    }
    }

    return {
      success: true,
      message: "Delivery created successfully",
      deliveryId: "12345", // Example ID
    };
  } catch (error) {
    console.error("Error in createDelivery:", error);
    throw new Error("Error creating delivery");
  }
}

async function updateDelivery({ deliveryData, appDb }) {
  const db = appDb["delivery-company"];

  let updateData = deliveryData;
  const id = deliveryData.bookId;

  const order = await db.bookDelivery.findOne({
       bookId: deliveryData.bookId  // Match by bookId
  });

  let isPushEmploye = false;
  let isPushAdmin = false;
  if (order?.status === "1" && updateData?.status === "2") {
    isPushEmploye = true;
  }
  if (updateData.status === "-1") {
    isPushEmploye = true;
    isPushAdmin = true;
  }
  await db.bookDelivery.updateOne(
    {
      bookId: (id),
    },
    { $set: updateData },
    { multi: false }
  );

  if (isPushEmploye && order?.assignee) {
    const employe = await db.customers.findOne({
      _id: getId(order?.assignee),
    });
    if (employe) {
      pushNotificationWebService.sendNotificationToDevice(
        employe?.notificationToken,
        { storeName: order?.storeName },
        updateData.status
      );
    }
  }
  if (isPushAdmin && order) {
    const adminCustomer = await db.customers.find({ role: "admin" }).toArray();
    if (adminCustomer) {
      pushNotificationWebService.sendNotificationToDevice(
        adminCustomer[0].notificationToken,
        { storeName: order?.storeName },
        updateData.status
      );
    }
  }
}

/**
 * Find the best delivery company for a given store location.
 * @param {Object} params
 * @param {{lat: number, lng: number}} params.storeLocation - The store's coordinates
 * @param {Object} params.appDb - The appDb object with all dbs
 * @returns {Promise<Object|null>} The best delivery company document or null if none found
 */
async function findBestDeliveryCompany({ storeLocation, appDb }) {
  const db = appDb["delivery-company"];
  const companies = await db.store.find().toArray();

  function haversine(lat1, lng1, lat2, lng2) {
    const toRad = x => (x * Math.PI) / 180;
    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // 1. Filter companies by coverage
  const companiesWithDistance = companies
    .map(company => {
      if (!company?.location?.coordinates || !company.coverageRadius) return null;
      const distance = haversine(
        storeLocation.coordinates[1],
        storeLocation.coordinates[0],
        company.location.coordinates[1],
        company.location.coordinates[0]
      );
      return { ...company, distance };
    })
    .filter(company => company && company.distance <= company.coverageRadius);

  if (companiesWithDistance.length === 0) return null;

  // 2. Get active deliveries count for each company
  const companyIds = companiesWithDistance.map(c => c._id);
  const activeDeliveries = await db.bookDelivery.aggregate([
    { $match: { companyId: { $in: companyIds }, status: { $nin: ["delivered", "cancelled", "4", "5"] } } },
    { $group: { _id: "$companyId", count: { $sum: 1 } } }
  ]).toArray();
  const loadMap = {};
  activeDeliveries.forEach(d => { loadMap[d._id.toString()] = d.count; });
  companiesWithDistance.forEach(company => {
    company.activeDeliveries = loadMap[company._id.toString()] || 0;
  });

  // 3. Sort by fewest active deliveries, then by distance
  companiesWithDistance.sort((a, b) => {
    if (a.activeDeliveries !== b.activeDeliveries) {
      return a.activeDeliveries - b.activeDeliveries;
    }
    return a.distance - b.distance;
  });

  return companiesWithDistance[0];
}

const deliveryService = {
  bookDelivery: bookDelivery,
  updateDelivery: updateDelivery,
  findBestDeliveryCompany: findBestDeliveryCompany,
};
module.exports = deliveryService;
