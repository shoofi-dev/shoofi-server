const moment = require("moment");
const utcTimeService = require("../../utils/utc-time");
const pushNotificationWebService = require("../../utils/push-notification/push-web");
const { getId } = require("../../lib/common");
const APP_CONSTS = require("../../consts/consts");
const { assignBestDeliveryDriver } = require("./assignDriver");

// Helper function to create notifications in database
const createNotification = async (db, recipientId, title, message, type = 'system', data = {}) => {
  try {
    const notification = {
      recipientId: getId(recipientId),
      title,
      message,
      type,
      isRead: false,
      createdAt: moment().utcOffset(utcTimeService.getUTCOffset()).format(),
      data,
    };
    
    await db.notifications.insertOne(notification);
    return notification;
  } catch (error) {
    console.error('Error creating notification:', error);
    throw error;
  }
};

async function bookDelivery({ deliveryData, appDb }) {
  try {
    const db = appDb["delivery-company"];
    const offsetHours = utcTimeService.getUTCOffset();

    var pickupTime = moment()
      .add(deliveryData.pickupTime, "m")
      .utcOffset(offsetHours)
      .format("HH:mm");

    const result = await assignBestDeliveryDriver({ 
      appDb: appDb, 
      location: { 
        lat: deliveryData.customerLocation.latitude, 
        lng: deliveryData.customerLocation.longitude 
      } 
    });
    

    if (!result.success) {
      // TODO: handle error - no driver found
      return {
        success: false,
        message: "No available driver found for this location",
      };
    } else {
      console.log("driver", result.driver);
      console.log("company", result.company);
      console.log("area", result.area);
      console.log("activeOrderCount", result.activeOrderCount);
      let expectedDeliveryAtTemp = moment(pickupTime, "HH:mm").utcOffset(offsetHours, true).add(parseInt(result.area?.maxETA), 'minutes').utcOffset(offsetHours, true);
      // Create the delivery booking with the new structure
      const now = moment().utcOffset(offsetHours);
      expectedDeliveryAtTemp.set({
        year: now.year(),
        month: now.month(),
        date: now.date(),
      });
      const bookingData = {
        ...deliveryData,
        pickupTime,
        status: "1",
        created: moment(new Date()).utcOffset(offsetHours).format(),
        area: result.area,
        company: result.company,
        driver: result.driver,
        activeOrderCount: result.activeOrderCount,
        bookId: deliveryData.bookId || `${Math.floor(Math.random() * 9000) + 1000}-${Math.floor(Math.random() * 900000) + 100000}-${Math.floor(Math.random() * 9000) + 1000}`,
        appName: deliveryData.appName || 'shoofi-app',

        expectedDeliveryAt: expectedDeliveryAtTemp.utcOffset(offsetHours).format("YYYY-MM-DDTHH:mm:ssZ")
      };

      const bookDeliveryResult = await db.bookDelivery.insertOne(bookingData);
      const insertedOrder = { ...bookingData, _id: bookDeliveryResult.insertedId };

      // Send push notification to driver
      pushNotificationWebService.sendNotificationToDevice(
        result.driver.notificationToken, 
        { storeName: deliveryData?.storeName }  
      );

      // Create database notification for driver
      await createNotification(
        db,
        result.driver._id,
        'New Order Assigned',
        `You have been assigned a new order #${insertedOrder.bookId}`,
        'order',
        { 
          orderId: insertedOrder._id, 
          bookId: insertedOrder.bookId, 
          customerName: deliveryData.fullName,
          customerPhone: deliveryData.phone 
        }
      );

      return {
        success: true,
        message: "Delivery created successfully",
        deliveryId: insertedOrder._id,
        bookId: insertedOrder.bookId,
      };
    }
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
  if (updateData.status === "0") {
    isPushEmploye = true;
  }
  if (updateData.status === "-1") {
    isPushEmploye = true;
  }
  
  await db.bookDelivery.updateOne(
    {
      bookId: (id),
    },
    { $set: updateData },
    { multi: false }
  );

  // Create notifications for driver
  if (isPushEmploye && order?.driver?._id) {
    const employe = await db.customers.findOne({
      _id: getId(order.driver._id),
    });
    
    if (employe) {
      // Send push notification
      pushNotificationWebService.sendNotificationToDevice(
        employe?.notificationToken,
        { storeName: order?.storeName },
        updateData.status
      );
      
      // Create database notification
      let notificationTitle = '';
      let notificationMessage = '';
      let notificationType = 'order';
      
      switch(updateData.status) {
        case '2':
          notificationTitle = 'Order Assigned';
          notificationMessage = `You have been assigned a new order #${order.bookId || order._id}`;
          break;
        case '0':
          notificationTitle = 'Order Delivered';
          notificationMessage = `Order #${order.bookId || order._id} has been successfully delivered`;
          notificationType = 'payment';
          break;
        case '-1':
          notificationTitle = 'Order Cancelled';
          notificationMessage = `Order #${order.bookId || order._id} has been cancelled`;
          notificationType = 'alert';
          break;
      }
      
      if (notificationTitle && notificationMessage) {
        await createNotification(
          db, 
          order.driver._id, 
          notificationTitle, 
          notificationMessage, 
          notificationType,
          { orderId: order._id, bookId: order.bookId, status: updateData.status }
        );
      }
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
