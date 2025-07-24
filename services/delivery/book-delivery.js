const moment = require("moment");
const utcTimeService = require("../../utils/utc-time");
const { getId } = require("../../lib/common");
const APP_CONSTS = require("../../consts/consts");
const { assignBestDeliveryDriver } = require("./assignDriver");
const notificationService = require("../notification/notification-service");
const centralizedFlowMonitor = require("../monitoring/centralized-flow-monitor");
const { ObjectId } = require("mongodb");

async function bookDelivery({ deliveryData, appDb }) {
  try {
    const db = appDb["delivery-company"];
    const offsetHours = utcTimeService.getUTCOffset();

        // Check for existing booking with the same bookId
        const existingBooking = await db.bookDelivery.findOne({ bookId: deliveryData.bookId });
        if (existingBooking) {
          return {
            success: false,
            message: "A booking with this bookId already exists.",
            bookId: bookingData.bookId,
          };
        }

    var pickupTime = moment()
      .add(deliveryData.pickupTime, "m")
      .utcOffset(offsetHours)
      .format("HH:mm");

    const result = await assignBestDeliveryDriver({ 
      appDb: appDb, 
      location: { 
        lat: deliveryData?.customerLocation?.latitude, 
        lng: deliveryData?.customerLocation?.longitude 
      } 
    });
    

    if (!result.success) {
      // Track delivery assignment failure centrally
      await centralizedFlowMonitor.trackOrderFlowEvent({
        orderId: deliveryData.bookId,
        orderNumber: deliveryData.bookId,
        sourceApp: 'delivery-company',
        eventType: 'delivery_assignment_failed',
        status: 'failed',
        actor: 'Delivery System',
        actorId: 'delivery_system',
        actorType: 'system',
        metadata: {
          bookId: deliveryData.bookId,
          customerInfo: {
            name: deliveryData.fullName,
            phone: deliveryData.phone,
            location: deliveryData.customerLocation
          },
          error: "No available driver found for this location",
          appName: deliveryData.appName
        }
      });
      
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
        // Include coupon data if present
        appliedCoupon: deliveryData.appliedCoupon || null,
        expectedDeliveryAt: expectedDeliveryAtTemp.utcOffset(offsetHours).format("YYYY-MM-DDTHH:mm:ssZ")
      };

  

      // Debug log for delivery booking coupon data
      if (deliveryData.appliedCoupon) {
        console.log('Delivery service - Booking coupon data:', {
          couponType: deliveryData.appliedCoupon.coupon?.type,
          couponCode: deliveryData.appliedCoupon.coupon?.code,
          discountAmount: deliveryData.appliedCoupon.discountAmount,
          isFreeDelivery: deliveryData.appliedCoupon.coupon?.type === 'free_delivery'
        });
      }

      const bookDeliveryResult = await db.bookDelivery.insertOne(bookingData);
      const insertedOrder = { ...bookingData, _id: bookDeliveryResult.insertedId };

      // Track delivery assignment centrally
      await centralizedFlowMonitor.trackOrderFlowEvent({
        orderId: deliveryData.bookId,
        orderNumber: deliveryData.bookId,
        sourceApp: 'delivery-company',
        eventType: 'delivery_assigned',
        status: '1',
        actor: 'Delivery System',
        actorId: 'delivery_system',
        actorType: 'system',
        metadata: {
          deliveryId: insertedOrder._id,
          bookId: insertedOrder.bookId,
          assignedCompany: {
            id: result.company._id,
            name: result.company.storeName,
            location: result.company.location
          },
          assignedDriver: {
            id: result.driver._id,
            name: result.driver.fullName,
            phone: result.driver.phone,
            activeOrderCount: result.activeOrderCount
          },
          deliveryArea: {
            id: result.area._id,
            name: result.area.name,
            maxETA: result.area.maxETA
          },
          customerInfo: {
            name: deliveryData.fullName,
            phone: deliveryData.phone,
            location: deliveryData.customerLocation
          },
          pickupTime: pickupTime,
          expectedDeliveryAt: insertedOrder.expectedDeliveryAt,
          appName: deliveryData.appName
        }
      });

      // Send notification to driver using new notification service
      try {
        // Create a mock request object for the notification service
        const mockReq = {
          app: {
            db: appDb
          },
          headers: {
            'app-type': 'shoofi-shoofir'
          }
        };
        
                  await notificationService.sendNotification({
            recipientId: String(result.driver._id),
            title: 'تم تعيين طلب جديد',
            body: `لقد تم تعيينك للطلب: #${insertedOrder.bookId}`,
            type: 'order',
            appName: 'delivery-company',
            appType: 'shoofi-shoofir',
            channels: { websocket: true, push: true, email: false, sms: false },
            data: { 
              orderId: insertedOrder._id, 
              bookId: insertedOrder.bookId, 
              customerName: deliveryData.fullName,
              customerPhone: deliveryData.phone,
              storeName: deliveryData.storeName,
              pickupTime: pickupTime,
              payment_method: deliveryData?.order?.order?.payment_method
            },
            req: mockReq,
            soundType: 'driver.wav'
          });
      } catch (notificationError) {
        console.error("Failed to send notification to driver:", notificationError);
        // Don't fail the delivery creation if notification fails
      }

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

  // Track delivery status update centrally
  await centralizedFlowMonitor.trackOrderFlowEvent({
    orderId: order.bookId,
    orderNumber: order.bookId,
    sourceApp: 'delivery-company',
    eventType: 'delivery_status_update',
    status: updateData.status,
    actor: 'Driver',
    actorId: order.driver?._id || 'driver',
    actorType: 'driver',
    metadata: {
      deliveryId: order._id,
      bookId: order.bookId,
      previousStatus: order.status,
      newStatus: updateData.status,
      driverInfo: {
        id: order.driver?._id,
        name: order.driver?.fullName,
        phone: order.driver?.phone
      },
      companyInfo: {
        id: order.company?._id,
        name: order.company?.storeName
      },
      customerInfo: {
        name: order.fullName,
        phone: order.phone
      },
      statusChange: `${order.status} → ${updateData.status}`
    }
  });

  // Send notifications for driver using new notification service
  if (isPushEmploye && order?.driver?._id) {
    const employe = await db.customers.findOne({
      _id: getId(order.driver._id),
    });
    
    if (employe) {
      // Determine notification content based on status
      let notificationTitle = '';
      let notificationBody = '';
      let notificationType = 'order';
      
      switch(updateData.status) {
        case '2':
          notificationTitle = 'تم تعيين طلب جديد';
          notificationBody = `لقد تم تعيينك للطلب: #${order.bookId || order._id}`;
          break;
        case '0':
          notificationTitle = 'تم تسليم الطلب';
          notificationBody = `تم تسليم الطلب: #${order.bookId || order._id}`;
          notificationType = 'payment';
          break;
        case '-1':
          notificationTitle = 'تم إلغاء الطلب';
          notificationBody = `تم إلغاء الطلب: #${order.bookId || order._id}`;
          notificationType = 'alert';
          break;
      }
      
      if (notificationTitle && notificationBody) {
        try {
          // Create a mock request object for the notification service
          const mockReq = {
            app: {
              db: appDb
            },
            headers: {
              'app-type': 'shoofi-shoofir'
            }
          };
          
          await notificationService.sendNotification({
            recipientId: String(getId(order.driver._id) || order.driver._id),
            title: notificationTitle,
            body: notificationBody,
            type: notificationType,
            appName: 'delivery-company',
            appType: 'shoofi-shoofir',
            channels: { websocket: true, push: true, email: false, sms: false },
            data: { orderId: order._id, bookId: order.bookId, status: updateData.status },
            req: mockReq,
            soundType: 'driver.wav'
          });
        } catch (notificationError) {
          console.error("Failed to send notification to driver:", notificationError);
          // Don't fail the delivery update if notification fails
        }
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
