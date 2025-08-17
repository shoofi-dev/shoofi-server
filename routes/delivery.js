const express = require("express");
const moment = require("moment");
const router = express.Router();
const momentTZ = require("moment-timezone");
const { getId } = require("../lib/common");
const pushNotificationWebService = require("../utils/push-notification/push-web");
const { uploadFile, deleteImages } = require("./product");
var multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });
const { ObjectId } = require("mongodb");
const deliveryService = require("../services/delivery/book-delivery");
const { findAllMatchingDrivers } = require("../services/delivery/assignDriver");
const notificationService = require("../services/notification/notification-service");
const centralizedFlowMonitor = require("../services/monitoring/centralized-flow-monitor");
const { DELIVERY_STATUS } = require("../consts/consts");

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
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  try {
    const deliveryData = req.body.deliveryData;

    // Use the delivery service
    const result = await deliveryService.bookDelivery({
      deliveryData: { ...deliveryData, appName },
      appDb: req.app.db,
    });

    if (result.success) {
      return res.status(200).json({
        message: "order custom delivery booked successfully",
        deliveryId: result.deliveryId,
        bookId: result.bookId,
      });
    } else {
      return res.status(400).json({ message: result.message });
    }
  } catch (ex) {
    console.info("Error order custom delivery booked", ex);
    return res
      .status(400)
      .json({ message: "order custom delivery booked failed" });
  }
});

// Approve order
router.post("/api/delivery/driver/order/approve", async (req, res) => {
  const appName = "delivery-company";
  const db = req.app.db[appName];
  try {
    const { orderId, driverId } = req.body;

    // Update delivery status to approved
    await db.bookDelivery.updateOne(
      { _id: getId(orderId), "driver._id": ObjectId(driverId) },
      { $set: { status: DELIVERY_STATUS.APPROVED, approvedAt: new Date() } }
    );

    // Get the updated delivery order
    const deliveryOrder = await db.bookDelivery.findOne({
      _id: getId(orderId),
    });
    const customerId = deliveryOrder?.order?.customerId;

    // Track delivery approval centrally
    await centralizedFlowMonitor.trackOrderFlowEvent({
      orderId: orderId,
      orderNumber: deliveryOrder.bookId,
      sourceApp: "delivery-company",
      eventType: "delivery_approved_by_driver",
      status: DELIVERY_STATUS.APPROVED,
      actor: deliveryOrder.driver?.fullName || "Driver",
      actorId: driverId,
      actorType: "driver",
      metadata: {
        deliveryId: orderId,
        bookId: deliveryOrder.bookId,
        driverInfo: {
          id: driverId,
          name: deliveryOrder.driver?.fullName,
          phone: deliveryOrder.driver?.phone,
        },
        companyInfo: {
          id: deliveryOrder.company?._id,
          name: deliveryOrder.company?.storeName,
        },
        customerInfo: {
          name: deliveryOrder.fullName,
          phone: deliveryOrder.phone,
        },
        approvedAt: new Date().toISOString(),
        action: "driver_accepted_delivery",
      },
    });

    // Send notification to customer about delivery approval
    if (deliveryOrder && customerId) {
      try {
        // Create a mock request object for the notification service
        const mockReq = {
          app: {
            db: req.app.db,
          },
          headers: {
            "app-type": "shoofi-app",
          },
        };

        await notificationService.sendNotification({
          recipientId: customerId,
          title: "تم تأكيد التوصيل",
          body: `تم تأكيد توصيل طلبك من قبل السائق.`,
          type: "delivery_approved",
          appName: deliveryOrder.appName || "shoofi-app",
          appType: "shoofi-app",
          channels: { websocket: true, push: true, email: false, sms: false },
          data: {
            orderId: deliveryOrder._id,
            bookId: deliveryOrder.bookId,
            deliveryStatus: DELIVERY_STATUS.APPROVED,
            driverName: deliveryOrder.driver?.name || "السائق",
          },
          req: mockReq,
          soundType: 'driver.wav'
        });
      } catch (notificationError) {
        console.error(
          "Failed to send customer notification for delivery approval:",
          notificationError
        );
        // Don't fail the delivery update if notification fails
      }
    }

    res.status(200).json({ message: "Order approved" });
  } catch (ex) {
    console.info("Error approving order", ex);
    return res.status(400).json({ message: "Error approving order" });
  }
});

// Cancel order
router.post("/api/delivery/driver/order/cancel", async (req, res) => {
  const appName = "delivery-company";
  const db = req.app.db[appName];
  try {
    const { orderId, driverId, reason } = req.body;

    // Update delivery status to cancelled by driver
    await db.bookDelivery.updateOne(
      { _id: getId(orderId), "driver._id": ObjectId(driverId) },
      {
        $set: {
          status: DELIVERY_STATUS.CANCELLED_BY_DRIVER,
          cancelledAt: new Date(),
          cancelReason: reason || null,
        },
      }
    );

    // Get the updated delivery order
    const deliveryOrder = await db.bookDelivery.findOne({
      _id: getId(orderId),
    });

    // Track delivery cancellation centrally
    await centralizedFlowMonitor.trackOrderFlowEvent({
      orderId: orderId,
      orderNumber: deliveryOrder.bookId,
      sourceApp: "delivery-company",
      eventType: "delivery_cancelled_by_driver",
      status: DELIVERY_STATUS.CANCELLED_BY_DRIVER,
      actor: deliveryOrder.driver?.fullName || "Driver",
      actorId: driverId,
      actorType: "driver",
      metadata: {
        deliveryId: orderId,
        bookId: deliveryOrder.bookId,
        cancelReason: reason,
        driverInfo: {
          id: driverId,
          name: deliveryOrder.driver?.fullName,
          phone: deliveryOrder.driver?.phone,
        },
        companyInfo: {
          id: deliveryOrder.company?._id,
          name: deliveryOrder.company?.storeName,
        },
        customerInfo: {
          name: deliveryOrder.fullName,
          phone: deliveryOrder.phone,
        },
        cancelledAt: new Date().toISOString(),
      },
    });

    // Send notification to customer about delivery cancellation
    const customerId = deliveryOrder?.order?.customerId;
    if (deliveryOrder && customerId) {
      try {
        // Create a mock request object for the notification service
        const mockReq = {
          app: {
            db: req.app.db,
          },
          headers: {
            "app-type": "shoofi-app",
          },
        };

        await notificationService.sendNotification({
          recipientId: customerId,
          title: "تم إلغاء التوصيل",
          body: `تم إلغاء توصيل طلبك من قبل السائق. سيتم تعيين سائق جديد.`,
          type: "delivery_cancelled_driver",
          appName: deliveryOrder.appName || "shoofi-app",
          appType: "shoofi-app",
          channels: { websocket: true, push: true, email: false, sms: false },
          data: {
            orderId: deliveryOrder._id,
            bookId: deliveryOrder.bookId,
            deliveryStatus: DELIVERY_STATUS.CANCELLED_BY_DRIVER,
            cancelReason: reason,
            driverName: deliveryOrder.driver?.name || "السائق",
          },
          req: mockReq,
          soundType: 'customer.wav'
        });
      } catch (notificationError) {
        console.error(
          "Failed to send customer notification for delivery cancellation:",
          notificationError
        );
        // Don't fail the delivery update if notification fails
      }
    }

    res.status(200).json({ message: "Order cancelled" });
  } catch (ex) {
    console.info("Error cancelling order", ex);
    return res.status(400).json({ message: "Error cancelling order" });
  }
});

// Start order (collected from restaurant)
router.post("/api/delivery/driver/order/start", async (req, res) => {
  const appName = "delivery-company";
  const db = req.app.db[appName];
  try {
    const { orderId, driverId } = req.body;

    // Update delivery status to collected from restaurant
    await db.bookDelivery.updateOne(
      { _id: getId(orderId), "driver._id": ObjectId(driverId) },
      {
        $set: {
          status: DELIVERY_STATUS.COLLECTED_FROM_RESTAURANT,
          startedAt: new Date(),
        },
      }
    );

    // Get the updated delivery order
    const deliveryOrder = await db.bookDelivery.findOne({
      _id: getId(orderId),
    });

    // Track delivery start centrally
    await centralizedFlowMonitor.trackOrderFlowEvent({
      orderId: orderId,
      orderNumber: deliveryOrder.bookId,
      sourceApp: "delivery-company",
      eventType: "delivery_started_by_driver",
      status: DELIVERY_STATUS.COLLECTED_FROM_RESTAURANT,
      actor: deliveryOrder.driver?.fullName || "Driver",
      actorId: driverId,
      actorType: "driver",
      metadata: {
        deliveryId: orderId,
        bookId: deliveryOrder.bookId,
        driverInfo: {
          id: driverId,
          name: deliveryOrder.driver?.fullName,
          phone: deliveryOrder.driver?.phone,
        },
        companyInfo: {
          id: deliveryOrder.company?._id,
          name: deliveryOrder.company?.storeName,
        },
        customerInfo: {
          name: deliveryOrder.fullName,
          phone: deliveryOrder.phone,
        },
        startedAt: new Date().toISOString(),
        action: "collected_from_restaurant",
      },
    });

    // Send notification to customer about delivery start
    const customerId = deliveryOrder?.order?.customerId;
    if (deliveryOrder && customerId) {
      try {
        // Create a mock request object for the notification service
        const mockReq = {
          app: {
            db: req.app.db,
          },
          headers: {
            "app-type": "shoofi-app",
          },
        };

        await notificationService.sendNotification({
          recipientId: customerId,
          title: "تم استلام طلبك",
          body: `تم استلام طلبك رقم من المطعم وهو في الطريق إليك.`,
          type: "delivery_collected",
          appName: deliveryOrder.appName || "shoofi-app",
          appType: "shoofi-app",
          channels: { websocket: true, push: true, email: false, sms: false },
          data: {
            orderId: deliveryOrder._id,
            bookId: deliveryOrder.bookId,
            deliveryStatus: DELIVERY_STATUS.COLLECTED_FROM_RESTAURANT,
            driverName: deliveryOrder.driver?.name || "السائق",
          },
          req: mockReq,
          soundType: 'customer.wav'
        });
      } catch (notificationError) {
        console.error(
          "Failed to send customer notification for delivery start:",
          notificationError
        );
        // Don't fail the delivery update if notification fails
      }
    }

    res.status(200).json({ message: "Order started" });
  } catch (ex) {
    console.info("Error starting order", ex);
    return res.status(400).json({ message: "Error starting order" });
  }
});

// Complete order (delivered)
router.post("/api/delivery/driver/order/complete", async (req, res) => {
  const appName = "delivery-company";
  const db = req.app.db[appName];
  try {
    const { orderId, driverId } = req.body;

    // Update delivery status to delivered
    await db.bookDelivery.updateOne(
      { _id: getId(orderId), "driver._id": ObjectId(driverId) },
      { $set: { status: DELIVERY_STATUS.DELIVERED, completedAt: new Date() } }
    );

    // Get the updated delivery order
    const deliveryOrder = await db.bookDelivery.findOne({
      _id: getId(orderId),
    });

    // Track delivery completion centrally
    await centralizedFlowMonitor.trackOrderFlowEvent({
      orderId: orderId,
      orderNumber: deliveryOrder.bookId,
      sourceApp: "delivery-company",
      eventType: "delivery_completed_by_driver",
      status: DELIVERY_STATUS.DELIVERED,
      actor: deliveryOrder.driver?.fullName || "Driver",
      actorId: driverId,
      actorType: "driver",
      metadata: {
        deliveryId: orderId,
        bookId: deliveryOrder.bookId,
        driverInfo: {
          id: driverId,
          name: deliveryOrder.driver?.fullName,
          phone: deliveryOrder.driver?.phone,
        },
        companyInfo: {
          id: deliveryOrder.company?._id,
          name: deliveryOrder.company?.storeName,
        },
        customerInfo: {
          name: deliveryOrder.fullName,
          phone: deliveryOrder.phone,
        },
        completedAt: new Date().toISOString(),
        action: "delivered_to_customer",
      },
    });

    // Send notification to customer about delivery completion
    const customerId = deliveryOrder?.order?.customerId;
    if (deliveryOrder && customerId) {
      try {
        // Create a mock request object for the notification service
        const mockReq = {
          app: {
            db: req.app.db,
          },
          headers: {
            "app-type": "shoofi-app",
          },
        };

        await notificationService.sendNotification({
          recipientId: customerId,
          title: "تم تسليم طلبك",
          body: `تم تسليم طلبك رقم بنجاح. نتمنى لك وجبة شهية!`,
          type: "delivery_completed",
          appName: deliveryOrder.appName || "shoofi-app",
          appType: "shoofi-app",
          channels: { websocket: true, push: true, email: false, sms: false },
          data: {
            orderId: deliveryOrder._id,
            bookId: deliveryOrder.bookId,
            deliveryStatus: DELIVERY_STATUS.DELIVERED,
            driverName: deliveryOrder.driver?.name || "السائق",
          },
          req: mockReq,
          soundType: 'customer.wav'
        });
      } catch (notificationError) {
        console.error(
          "Failed to send customer notification for delivery completion:",
          notificationError
        );
        // Don't fail the delivery update if notification fails
      }
    }

    res.status(200).json({ message: "Order completed" });
  } catch (ex) {
    console.info("Error completing order", ex);
    return res.status(400).json({ message: "Error completing order" });
  }
});

router.post("/api/delivery/create-customer", async (req, res) => {
  const appName = req.headers["app-name"];
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
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const companyId = req.body.companyId;
  try {
    const employesList = await db.customers
      .find({ role: "employe", companyId: companyId })
      .toArray();
    // websockets.fireWebscoketEvent("order delivery booked");
    return res.status(200).json(employesList);
  } catch (ex) {
    console.info("Error order custom delivery booked", ex);
    return res
      .status(400)
      .json({ message: "order custom delivery booke failed" });
  }
});

router.post("/api/delivery/employe-payments", async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];

  var start = moment().subtract(7, "days").utcOffset(120);
  start.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });

  var end = moment().utcOffset(120);
  end.set({ hour: 23, minute: 59, second: 59, millisecond: 999 });
  const filterBy = {
    created: { $gte: start.format(), $lt: end.format() },
    status: { $ne: DELIVERY_STATUS.DELIVERED },
  };
  try {
    const employePayments = await db.bookDelivery
      .aggregate([
        {
          $match: filterBy, // Filter records based on date range
        },
        {
          $project: {
            driverId: "$driver._id", // Include the delivery man (driver._id)
            created: 1, // Keep the created field as is
            // Convert 'created' string to Date type, add the UTC offset and format as 'YYYY-MM-DD'
            date: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: {
                  $add: [
                    { $dateFromString: { dateString: "$created" } }, // Convert the created string to Date
                    120 * 60 * 1000, // Add UTC+120 milliseconds to adjust time
                  ],
                },
              },
            },
          },
        },
        {
          $group: {
            _id: { assignee: "$driverId", date: "$date" }, // Group by driver and formatted date
            orderCount: { $sum: 1 }, // Count the number of orders per day per delivery man
          },
        },
        {
          $group: {
            _id: "$_id.assignee", // Group by driver
            dailyOrders: {
              // Create an array of daily order counts
              $push: { date: "$_id.date", orderCount: "$orderCount" },
            },
          },
        },
        {
          $project: {
            assignee: "$_id", // Include driver's ID
            dailyOrders: 1, // Include the daily orders array
          },
        },
        {
          $sort: { assignee: 1 }, // Sort by driver
        },
      ])
      .toArray();

    // websockets.fireWebscoketEvent("order delivery booked");
    return res.status(200).json(employePayments);
  } catch (ex) {
    console.info("Error order custom delivery booked", ex);
    return res
      .status(400)
      .json({ message: "order custom delivery booke failed" });
  }
});

router.post("/api/delivery/list", async (req, res) => {
  const appName = "delivery-company";
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

    const statusList = req.body.statusList || [
      DELIVERY_STATUS.WAITING_FOR_APPROVE,
      DELIVERY_STATUS.APPROVED,
      DELIVERY_STATUS.COLLECTED_FROM_RESTAURANT,
      DELIVERY_STATUS.CANCELLED_BY_DRIVER,
    ];
    const offsetHours = getUTCOffset();

    let startOfToday = moment().utcOffset(offsetHours).startOf("day");

    if (isAllWeek) {
      startOfToday.subtract(7, "d");
    }else{
      startOfToday.subtract(1, "h");
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

    // Filter by company ID from the embedded company object
    if (customer.companyId) {
      filterBy = {
        ...filterBy,
        "company._id": getId(customer.companyId),
      };
    }

    // Filter by employee/driver assignments
    if (
      customer.role === "employe" ||
      customer.role === "driver" ||
      customer.role === "admin"
    ) {
      filterBy = {
        ...filterBy,
        "driver._id": ObjectId(customerId),
        status: { $ne: DELIVERY_STATUS.WAITING_FOR_APPROVE },
      };
    }

    // Filter by store if customer is a store
    if (customer.role === "store") {
      filterBy = {
        ...filterBy,
        storeId: String(getId(customer._id)),
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
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  try {
    let updateData = req.body;

    // Use the delivery service for updates
    await deliveryService.updateDelivery({
      deliveryData: updateData,
      appDb: req.app.db,
    });

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
router.get("/api/delivery/areas", async (req, res) => {
  const db = req.app.db["delivery-company"];
  const areas = await db.areas.find().toArray();
  res.json(areas);
});

// Add area
router.post("/api/delivery/area/add", async (req, res) => {
  const db = req.app.db["delivery-company"];
  const { name, geometry, cityId, minETA, maxETA, price } = req.body;
  if (!name || !geometry || !cityId)
    return res
      .status(400)
      .json({ message: "Name, geometry and cityId required" });
  const area = {
    name,
    geometry,
    cityId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  if (minETA !== undefined) area.minETA = minETA;
  if (maxETA !== undefined) area.maxETA = maxETA;
  if (price !== undefined) area.price = price;
  const result = await db.areas.insertOne(area);
  res.status(201).json({ ...area, _id: result.insertedId });
});

// Update area
router.post("/api/delivery/area/update/:id", async (req, res) => {
  const db = req.app.db["delivery-company"];
  const { id } = req.params;
  const { name, geometry, cityId, minETA, maxETA, price } = req.body;
  const updateObj = { name, geometry, cityId, updatedAt: new Date() };
  if (minETA !== undefined) updateObj.minETA = minETA;
  if (maxETA !== undefined) updateObj.maxETA = maxETA;
  if (price !== undefined) updateObj.price = price;
  await db.areas.updateOne({ _id: getId(id) }, { $set: updateObj });
  res.json({ message: "Area updated" });
});

// Delete area
router.delete("/api/delivery/area/:id", async (req, res) => {
  const db = req.app.db["delivery-company"];
  const { id } = req.params;
  await db.areas.deleteOne({ _id: getId(id) });
  res.json({ message: "Area deleted" });
});

// Get single area by ID
router.get("/api/delivery/area/:id", async (req, res) => {
  const db = req.app.db["delivery-company"];
  const { id } = req.params;
  const area = await db.areas.findOne({ _id: getId(id) });
  if (!area) return res.status(404).json({ message: "Area not found" });
  res.json(area);
});

// --- Company Supported Areas ---

// List supported areas/prices for a company
router.get("/api/delivery/company/:companyId/areas", async (req, res) => {
  const db = req.app.db["delivery-company"];
  const { companyId } = req.params;
  const company = await db.store.findOne({ _id: getId(companyId) });
  res.json(company?.supportedAreas || []);
});

// Add area/price to company
router.post("/api/delivery/company/:companyId/area/add", async (req, res) => {
  const db = req.app.db["delivery-company"];
  const { companyId } = req.params;
  const { areaId, price, minOrder, eta } = req.body;
  if (!areaId || price == null)
    return res.status(400).json({ message: "areaId and price required" });
  await db.store.updateOne(
    { _id: getId(companyId) },
    {
      $push: {
        supportedAreas: { areaId: getId(areaId), price, minOrder, eta },
      },
    }
  );
  res.json({ message: "Area added to company" });
});

// Update price/minOrder/eta for area
router.post(
  "/api/delivery/company/:companyId/area/update/:areaId",
  async (req, res) => {
    const db = req.app.db["delivery-company"];
    const { companyId, areaId } = req.params;
    const { price, minOrder, eta } = req.body;
    await db.store.updateOne(
      { _id: getId(companyId), "supportedAreas.areaId": getId(areaId) },
      {
        $set: {
          "supportedAreas.$.price": price,
          "supportedAreas.$.minOrder": minOrder,
          "supportedAreas.$.eta": eta,
        },
      }
    );
    res.json({ message: "Area updated for company" });
  }
);

// Remove area from company
router.delete(
  "/api/delivery/company/:companyId/area/:areaId",
  async (req, res) => {
    const db = req.app.db["delivery-company"];
    const { companyId, areaId } = req.params;
    await db.store.updateOne(
      { _id: getId(companyId) },
      { $pull: { supportedAreas: { areaId: getId(areaId) } } }
    );
    res.json({ message: "Area removed from company" });
  }
);

// Get a single supported area for a company
router.get(
  "/api/delivery/company/:companyId/area/:areaId",
  async (req, res) => {
    const db = req.app.db["delivery-company"];
    const { companyId, areaId } = req.params;
    const company = await db.store.findOne({ _id: getId(companyId) });
    if (!company) return res.status(404).json({ message: "Company not found" });
    const area = (company.supportedAreas || []).find((a) =>
      a.areaId.equals(getId(areaId))
    );
    if (!area)
      return res
        .status(404)
        .json({ message: "Area not found for this company" });
    res.json(area);
  }
);

// --- Price by Location ---

router.post("/api/delivery/company/price-by-location", async (req, res) => {
  const db = req.app.db["delivery-company"];
  const { companyId, lat, lng } = req.body;
  if (!companyId || lat == null || lng == null)
    return res.status(400).json({ message: "companyId, lat, lng required" });

  // Find area containing the point
  const area = await db.areas.findOne({
    geometry: {
      $geoIntersects: {
        $geometry: { type: "Point", coordinates: [lng, lat] },
      },
    },
  });
  if (!area)
    return res
      .status(404)
      .json({ message: "No delivery area found for this location" });

  // Find company and area price
  const company = await db.store.findOne({ _id: getId(companyId) });
  if (!company) return res.status(404).json({ message: "Company not found" });
  const areaInfo = (company.supportedAreas || []).find((a) =>
    a.areaId.equals(area._id)
  );
  if (!areaInfo)
    return res
      .status(404)
      .json({ message: "Company does not support this area" });

  res.json({
    areaId: area._id,
    areaName: area.name,
    price: areaInfo.price,
    minOrder: areaInfo.minOrder,
    eta: areaInfo.eta,
  });
});

// --- City Management ---

// List all cities
router.get("/api/delivery/cities", async (req, res) => {
  const db = req.app.db["delivery-company"];
  const cities = await db.cities.find().toArray();
  res.json(cities);
});

// Add city
router.post("/api/delivery/city/add", async (req, res) => {
  const db = req.app.db["delivery-company"];
  const { nameAR, nameHE, geometry } = req.body;
  if (!nameAR || !nameHE || !geometry)
    return res.status(400).json({ message: "Name and geometry required" });
  const city = {
    nameAR,
    nameHE,
    geometry,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const result = await db.cities.insertOne(city);
  res.status(201).json({ ...city, _id: result.insertedId });
});

// Update city
router.post("/api/delivery/city/update/:id", async (req, res) => {
  const db = req.app.db["delivery-company"];
  const { id } = req.params;
  const { nameAR, nameHE, geometry } = req.body;
  await db.cities.updateOne(
    { _id: getId(id) },
    { $set: { nameAR, nameHE, geometry, updatedAt: new Date() } }
  );
  res.json({ message: "City updated" });
});

// Delete city
router.delete("/api/delivery/city/:id", async (req, res) => {
  const db = req.app.db["delivery-company"];
  const { id } = req.params;
  await db.cities.deleteOne({ _id: getId(id) });
  res.json({ message: "City deleted" });
});

// Get single city by ID
router.get("/api/delivery/city/:id", async (req, res) => {
  const db = req.app.db["delivery-company"];
  const { id } = req.params;
  const city = await db.cities.findOne({ _id: getId(id) });
  if (!city) return res.status(404).json({ message: "City not found" });
  res.json(city);
});

// Delivery Company Endpoints
router.get("/api/delivery/companies", async (req, res) => {
  try {
    const db = req.app.db["delivery-company"];
    const companies = await db.store.find().sort({ order: 1 }).toArray();
    res.status(200).json(companies);
  } catch (err) {
    res
      .status(500)
      .json({
        message: "Failed to fetch delivery companies",
        error: err.message,
      });
  }
});

router.post(
  "/api/delivery/company/add",
  upload.array("img"),
  async (req, res) => {
    try {
      const db = req.app.db["delivery-company"];
      const {
        nameAR,
        nameHE,
        start,
        end,
        isStoreClose,
        isAlwaysOpen,
        phone,
        email,
        status,
        supportedCities,
      } = req.body;

      // Validation
      if (!nameAR || !nameHE) {
        return res
          .status(400)
          .json({ message: "nameAR, and nameHE are required" });
      }
      if (!start || !end) {
        return res
          .status(400)
          .json({ message: "Start and end times are required" });
      }
      if (
        typeof isStoreClose === "undefined" ||
        typeof isAlwaysOpen === "undefined"
      ) {
        return res
          .status(400)
          .json({ message: "isStoreClose and isAlwaysOpen are required" });
      }

      let parsedSupportedCities = [];
      try {
        parsedSupportedCities =
          typeof supportedCities === "string"
            ? JSON.parse(supportedCities)
            : supportedCities;
      } catch (e) {
        return res
          .status(400)
          .json({ message: "Invalid supportedCities format" });
      }
      const newCompanyId = getId();
      let images = [];
      if (req.files && req.files.length > 0) {
        images = await uploadFile(
          req.files,
          req,
          `delivery-companies/${newCompanyId}/logo`
        );
      }

      const newCompany = {
        _id: newCompanyId,
        nameAR,
        nameHE,
        start,
        end,
        isStoreClose: isStoreClose === "true" || isStoreClose === true,
        isAlwaysOpen: isAlwaysOpen === "true" || isAlwaysOpen === true,
        phone: phone || "",
        email: email || "",
        status: status === "true" || status === true,
        image: images.length > 0 ? images[0] : "",
        supportedCities: parsedSupportedCities.map((id) => getId(id)),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await db.store.insertOne(newCompany);
      res.status(201).json(newCompany);
    } catch (err) {
      res
        .status(500)
        .json({
          message: "Failed to add delivery company",
          error: err.message,
        });
    }
  }
);

// Get all employees with active orders count
router.get("/api/delivery/company/employees", async (req, res) => {
  try {
    const db = req.app.db["delivery-company"];
    const employees = await db.customers.find({}).toArray();
    
    // Get active orders count and company info for each employee
    const employeesWithOrderCounts = await Promise.all(
      employees.map(async (employee) => {
        const activeOrderCount = await db.bookDelivery.countDocuments({
          "driver._id": employee._id,
          status: { $in: ["1", "2", "3"] } // Active order statuses
        });
        
        // Get company information
        const company = await db.store.findOne({ _id: getId(employee.companyId) });
        
        return {
          ...employee,
          activeOrderCount,
          company: company ? {
            nameHE: company.nameHE,
            nameAR: company.nameAR,
            name: company.name
          } : null
        };
      })
    );
    
    res.status(200).json(employeesWithOrderCounts);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to fetch employees with order counts", error: err.message });
  }
});

router.get("/api/delivery/company/:id", async (req, res) => {
  try {
    const db = req.app.db["delivery-company"];
    const { id } = req.params;
    const company = await db.store.findOne({ _id: getId(id) });
    if (!company) {
      return res.status(404).json({ message: "Delivery company not found" });
    }
    res.status(200).json(company);
  } catch (err) {
    res
      .status(500)
      .json({
        message: "Failed to fetch delivery company",
        error: err.message,
      });
  }
});

router.post(
  "/api/delivery/company/update/:id",
  upload.array("img"),
  async (req, res) => {
    try {
      const db = req.app.db["delivery-company"];
      const { id } = req.params;
      const {
        nameAR,
        nameHE,
        start,
        end,
        isStoreClose,
        isAlwaysOpen,
        id: companyId,
        phone,
        email,
        status,
        order,
        supportedCities,
      } = req.body;

      // Validation
      if (!nameAR || !nameHE) {
        return res
          .status(400)
          .json({ message: "Company nameAR, and nameHE are required" });
      }
      if (!start || !end) {
        return res
          .status(400)
          .json({ message: "Start and end times are required" });
      }
      if (
        typeof isStoreClose === "undefined" ||
        typeof isAlwaysOpen === "undefined"
      ) {
        return res
          .status(400)
          .json({ message: "isStoreClose and isAlwaysOpen are required" });
      }
      if (typeof id === "undefined" && typeof companyId === "undefined") {
        return res.status(400).json({ message: "id is required" });
      }
      let parsedSupportedCities = [];
      try {
        parsedSupportedCities =
          typeof supportedCities === "string"
            ? JSON.parse(supportedCities)
            : supportedCities;
      } catch (e) {
        return res
          .status(400)
          .json({ message: "Invalid supportedCities format" });
      }

      const company = await db.store.findOne({ _id: getId(id) });
      if (!company) {
        return res.status(404).json({ message: "Delivery company not found" });
      }

      let image = company.image;
      if (req.files && req.files.length > 0) {
        image = (
          await uploadFile(
            req.files,
            req,
            `delivery-companies/${companyId}/logo`
          )
        )[0];
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
        isStoreClose: isStoreClose === "true" || isStoreClose === true,
        isAlwaysOpen: isAlwaysOpen === "true" || isAlwaysOpen === true,
        id: Number(companyId),
        phone: phone || "",
        email: email || "",
        status: status === "true" || status === true,
        image,
        order: order ? Number(order) : 0,
        supportedCities: parsedSupportedCities.map((id) => getId(id)),
        updatedAt: new Date(),
      };

      await db.store.updateOne({ _id: getId(id) }, { $set: updatedCompany });
      res.status(200).json(updatedCompany);
    } catch (err) {
      res
        .status(500)
        .json({
          message: "Failed to update delivery company",
          error: err.message,
        });
    }
  }
);

router.delete("/api/delivery/company/:id", async (req, res) => {
  try {
    const db = req.app.db["delivery-company"];
    const { id } = req.params;

    const company = await db.store.findOne({ _id: getId(id) });
    if (!company) {
      return res.status(404).json({ message: "Delivery company not found" });
    }

    if (company.image) {
      await deleteImages([company.image], req);
    }

    await db.store.deleteOne({ _id: getId(id) });
    res.status(200).json({ message: "Delivery company deleted successfully" });
  } catch (err) {
    res
      .status(500)
      .json({
        message: "Failed to delete delivery company",
        error: err.message,
      });
  }
});

// Get companies by city
router.get("/api/delivery/companies/by-city/:cityId", async (req, res) => {
  try {
    const db = req.app.db["delivery-company"];
    const { cityId } = req.params;
    const companies = await db.store
      .find({
        supportedCities: { $elemMatch: { $eq: getId(cityId) } },
      })
      .sort({ order: 1 })
      .toArray();
    res.status(200).json(companies);
  } catch (err) {
    res
      .status(500)
      .json({
        message: "Failed to fetch companies by city",
        error: err.message,
      });
  }
});

// Get employees with active orders count for specific company
router.get("/api/delivery/company/:companyId/employees-with-orders", async (req, res) => {
  try {
    const db = req.app.db["delivery-company"];
    const { companyId } = req.params;
    const employees = await db.customers.find({ companyId }).toArray();
    
    // Get company information
    const company = await db.store.findOne({ _id: getId(companyId) });
    
    // Get active orders count for each employee
    const employeesWithOrderCounts = await Promise.all(
      employees.map(async (employee) => {
        const activeOrderCount = await db.bookDelivery.countDocuments({
          "driver._id": employee._id,
          status: { $in: ["1", "2", "3"] } // Active order statuses
        });
        
        return {
          ...employee,
          activeOrderCount,
          company: company ? {
            nameHE: company.nameHE,
            nameAR: company.nameAR,
            name: company.name
          } : null
        };
      })
    );
    
    res.status(200).json(employeesWithOrderCounts);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to fetch employees with order counts", error: err.message });
  }
});

// Delivery Company Employees Endpoints
router.get("/api/delivery/company/:companyId/employees", async (req, res) => {
  try {
    const db = req.app.db["delivery-company"];
    const { companyId } = req.params;
    const employees = await db.customers.find({ companyId }).toArray();
    res.status(200).json(employees);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to fetch employees", error: err.message });
  }
});

router.post(
  "/api/delivery/company/:companyId/employee/add",
  async (req, res) => {
    try {
      const db = req.app.db["delivery-company"];
      const { companyId } = req.params;
      const { phone, role, fullName, isActive, userName, isDriver, maxOrdersByAdmin } = req.body;
      if (!phone || !role || !fullName) {
        return res
          .status(400)
          .json({ message: "phone, role, and fullName are required" });
      }
      const newEmployee = {
        phone,
        role,
        fullName,
        isActive: isActive === "true" || isActive === true,
        companyId,
        createdAt: new Date(),
        updatedAt: new Date(),
        userName,
        isDriver,
        maxOrdersByAdmin: maxOrdersByAdmin ? Number(maxOrdersByAdmin) : null,
      };
      const result = await db.customers.insertOne(newEmployee);
      res.status(201).json({ ...newEmployee, _id: result.insertedId });
    } catch (err) {
      res
        .status(500)
        .json({ message: "Failed to add employee", error: err.message });
    }
  }
);

router.post("/api/delivery/company/employee/update/:id", async (req, res) => {
  try {
    const db = req.app.db["delivery-company"];
    const { id } = req.params;
    const { phone, role, fullName, isActive, maxOrdersByAdmin } = req.body;
    const employee = await db.customers.findOne({ _id: getId(id) });
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }
    const updatedEmployee = {
      ...employee,
      phone,
      role,
      fullName,
      isActive: isActive === "true" || isActive === true,
      updatedAt: new Date(),
      maxOrdersByAdmin: maxOrdersByAdmin ? Number(maxOrdersByAdmin) : null,
    };
    await db.customers.updateOne({ _id: getId(id) }, { $set: updatedEmployee });
    res.status(200).json(updatedEmployee);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to update employee", error: err.message });
  }
});

router.get("/api/delivery/company/employee/:id", async (req, res) => {
  try {
    const db = req.app.db["delivery-company"];
    const { id } = req.params;
    const employee = await db.customers.findOne({ _id: getId(id) });
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }
    res.status(200).json(employee);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to fetch employee", error: err.message });
  }
});

router.delete("/api/delivery/company/employee/:id", async (req, res) => {
  try {
    const db = req.app.db["delivery-company"];
    const { id } = req.params;
    const employee = await db.customers.findOne({ _id: getId(id) });
    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }
    await db.customers.deleteOne({ _id: getId(id) });
    res.status(200).json({ message: "Employee deleted successfully" });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to delete employee", error: err.message });
  }
});

// Get areas by city
router.get("/api/delivery/areas/by-city/:cityId", async (req, res) => {
  try {
    const db = req.app.db["delivery-company"];
    const { cityId } = req.params;
    const areas = await db.areas.find({ cityId: cityId }).toArray();
    res.status(200).json(areas);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to fetch areas by city", error: err.message });
  }
});

router.post("/api/delivery/available-drivers", async (req, res) => {
  try {
    const { location, storeLocation } = req.body;
    if (
      !location ||
      typeof location.lat !== "number" ||
      typeof location.lng !== "number"
    ) {
      return res
        .status(400)
        .json({ message: "location (lat, lng) is required." });
    }

    const deliveryDB = req.app.db["delivery-company"];

    // 1. Find the area containing the location
    const area = await deliveryDB.areas.findOne({
      geometry: {
        $geoIntersects: {
          $geometry: {
            type: "Point",
            coordinates: [location.lng, location.lat],
          },
        },
      },
    });

    if (!area) {
      return res.json({
        available: false,
        reason: "No delivery area found for this location.",
      });
    }

    // 2. Find all delivery companies (stores) that support this area
    const companies = await deliveryDB.store
      .find({
        supportedAreas: { $elemMatch: { areaId: area._id } },
      })
      .toArray();

    if (!companies.length) {
      return res.json({
        available: false,
        reason: "No delivery companies support this area.",
      });
    }

    // 3. For each company, find all active drivers
    const results = await Promise.all(
      companies.map(async (company) => {
        const drivers = await deliveryDB.customers
          .find({
            role: { $in: ["driver", "admin"] },
            isActive: true,
            companyId: company._id.toString(),
          })
          .toArray();
        return {
          company,
          drivers,
        };
      })
    );

    // 4. Filter out companies with no drivers
    const companiesWithDrivers = results.filter((r) => r.drivers.length > 0);

    // Calculate distance if storeLocation is provided
    let distanceKm = undefined;
    if (
      storeLocation &&
      typeof storeLocation.lat === "number" &&
      typeof storeLocation.lng === "number"
    ) {
      // Haversine formula
      const toRad = (value) => (value * Math.PI) / 180;
      const R = 6371; // Earth radius in km
      const dLat = toRad(storeLocation.lat - location.lat);
      const dLon = toRad(storeLocation.lng - location.lng);
      const lat1 = toRad(location.lat);
      const lat2 = toRad(storeLocation.lat);
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.sin(dLon / 2) *
          Math.sin(dLon / 2) *
          Math.cos(lat1) *
          Math.cos(lat2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      distanceKm = R * c;
    }

    return res.json({
      available: companiesWithDrivers.length > 0,
      companies: companiesWithDrivers,
      area,
      ...(distanceKm !== undefined
        ? { distanceKm: Math.round(distanceKm * 10) / 10 }
        : {}),
    });
  } catch (err) {
    console.error("Error checking available drivers:", err);
    res
      .status(500)
      .json({
        message: "Failed to check available drivers",
        error: err.message,
      });
  }
});

router.post("/api/delivery/location/supported", async (req, res) => {
  try {
    const { location } = req.body;
    if (
      !location ||
      typeof location.lat !== "number" ||
      typeof location.lng !== "number"
    ) {
      return res
        .status(400)
        .json({ message: "location (lat, lng) is required." });
    }

    const deliveryDB = req.app.db["delivery-company"];

    // 1. Find the area containing the location
    const area = await deliveryDB.areas.findOne({
      geometry: {
        $geoIntersects: {
          $geometry: {
            type: "Point",
            coordinates: [location.lng, location.lat],
          },
        },
      },
    });

    if (!area) {
      return res.json({
        available: false,
        reason: "No delivery area found for this location.",
      });
    }

    return res.json({
      available: true,
      area,
    });
  } catch (err) {
    console.error("Error checking available drivers:", err);
    res
      .status(500)
      .json({
        message: "Failed to check available drivers",
        error: err.message,
      });
  }
});

// Get single order details for delivery driver
router.get("/api/delivery/order/:id", async (req, res) => {
  const appName = "delivery-company";
  const db = req.app.db[appName];
  try {
    const { id } = req.params;
    const order = await db.bookDelivery.findOne({   $or: [
      { bookId: id },
      { _id: getId(id) }
    ] });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.status(200).json(order);
  } catch (ex) {
    console.info("Error getting order details", ex);
    return res.status(400).json({ message: "Error getting order details" });
  }
});

// Get delivery driver statistics
router.post("/api/delivery/driver/stats", async (req, res) => {
  const appName = "delivery-company";
  const db = req.app.db[appName];
  try {
    const { driverId, startDate, endDate } = req.body;

    const offsetHours = getUTCOffset();
    const start = startDate
      ? moment(startDate).utcOffset(offsetHours)
      : moment().subtract(30, "days").utcOffset(offsetHours);
    const end = endDate
      ? moment(endDate).utcOffset(offsetHours)
      : moment().utcOffset(offsetHours);

    const filterBy = {
      "driver._id": driverId,
      created: { $gte: start.format(), $lte: end.format() },
    };

    // Get total orders
    const totalOrders = await db.bookDelivery.countDocuments(filterBy);

    // Get delivered orders
    const deliveredOrders = await db.bookDelivery.countDocuments({
      ...filterBy,
      status: DELIVERY_STATUS.DELIVERED,
    });

    // Get cancelled orders
    const cancelledOrders = await db.bookDelivery.countDocuments({
      ...filterBy,
      status: DELIVERY_STATUS.CANCELLED_BY_DRIVER,
    });

    // Get total earnings (assuming there's a delivery fee or commission)
    const deliveredOrdersData = await db.bookDelivery
      .find({
        ...filterBy,
        status: DELIVERY_STATUS.DELIVERED,
      })
      .toArray();

    const totalEarnings = deliveredOrdersData.reduce((sum, order) => {
      // You can customize this calculation based on your business logic
      return sum + (order.price || 0);
    }, 0);

    // Get average delivery time
    const completedOrders = await db.bookDelivery
      .find({
        ...filterBy,
        status: DELIVERY_STATUS.DELIVERED,
        deliveryTime: { $exists: true },
      })
      .toArray();

    let averageDeliveryTime = 0;
    if (completedOrders.length > 0) {
      const totalTime = completedOrders.reduce((sum, order) => {
        const created = moment(order.created);
        const delivered = moment(order.deliveryTime);
        return sum + delivered.diff(created, "minutes");
      }, 0);
      averageDeliveryTime = Math.round(totalTime / completedOrders.length);
    }

    // Get recent activity (last 7 days)
    const recentStart = moment().subtract(7, "days").utcOffset(offsetHours);
    const recentOrders = await db.bookDelivery.countDocuments({
      "driver._id": driverId,
      created: { $gte: recentStart.format() },
    });

    res.status(200).json({
      totalOrders,
      deliveredOrders,
      cancelledOrders,
      totalEarnings,
      averageDeliveryTime,
      recentOrders,
      successRate:
        totalOrders > 0 ? Math.round((deliveredOrders / totalOrders) * 100) : 0,
    });
  } catch (ex) {
    console.info("Error getting driver statistics", ex);
    return res.status(400).json({ message: "Error getting driver statistics" });
  }
});

// Get delivery driver earnings report
router.post("/api/delivery/driver/earnings", async (req, res) => {
  const appName = "delivery-company";
  const db = req.app.db[appName];
  try {
    const { driverId, startDate, endDate } = req.body;

    const offsetHours = getUTCOffset();
    const start = startDate
      ? moment(startDate).utcOffset(offsetHours)
      : moment().subtract(30, "days").utcOffset(offsetHours);
    const end = endDate
      ? moment(endDate).utcOffset(offsetHours)
      : moment().utcOffset(offsetHours);

    const deliveredOrders = await db.bookDelivery
      .find({
        "driver._id": ObjectId(driverId),
        status: DELIVERY_STATUS.DELIVERED,
        created: { $gte: start.format(), $lte: end.format() },
      })
      .toArray();

    // Group by date
    const earningsByDate = deliveredOrders.reduce((acc, order) => {
      const date = moment(order.created)
        .utcOffset(offsetHours)
        .format("YYYY-MM-DD");
      if (!acc[date]) {
        acc[date] = {
          date,
          orders: 0,
          earnings: 0,
        };
      }
      acc[date].orders += 1;
      acc[date].earnings += order.order.shippingPrice || 0;
      return acc;
    }, {});

    const earningsArray = Object.values(earningsByDate).sort((a, b) =>
      moment(a.date).diff(moment(b.date))
    );

    res.status(200).json(earningsArray);
  } catch (ex) {
    console.info("Error getting driver earnings", ex);
    return res.status(400).json({ message: "Error getting driver earnings" });
  }
});

// Update delivery driver location
router.post("/api/delivery/driver/location", async (req, res) => {
  const appName = "delivery-company";
  const db = req.app.db[appName];
  try {
    const { driverId, latitude, longitude, isOnline } = req.body;

    await db.customers.updateOne(
      { _id: getId(driverId) },
      {
        $set: {
          currentLocation: { latitude, longitude },
          isOnline: isOnline !== undefined ? isOnline : true,
          lastLocationUpdate: moment().utcOffset(getUTCOffset()).format(),
        },
      }
    );

    res.status(200).json({ message: "Location updated successfully" });
  } catch (ex) {
    console.info("Error updating driver location", ex);
    return res.status(400).json({ message: "Error updating driver location" });
  }
});

// Get nearby orders for driver
router.post("/api/delivery/driver/nearby-orders", async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  try {
    const { driverId, latitude, longitude, radius = 5000 } = req.body; // radius in meters

    const offsetHours = getUTCOffset();
    const startOfToday = moment().utcOffset(offsetHours).startOf("day");
    const endOfToday = moment().utcOffset(offsetHours).endOf("day");

    // Get pending orders
    const pendingOrders = await db.bookDelivery
      .find({
        status: DELIVERY_STATUS.WAITING_FOR_APPROVE,
        created: {
          $gte: startOfToday.format(),
          $lte: endOfToday.format(),
        },
      })
      .toArray();

    // Filter orders by distance (simple calculation - you might want to use a more sophisticated algorithm)
    const nearbyOrders = pendingOrders.filter((order) => {
      if (!order.customerLocation || !latitude || !longitude) return false;

      const distance = calculateDistance(
        latitude,
        longitude,
        order.customerLocation.latitude,
        order.customerLocation.longitude
      );

      return distance <= radius;
    });

    // Sort by distance
    nearbyOrders.sort((a, b) => {
      const distanceA = calculateDistance(
        latitude,
        longitude,
        a.customerLocation.latitude,
        a.customerLocation.longitude
      );
      const distanceB = calculateDistance(
        latitude,
        longitude,
        b.customerLocation.latitude,
        b.customerLocation.longitude
      );
      return distanceA - distanceB;
    });

    res.status(200).json(nearbyOrders);
  } catch (ex) {
    console.info("Error getting nearby orders", ex);
    return res.status(400).json({ message: "Error getting nearby orders" });
  }
});

// Helper function to calculate distance between two points
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

// Get delivery driver work schedule
router.post("/api/delivery/driver/schedule", async (req, res) => {
  const appName = "delivery-company";
  const db = req.app.db[appName];
  try {
    const { driverId, startDate, endDate } = req.body;

    const offsetHours = getUTCOffset();
    const start = startDate
      ? moment(startDate).utcOffset(offsetHours)
      : moment().startOf("week").utcOffset(offsetHours);
    const end = endDate
      ? moment(endDate).utcOffset(offsetHours)
      : moment().endOf("week").utcOffset(offsetHours);

    const orders = await db.bookDelivery
      .find({
        "driver._id": driverId,
        created: { $gte: start.format(), $lte: end.format() },
      })
      .sort({ created: 1 })
      .toArray();

    // Group by date
    const scheduleByDate = orders.reduce((acc, order) => {
      const date = moment(order.created).format("YYYY-MM-DD");
      if (!acc[date]) {
        acc[date] = {
          date,
          orders: [],
          totalOrders: 0,
          totalEarnings: 0,
        };
      }
      acc[date].orders.push(order);
      acc[date].totalOrders += 1;
      acc[date].totalEarnings += order.price || 0;
      return acc;
    }, {});

    const scheduleArray = Object.values(scheduleByDate).sort((a, b) =>
      moment(a.date).diff(moment(b.date))
    );

    res.status(200).json(scheduleArray);
  } catch (ex) {
    console.info("Error getting driver schedule", ex);
    return res.status(400).json({ message: "Error getting driver schedule" });
  }
});

// Update delivery driver availability
router.post("/api/delivery/driver/availability", async (req, res) => {
  const appName = "delivery-company";
  const db = req.app.db[appName];
  try {
    const { driverId, isAvailable, reason } = req.body;

    await db.customers.updateOne(
      { _id: getId(driverId) },
      {
        $set: {
          isAvailable: isAvailable,
          availabilityReason: reason || null,
          lastAvailabilityUpdate: moment().utcOffset(getUTCOffset()).format(),
        },
      }
    );

    res.status(200).json({ message: "Availability updated successfully" });
  } catch (ex) {
    console.info("Error updating driver availability", ex);
    return res
      .status(400)
      .json({ message: "Error updating driver availability" });
  }
});

// Get delivery driver notifications
router.post("/api/delivery/driver/notifications", async (req, res) => {
  try {
    const { driverId, limit = 20, offset = 0 } = req.body;

    const options = { limit, offset, unreadOnly: true };
    const result = await notificationService.getUserNotifications(
      driverId,
      "delivery-company",
      req,
      options
    );

    res.status(200).json(result);
  } catch (ex) {
    console.info("Error getting driver notifications", ex);
    return res
      .status(400)
      .json({ message: "Error getting driver notifications" });
  }
});

// Mark notification as read
router.post("/api/delivery/driver/notifications/read", async (req, res) => {
  try {
    const { notificationId } = req.body;

    await notificationService.markAsRead(
      notificationId,
      "delivery-company",
      req,
      "shoofi-shoofir"
    );

    res.status(200).json({ message: "Notification marked as read" });
  } catch (ex) {
    console.info("Error marking notification as read", ex);
    return res
      .status(400)
      .json({ message: "Error marking notification as read" });
  }
});

// Create notification manually (for testing/admin purposes)
router.post("/api/delivery/notifications/create", async (req, res) => {
  try {
    const {
      recipientId,
      title,
      body,
      type = "system",
      data = {},
      channels = { websocket: true, push: true, email: false, sms: false },
    } = req.body;

    if (!recipientId || !title || !body) {
      return res
        .status(400)
        .json({ message: "recipientId, title, and body are required" });
    }

    const notification = await notificationService.sendNotification({
      recipientId,
      title,
      body,
      type,
      appName: "delivery-company",
      appType: "shoofi-shoofir",
      channels,
      data,
      req,
      soundType: 'driver.wav'
    });

    res.status(201).json(notification);
  } catch (ex) {
    console.info("Error creating notification", ex);
    return res.status(400).json({ message: "Error creating notification" });
  }
});

// Get all notifications for admin (with pagination)
router.post("/api/delivery/notifications/admin", async (req, res) => {
  try {
    const { limit = 50, offset = 0, recipientId } = req.body;

    const options = { limit, offset };
    if (recipientId) {
      options.recipientId = recipientId;
    }

    const result = await notificationService.getUserNotifications(
      recipientId,
      "delivery-company",
      req,
      options
    );

    res.status(200).json(result);
  } catch (ex) {
    console.info("Error getting admin notifications", ex);
    return res
      .status(400)
      .json({ message: "Error getting admin notifications" });
  }
});

router.get("/api/delivery/admin/orders", async (req, res) => {
  const appName = "delivery-company";
  const db = req.app.db[appName];
  try {
    const {
      limit = 20,
      offset = 0,
      status,
      driverId,
      sortBy = "created",
      sortOrder = -1,
      showAll = "false",
    } = req.query;

    let filter = {};

    // By default, show only active orders (not delivered, not cancelled)
    // Active orders: WAITING_FOR_APPROVE, APPROVED, COLLECTED_FROM_RESTAURANT
    if (showAll !== "true") {
      filter.status = {
        $nin: [
          DELIVERY_STATUS.DELIVERED,
          DELIVERY_STATUS.CANCELLED_BY_DRIVER,
          DELIVERY_STATUS.CANCELLED_BY_STORE,
          DELIVERY_STATUS.CANCELLED_BY_ADMIN,
        ],
      };
    }

    // Override with specific status filter if provided
    if (status) {
      filter.status = status;
    }
    if (driverId) {
      filter["driver._id"] = driverId;
    }

    // Get alert criteria to exclude those orders from the main list
    // This ensures orders don't appear in both alerts and orders lists
    const twoMinutesAgo = moment().subtract(2, "minutes").format();
    const now = moment().format();

    // Create exclusion filter for orders that are in alerts
    // $nor excludes documents that match ANY of the conditions in the array
    const alertExclusionFilter = {
      $nor: [
        // Exclude unresponsive orders (pending for more than 2 minutes)
        {
          $and: [
            { status: DELIVERY_STATUS.WAITING_FOR_APPROVE },
            { created: { $lte: twoMinutesAgo } },
          ],
        },

        // Exclude delayed orders (past expected delivery time) - all stages
        {
          $and: [
            {
              status: {
                $nin: [
                  DELIVERY_STATUS.DELIVERED,
                  DELIVERY_STATUS.CANCELLED_BY_DRIVER,
                  DELIVERY_STATUS.CANCELLED_BY_STORE,
                  DELIVERY_STATUS.CANCELLED_BY_ADMIN,
                ],
              },
            },
            { expectedDeliveryAt: { $lte: now } },
          ],
        },
      ],
    };

    // Combine the original filter with the alert exclusion filter
    const combinedFilter = { ...filter, ...alertExclusionFilter };

    const orders = await db.bookDelivery
      .find(combinedFilter)
      .sort({ [sortBy]: parseInt(sortOrder) })
      .skip(parseInt(offset))
      .limit(parseInt(limit))
      .toArray();

    const totalCount = await db.bookDelivery.countDocuments(combinedFilter);

    // Get count of active orders for reference
    const activeOrdersCount = await db.bookDelivery.countDocuments({
      ...alertExclusionFilter,
      status: {
        $nin: [
          DELIVERY_STATUS.DELIVERED,
          DELIVERY_STATUS.CANCELLED_BY_DRIVER,
          DELIVERY_STATUS.CANCELLED_BY_STORE,
          DELIVERY_STATUS.CANCELLED_BY_ADMIN,
        ],
      },
    });

    res.status(200).json({
      orders,
      totalCount,
      activeOrdersCount,
      hasMore: parseInt(offset) + parseInt(limit) < totalCount,
      showAll: showAll === "true",
    });
  } catch (ex) {
    console.error("Error getting delivery orders for admin", ex);
    return res
      .status(500)
      .json({ message: "Error getting delivery orders for admin" });
  }
});

router.post("/api/delivery/admin/reassign", async (req, res) => {
  const appName = "delivery-company";
  const db = req.app.db[appName];
  try {
    const { orderId, bookId, newDriverId } = req.body;

    const driver = await db.customers.findOne({ _id: getId(newDriverId) });
    if (!driver) {
      return res.status(404).json({ message: "New driver not found" });
    }

    const order = await db.bookDelivery.findOne({ _id: getId(orderId) });
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    
    // Store the old driver ID before reassignment
    const oldDriverId = order.driver?._id;
    
    const company = await db.store.findOne({
      _id: getId(driver.companyId)
    });
    await db.bookDelivery.updateOne(
      { _id: getId(orderId), bookId: bookId },
      {
        $set: {
          driver: driver,
          status: DELIVERY_STATUS.APPROVED,
          company: company,
        },
      }
    );

    // Send notification to old driver (if exists)
    if (oldDriverId) {
      try {
        await notificationService.sendNotification({
          recipientId: oldDriverId,
          title: "تم إلغاء تعيين الطلب",
          body: `تم إلغاء تعيينك من الطلب: ${order.orderId} من قبل الإدارة`,
          type: "order",
          appName: "delivery-company",
          appType: "shoofi-shoofir",
          channels: { websocket: true, push: true, email: false, sms: false },
          data: {
            orderId: order._id,
            bookId: order.bookId,
            storeName: order.storeName,
            pickupTime: order.pickupTime,
            payment_method: order?.order?.payment_method,
          },
          req,
          soundType: 'driver.wav'
        });
      } catch (notificationError) {
        console.error(
          "Failed to send notification to old driver:",
          notificationError
        );
        // Don't fail the reassignment if notification fails
      }
    }

    // Send notification to new driver
    try {
      await notificationService.sendNotification({
        recipientId: newDriverId,
        title: "تم تعيين طلب جديد",
        body: `لقد تم تعيينك للطلب: ${order.orderId}`,
        type: "order",
        appName: "delivery-company",
        appType: "shoofi-shoofir",
        channels: { websocket: true, push: true, email: false, sms: false },
        data: {
          orderId: order._id,
          bookId: order.bookId,
          storeName: order.storeName,
          pickupTime: order.pickupTime,
          payment_method: order?.order?.payment_method,
        },
        req,
        soundType: 'driver.wav'
      });
    } catch (notificationError) {
      console.error(
        "Failed to send notification to new driver:",
        notificationError
      );
      // Don't fail the reassignment if notification fails
    }

    res.status(200).json({ message: "Order reassigned successfully" });
  } catch (ex) {
    console.error("Error reassigning order", ex);
    return res.status(500).json({ message: "Error reassigning order" });
  }
});

router.get("/api/delivery/admin/drivers", async (req, res) => {
  try {
    const { orderId } = req.query;

    if (!orderId) {
      const allDrivers = await req.app.db["delivery-company"].customers
        .find({ role: { $in: ["driver", "admin"] }, isActive: true })
        .toArray();
      return res.status(200).json(allDrivers);
    }

    const order = await req.app.db["delivery-company"].bookDelivery.findOne({
      _id: getId(orderId),
    });
    if (!order || !order.customerLocation || !order.customerLocation.latitude) {
      console.warn(
        `Order ${orderId} has no location, returning all available drivers.`
      );
      const allDrivers = await req.app.db["delivery-company"].customers
        .find({ role: { $in: ["driver", "admin"] }, isActive: true })
        .toArray();
      return res.status(200).json(allDrivers);
    }

    const customerLocation = {
      lat: order.customerLocation.latitude,
      lng: order.customerLocation.longitude,
    };

    const supportedDrivers = await findAllMatchingDrivers({
      appDb: req.app.db,
      location: customerLocation,
    });

    res.status(200).json(supportedDrivers);
  } catch (ex) {
    console.error("Error getting available drivers", ex);
    return res.status(500).json({ message: "Error getting available drivers" });
  }
});

router.get("/api/delivery/admin/alerts", async (req, res) => {
  const appName = "delivery-company";
  const db = req.app.db[appName];
  const offsetHours = getUTCOffset();
  try {
    const twoMinutesAgo = moment().subtract(2, "minutes").format();
    const now = moment().utcOffset(offsetHours).format();

    // Alert 1: Driver not responding
    const unresponsiveOrders = await db.bookDelivery
      .find({
        status: DELIVERY_STATUS.WAITING_FOR_APPROVE, // Pending
        created: { $lte: twoMinutesAgo },
      })
      .toArray();

    const unresponsiveAlerts = unresponsiveOrders.map((order) => ({
      ...order,
      alertType: "unresponsive_driver",
      alertMessage: `השליח לא הגיב להזמנה מעל 2 דקות.`,
    }));

    // Alert 2: Pickup time delayed (based on pickupTime field)
    const pickupDelayedOrders = await db.bookDelivery
      .find({
        status: {
          $in: [DELIVERY_STATUS.WAITING_FOR_APPROVE, DELIVERY_STATUS.APPROVED],
        }, // Only orders waiting for pickup
        pickupTime: { $exists: true, $ne: null },
      })
      .toArray();

    const pickupDelayedAlerts = pickupDelayedOrders
      .filter((order) => {
        if (!order.pickupTime || !order.created) return false;

        try {
          const created = moment(order.created);
          const expectedPickupTime = moment(created).add(
            order.pickupTime,
            "minutes"
          );
          return expectedPickupTime.isBefore(moment());
        } catch (error) {
          return false;
        }
      })
      .map((order) => {
        const created = moment(order.created);
        const expectedPickupTime = moment(created).add(
          order.pickupTime,
          "minutes"
        );

        return {
          ...order,
          alertType: "pickup_time_delayed",
          alertMessage: `עיכוב בזמן האיסוף: זמן האיסוף חלף (${expectedPickupTime.format(
            "HH:mm"
          )}). צפי הגעה ${moment(order.expectedDeliveryAt).format("HH:mm")}.`,
        };
      });

    // Alert 3: Delivery time delayed (based on expectedDeliveryAt)
    const deliveryDelayedOrders = await db.bookDelivery
      .find({
        status: {
          $nin: [
            DELIVERY_STATUS.DELIVERED,
            DELIVERY_STATUS.CANCELLED_BY_DRIVER,
            DELIVERY_STATUS.CANCELLED_BY_STORE,
            DELIVERY_STATUS.CANCELLED_BY_ADMIN,
          ],
        }, // Not delivered or cancelled
        expectedDeliveryAt: { $lte: now },
      })
      .toArray();

    const deliveryDelayedAlerts = deliveryDelayedOrders.map((order) => {
      let alertType = "delayed_order";
      let alertMessage = "";

      switch (order.status) {
        case DELIVERY_STATUS.WAITING_FOR_APPROVE:
          alertType = "delayed_approval";
          alertMessage = `עיכוב באישור: השליח לא אישר את ההזמנה. צפי איסוף ${order.pickupTime}.`;
          break;
        case DELIVERY_STATUS.APPROVED:
          alertType = "delayed_pickup";
          alertMessage = `עיכוב באישור: השליח לא אישר את ההזמנה. צפי איסוף ${order.pickupTime}.`;
          break;
        case DELIVERY_STATUS.COLLECTED_FROM_RESTAURANT:
          alertType = "delayed_delivery";
          alertMessage = `עיכוב במסירה: השליח לא מסר את ההזמנה ללקוח. צפי הגעה ${moment(
            order.expectedDeliveryAt
          ).format("HH:mm")}.`;
          break;
        default:
          alertType = "delayed_order";
          alertMessage = `עיכוב כללי: זמן המשלוח חלף. צפי הגעה ${moment(
            order.expectedDeliveryAt
          ).format("HH:mm")}.`;
      }

      return {
        ...order,
        alertType,
        alertMessage,
      };
    });

    // Combine alerts and remove duplicates
    const allAlerts = [
      ...unresponsiveAlerts,
      ...pickupDelayedAlerts,
      ...deliveryDelayedAlerts,
    ];
    const uniqueAlerts = Array.from(
      new Map(allAlerts.map((item) => [item._id.toString(), item])).values()
    );

    res.status(200).json(uniqueAlerts);
  } catch (ex) {
    console.error("Error getting delivery alerts", ex);
    return res.status(500).json({ message: "Error getting delivery alerts" });
  }
});

// Get delivery by bookId
router.get("/api/delivery/book/:bookId", async (req, res) => {
  const appName = "delivery-company";
  const db = req.app.db[appName];
  try {
    const { bookId } = req.params;
    const delivery = await db.bookDelivery.findOne({ bookId: bookId });
    if (!delivery) {
      return res.status(404).json({ message: "Delivery not found" });
    }
    res.status(200).json(delivery);
  } catch (ex) {
    console.info("Error getting delivery by bookId", ex);
    return res
      .status(400)
      .json({ message: "Error getting delivery by bookId" });
  }
});



// Get multiple deliveries by orderIds
router.post("/api/delivery/orders/batch", async (req, res) => {
  const appName = "delivery-company";
  const db = req.app.db[appName];
  try {
    const { orderIds } = req.body;
    
    if (!orderIds || !Array.isArray(orderIds)) {
      return res.status(400).json({ message: "orderIds array is required" });
    }
    
    // Find all delivery orders where bookId matches any of the orderIds
    const deliveries = await db.bookDelivery.find({ 
      bookId: { $in: orderIds } 
    }).toArray();
    
    // Create a map for easy lookup
    const deliveryMap = {};
    deliveries.forEach(delivery => {
      deliveryMap[delivery.bookId] = delivery;
    });
    
    res.status(200).json({
      deliveries: deliveryMap,
      found: deliveries.length,
      requested: orderIds.length
    });
  } catch (ex) {
    console.info("Error getting batch deliveries by orderIds", ex);
    return res
      .status(400)
      .json({ message: "Error getting batch deliveries by orderIds" });
  }
});

// Get driver details for a specific order
router.get("/api/delivery/order/:orderId/driver", async (req, res) => {
  const appName = "delivery-company";
  const db = req.app.db[appName];
  try {
    const { orderId } = req.params;
    
    // Find the delivery order
    const delivery = await db.bookDelivery.findOne({ "order._id": getId(orderId) });
    if (!delivery) {
      return res.status(404).json({ message: "Delivery order not found" });
    }

    // If no driver is assigned, return null
    if (!delivery.driver || !delivery.driver._id) {
      return res.status(200).json(null);
    }

    // Get driver details
    const driver = await db.customers.findOne({ _id: delivery.driver._id });
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    // Get driver statistics
    const stats = await db.bookDelivery.aggregate([
      {
        $match: {
          "driver._id": delivery.driver._id,
          status: "0" // Completed deliveries
        }
      },
      {
        $group: {
          _id: null,
          totalDeliveries: { $sum: 1 },
          totalEarnings: { $sum: "$order.shippingPrice" }
        }
      }
    ]).toArray();

    // Get company details if available
    let companyName = null;
    if (driver.companyId) {
      const company = await db.store.findOne({ _id: getId(driver.companyId) });
      companyName = company?.nameAR || company?.nameHE || null;
    }

    // Prepare driver details response
    const driverDetails = {
      _id: driver._id,
      fullName: driver.fullName,
      phone: driver.phone,
      email: driver.email,
      isActive: driver.isActive,
      companyId: driver.companyId,
      companyName: companyName,
      vehicleInfo: driver.vehicleInfo,
      rating: driver.rating,
      totalDeliveries: stats[0]?.totalDeliveries || 0,
      totalEarnings: stats[0]?.totalEarnings || 0,
      createdAt: driver.createdAt,
      currentLocation: driver.currentLocation,
      isOnline: driver.isOnline,
      isAvailable: driver.isAvailable,
      role: driver.role
    };

    res.status(200).json(driverDetails);
  } catch (ex) {
    console.info("Error getting driver details for order", ex);
    return res.status(400).json({ message: "Error getting driver details" });
  }
});

// Cancel delivery by store
router.post("/api/delivery/store/order/cancel", async (req, res) => {
  const appName = "delivery-company";
  const db = req.app.db[appName];
  try {
    const { orderId, reason } = req.body;

    // Update delivery status to cancelled by store
    await db.bookDelivery.updateOne(
      { _id: getId(orderId) },
      {
        $set: {
          status: DELIVERY_STATUS.CANCELLED_BY_STORE,
          cancelledAt: new Date(),
          cancelReason: reason || null,
          cancelledBy: "store",
        },
      }
    );

    // Get the updated delivery order
    const deliveryOrder = await db.bookDelivery.findOne({
      _id: getId(orderId),
    });

    // Send notification to customer about delivery cancellation by store
    const customerId = deliveryOrder?.order?.customerId;
    if (deliveryOrder && customerId) {
      try {
        // Create a mock request object for the notification service
        const mockReq = {
          app: {
            db: req.app.db,
          },
          headers: {
            "app-type": "shoofi-app",
          },
        };

        await notificationService.sendNotification({
          recipientId: customerId,
          title: "تم إلغاء التوصيل من قبل المطعم",
          body: `تم إلغاء توصيل طلبك رقم #${deliveryOrder.bookId} من قبل المطعم. يرجى التواصل معنا للمزيد من المعلومات.`,
          type: "delivery_cancelled_store",
          appName: deliveryOrder.appName || "shoofi-app",
          appType: "shoofi-app",
          channels: { websocket: true, push: true, email: false, sms: false },
          data: {
            orderId: deliveryOrder._id,
            bookId: deliveryOrder.bookId,
            deliveryStatus: DELIVERY_STATUS.CANCELLED_BY_STORE,
            cancelReason: reason,
            cancelledBy: "store",
          },
          req: mockReq,
          soundType: 'customer.wav'
        });
      } catch (notificationError) {
        console.error(
          "Failed to send customer notification for store cancellation:",
          notificationError
        );
        // Don't fail the delivery update if notification fails
      }
    }

    res.status(200).json({ message: "Delivery cancelled by store" });
  } catch (ex) {
    console.info("Error cancelling delivery by store", ex);
    return res
      .status(400)
      .json({ message: "Error cancelling delivery by store" });
  }
});

// Cancel delivery by admin
router.post("/api/delivery/admin/order/cancel", async (req, res) => {
  const appName = "delivery-company";
  const db = req.app.db[appName];
  try {
    const { orderId, reason } = req.body;

    // Update delivery status to cancelled by admin
    await db.bookDelivery.updateOne(
      { _id: getId(orderId) },
      {
        $set: {
          status: DELIVERY_STATUS.CANCELLED_BY_ADMIN,
          cancelledAt: new Date(),
          cancelReason: reason || null,
          cancelledBy: "admin",
        },
      }
    );

    // Get the updated delivery order
    const deliveryOrder = await db.bookDelivery.findOne({
      _id: getId(orderId),
    });

    // Send notification to customer about delivery cancellation by admin
    const customerId = deliveryOrder?.order?.customerId;
    if (deliveryOrder && customerId) {
      try {
        // Create a mock request object for the notification service
        const mockReq = {
          app: {
            db: req.app.db,
          },
          headers: {
            "app-type": "shoofi-app",
          },
        };

        await notificationService.sendNotification({
          recipientId: customerId,
          title: "تم إلغاء التوصيل من قبل الإدارة",
          body: `تم إلغاء توصيل طلبك من قبل الإدارة. يرجى التواصل معنا للمزيد من المعلومات.`,
          type: "delivery_cancelled_admin",
          appName: deliveryOrder.appName || "shoofi-app",
          appType: "shoofi-app",
          channels: { websocket: true, push: true, email: false, sms: false },
          data: {
            orderId: deliveryOrder._id,
            bookId: deliveryOrder.bookId,
            deliveryStatus: DELIVERY_STATUS.CANCELLED_BY_ADMIN,
            cancelReason: reason,
            cancelledBy: "admin",
          },
          req: mockReq,
          soundType: 'customer.wav'
        });
      } catch (notificationError) {
        console.error(
          "Failed to send customer notification for admin cancellation:",
          notificationError
        );
        // Don't fail the delivery update if notification fails
      }
    }

    res.status(200).json({ message: "Delivery cancelled by admin" });
  } catch (ex) {
    console.info("Error cancelling delivery by admin", ex);
    return res
      .status(400)
      .json({ message: "Error cancelling delivery by admin" });
  }
});

// General delivery status update endpoint
router.post("/api/delivery/order/status/update", async (req, res) => {
  const appName = "delivery-company";
  const db = req.app.db[appName];

  try {
    const { orderId, status, reason, updatedBy } = req.body;

    // Validate status
    const validStatuses = [
      DELIVERY_STATUS.WAITING_FOR_APPROVE,
      DELIVERY_STATUS.APPROVED,
      DELIVERY_STATUS.COLLECTED_FROM_RESTAURANT,
      DELIVERY_STATUS.DELIVERED,
      DELIVERY_STATUS.CANCELLED_BY_DRIVER,
      DELIVERY_STATUS.CANCELLED_BY_STORE,
      DELIVERY_STATUS.CANCELLED_BY_ADMIN,
    ];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid delivery status" });
    }

    // Get current delivery state
    const currentDelivery = await db.bookDelivery.findOne({
      _id: getId(orderId),
    });
    const oldStatus = currentDelivery?.status;

    // Update delivery status
    const updateData = { status, updatedAt: new Date() };
    if (reason) updateData.cancelReason = reason;
    if (updatedBy) updateData.updatedBy = updatedBy;

    // Add specific timestamps based on status
    switch (status) {
      case DELIVERY_STATUS.APPROVED:
        updateData.approvedAt = new Date();
        break;
      case DELIVERY_STATUS.COLLECTED_FROM_RESTAURANT:
        updateData.startedAt = new Date();
        break;
      case DELIVERY_STATUS.DELIVERED:
        updateData.completedAt = new Date();
        break;
      case DELIVERY_STATUS.CANCELLED_BY_DRIVER:
      case DELIVERY_STATUS.CANCELLED_BY_STORE:
      case DELIVERY_STATUS.CANCELLED_BY_ADMIN:
        updateData.cancelledAt = new Date();
        break;
    }

    await db.bookDelivery.updateOne(
      { _id: getId(orderId) },
      { $set: updateData }
    );

    const deliveryOrder = await db.bookDelivery.findOne({
      _id: getId(orderId),
    });

    // Track delivery status change centrally
    await centralizedFlowMonitor.trackOrderFlowEvent({
      orderId: deliveryOrder._id,
      orderNumber: deliveryOrder.bookId,
      sourceApp: "delivery-company",
      eventType: "delivery_status_change",
      status: status,
      actor: updatedBy || "System",
      actorId: updatedBy || "system",
      actorType: "driver",
      metadata: {
        previousStatus: oldStatus,
        statusChange: `${oldStatus} → ${status}`,
        reason: reason,
        driverId: deliveryOrder.driver?._id,
        driverName: deliveryOrder.driver?.name,
      },
    });

    // Send notification to customer about delivery status update
    const customerId = deliveryOrder?.order?.customerId;
    if (deliveryOrder && customerId) {
      try {
        // Create a mock request object for the notification service
        const mockReq = {
          app: {
            db: req.app.db,
          },
          headers: {
            "app-type": "shoofi-app",
          },
        };

        // Determine notification content based on status
        let notificationTitle = "";
        let notificationBody = "";
        let notificationType = "delivery_status_update";

        switch (status) {
          case DELIVERY_STATUS.WAITING_FOR_APPROVE:
            notificationTitle = "في انتظار تأكيد التوصيل";
            notificationBody = `طلبك في انتظار تأكيد التوصيل من قبل السائق.`;
            break;
          case DELIVERY_STATUS.APPROVED:
            notificationTitle = "تم تأكيد التوصيل";
            notificationBody = `تم تأكيد توصيل طلبك من قبل السائق.`;
            notificationType = "delivery_approved";
            break;
          case DELIVERY_STATUS.COLLECTED_FROM_RESTAURANT:
            notificationTitle = "تم استلام طلبك";
            notificationBody = `تم استلام طلبك من المطعم وهو في الطريق إليك.`;
            notificationType = "delivery_collected";
            break;
          case DELIVERY_STATUS.DELIVERED:
            notificationTitle = "تم تسليم طلبك";
            notificationBody = `تم تسليم طلبك بنجاح. نتمنى لك وجبة شهية!`;
            notificationType = "delivery_completed";
            break;
          case DELIVERY_STATUS.CANCELLED_BY_DRIVER:
            notificationTitle = "تم إلغاء التوصيل من قبل السائق";
            notificationBody = `تم إلغاء توصيل طلبك من قبل السائق. سيتم تعيين سائق جديد.`;
            notificationType = "delivery_cancelled_driver";
            break;
          case DELIVERY_STATUS.CANCELLED_BY_STORE:
            notificationTitle = "تم إلغاء التوصيل من قبل المطعم";
            notificationBody = `تم إلغاء توصيل طلبك من قبل المطعم. يرجى التواصل معنا للمزيد من المعلومات.`;
            notificationType = "delivery_cancelled_store";
            break;
          case DELIVERY_STATUS.CANCELLED_BY_ADMIN:
            notificationTitle = "تم إلغاء التوصيل من قبل الإدارة";
            notificationBody = `تم إلغاء توصيل طلبك رقم من قبل الإدارة. يرجى التواصل معنا للمزيد من المعلومات.`;
            notificationType = "delivery_cancelled_admin";
            break;
          default:
            notificationTitle = "تحديث حالة التوصيل";
            notificationBody = `تم تحديث حالة توصيل طلبك.`;
        }

        if (notificationTitle && notificationBody) {
          await notificationService.sendNotification({
            recipientId: customerId,
            title: notificationTitle,
            body: notificationBody,
            type: notificationType,
            appName: deliveryOrder.appName || "shoofi-app",
            appType: "shoofi-app",
            channels: { websocket: true, push: true, email: false, sms: false },
            data: {
              orderId: deliveryOrder._id,
              bookId: deliveryOrder.bookId,
              deliveryStatus: status,
              cancelReason: reason,
              updatedBy: updatedBy,
              driverName: deliveryOrder.driver?.name || "السائق",
            },
            req: mockReq,
            soundType: 'customer.wav'
          });
        }
      } catch (notificationError) {
        console.error(
          "Failed to send customer notification for delivery status update:",
          notificationError
        );
        // Don't fail the delivery update if notification fails
      }
    }

    res.status(200).json({ message: "Delivery status updated successfully" });
  } catch (ex) {
    console.info("Error updating delivery status", ex);
    return res.status(400).json({ message: "Error updating delivery status" });
  }
});

module.exports = router;
