const express = require("express");
const moment = require("moment");
const router = express.Router();
const momentTZ = require("moment-timezone");
const { getId } = require("../lib/common");
const pushNotificationWebService = require("../utils/push-notification/push-web");

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

module.exports = router;
