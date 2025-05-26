const momentTZ = require("moment-timezone");
const moment = require("moment");
const { getId } = require("../../lib/common");
const smsService = require("../sms");
const websockets = require("../websockets");

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

async function updateExpiredOrders(appDb) {
  try {
    const appName = "pizza-gmel";
    const db = appDb[appName];

    const offsetHours = getUTCOffset();
    const currentDate = moment().utcOffset(offsetHours);




    // DELIVERY START
    const resultDelivery = await db.orders.find(
      {
        orderDate: { $lt: currentDate.format() },
        status: "1",
        isViewd: true,
        "order.receipt_method": "DELIVERY",
      },
    ).toArray();
    console.log(
      `Matched Delivery ${resultDelivery.matchedCount} documents and updated ${resultDelivery.modifiedCount} documents`
    );


    for (const order of resultDelivery) {
      await db.orders.updateOne(
        { _id: order._id },
        { $set: { status: "3" } }
      );
      // const customer = await db.customers.findOne({
      //   _id: getId(order.customerId),
      // });

      // let smsContent = "";
      // const storeData = await db.store.findOne({ id: 1 });
      // smsContent = smsService.getOrderDeliveryReadyContent(
      //   customer.fullName,
      //   order.orderId,
      //   order.app_language,
      //   storeData.order_company_number
      // );
      // await smsService.sendSMS(customer.phone, smsContent, req);
      // await smsService.sendSMS("0542454362", smsContent, req);
    }

    if (resultDelivery.matchedCount) {
      const customerId = order.customerId;
      websockets.fireWebscoketEvent({type: "orders updated by cron", customerIds:[customerId], isAdmin: true, appName});
    }

    // DELIVERY END

        // TAKEAWAY START
        const resultTakeAway = await db.orders
        .find(
          {
            orderDate: { $lt: currentDate.format() },
            status: "1",
            isViewd: true,
            "order.receipt_method": "TAKEAWAY",
          },
          { $set: { status: "2" } }
        )
        .toArray();
      console.log(
        `Matched Takeaway ${resultTakeAway} documents and updated ${resultTakeAway} documents`
      );
      for (const order of resultTakeAway) {
        await db.orders.updateOne(
          { _id: order._id },
          { $set: { status: "2" } }
        );
        const customer = await db.customers.findOne({
          _id: getId(order.customerId),
        });
  
        let smsContent = "";
        smsContent = smsService.getOrderTakeawayReadyContent(
          customer.fullName,
          order.orderId,
          order.app_language
        );
        const customerId = order.customerId;

        websockets.fireWebscoketEvent({type: "orders updated by cron", customerIds:[customerId], isAdmin: true, appName});

        await smsService.sendSMS(customer.phone, smsContent, null, appDb, 'pizza-gmel');
        await smsService.sendSMS("0542454362", smsContent, null, appDb, 'pizza-gmel');
      }
      // TAKEAWAY END






    if (resultTakeAway.length || resultDelivery.length) {
      websockets.fireWebscoketEvent({type: "orders updated by cron", isAdmin: true, appName});

    }
  } catch (err) {
    console.error("Error cron updating orders:", err);
  }
}

async function checkOrderStatusZeroCC(appDb) {
  try {
    
    const appName = "pizza-gmel";
    const db = appDb[appName];
    const resultZeroStatusCC = await db.orders
      .find(
        {
          status: "0",
          isViewd: false,
          "order.payment_method": "CREDITCARD",
          ccPaymentRefData: { $exists: false } 
          },
        ).toArray();

      console.log(
        `Matched Takeaway ${resultZeroStatusCC?.length} documents and updated ${resultZeroStatusCC?.length} documents`
      );

      for (const order of resultZeroStatusCC) {
        let isShippingPaid = false;
        if(order.order.receipt_method === 'DELIVERY'){
          isShippingPaid = true;
        }
        await db.orders.updateOne(
          { _id: order._id },
          { $set: { status: "1", "ccPaymentRefData.data":{note:"edited manually", StatusCode: "1"}, isShippingPaid } }
        );
        await db.customers.findOne({
          _id: getId(order.customerId),
        });
        let smsContent = "CC order updated manually" + "-" + order?._id;
        await smsService.sendSMS("0542454362", smsContent, null, appDb, 'pizza-gmel');
      }
      if (resultZeroStatusCC.length) {
        websockets.fireWebscoketEvent({type: "orders updated by cron", isAdmin, appName});
      }
  } catch (err) {
    console.error("Error cron updating orders:", err);
  }
}

async function checkDeliveryDelay(appDb) {
  const appName = "pizza-gmel";
  const db = appDb[appName]
  const offsetHours = getUTCOffset();
  const currentDatePlusDelay = moment().utcOffset(offsetHours).subtract(5, 'minutes');

  // DELIVERY START
  const resultDelivery = await db.orders.find(
    {
      orderDate: { $lt: currentDatePlusDelay.format() },
      status: "3",
      isViewd: true,
      "order.receipt_method": "DELIVERY",
    },
  ).toArray();
  console.log(
    `Matched Delivery ${resultDelivery.matchedCount} delay documents`
  );

  if (resultDelivery?.length) {
    websockets.fireWebscoketEvent({type: "delivery delay", isAdmin: true, appName});
  }
}

const cronOrdersService = {
  updateExpiredOrders: updateExpiredOrders,
  checkDeliveryDelay: checkDeliveryDelay,
  checkOrderStatusZeroCC: checkOrderStatusZeroCC
};
module.exports = cronOrdersService;
