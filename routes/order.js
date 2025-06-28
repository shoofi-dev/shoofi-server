const express = require("express");
const auth = require("./auth");
const orderid = require("order-id")("key");
const websockets = require("../utils/websockets");
const smsService = require("../utils/sms");
const storeService = require("../utils/store-service");
const pushNotification = require("../utils/push-notification");
const invoiceMailService = require("../utils/invoice-mail");
const imagesService = require("../utils/images-service");
var multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });
const turl = require("turl");
var QRCode = require("qrcode");
const axios = require("axios");
const momentTZ = require("moment-timezone");
const { getCustomerAppName } = require("../utils/app-name-helper");

const { clearSessionValue, getId } = require("../lib/common");
const { paginateData } = require("../lib/paginate");
const { restrict, checkAccess } = require("../lib/auth");
const { indexOrders } = require("../lib/indexing");
const moment = require("moment");
const router = express.Router();
const deliveryService = require("../services/delivery/book-delivery");

// Helper function to process credit card payment
const processCreditCardPayment = async (paymentData, orderDoc, req) => {
  const shoofiDB = req.app.db["shoofi"];
  const shoofiStoreData = await shoofiDB.store.findOne({ id: 1 });

  if (!shoofiStoreData?.credentials) {
    throw new Error("Payment credentials not configured");
  }

  const zdCreditCredentials = shoofiStoreData.credentials;

  // Prepare payment payload
  const paymentPayload = {
    TerminalNumber: zdCreditCredentials.credentials_terminal_number,
    Password: zdCreditCredentials.credentials_password,
    CardNumber: paymentData.ccToken,
    TransactionSum: orderDoc.total,
    ExtraData: orderDoc.orderId?.toString(),
    HolderID: paymentData.id?.toString(),
    CVV: paymentData.cvv,
    PhoneNumber: paymentData.phone,
    CustomerEmail: paymentData.email || "shoofi.dev@gmail.com",
    ZCreditInvoiceReceipt: {
      Type: "0",
      RecepientName: `${paymentData.userName} - ${paymentData.phone}`,
      RecepientCompanyID: "",
      Address: "",
      City: "",
      ZipCode: "",
      PhoneNum: paymentData.phone,
      FaxNum: "",
      TaxRate: "17",
      Comment: "",
      ReceipientEmail: "invoices@shoofi.app",
      EmailDocumentToReceipient: true,
      ReturnDocumentInResponse: "",
      Items: [{
        ItemDescription: `מוצר - ${orderDoc.orderId?.toString()}`,
        ItemQuantity: "1",
        ItemPrice: orderDoc.total?.toString(),
        IsTaxFree: "false"
      }]
    }
  };

  try {
    const response = await axios.post(
      "https://pci.zcredit.co.il/ZCreditWS/api/Transaction/CommitFullTransaction",
      paymentPayload
    );

    const paymentResult = response.data;

    if (paymentResult.HasError) {
      return {
        success: false,
        error: paymentResult.ReturnMessage || "Payment failed",
        paymentData: {
          payload: paymentPayload,
          data: paymentResult,
          status: "failed",
        },
      };
    }

    return {
      success: true,
      paymentData: {
        payload: paymentPayload,
        data: paymentResult,
        ReferenceNumber: paymentResult.ReferenceNumber,
        ZCreditInvoiceReceiptResponse:
          paymentResult.ZCreditInvoiceReceiptResponse,
        ZCreditChargeResponse: paymentResult,
        status: "success",
      },
    };
  } catch (error) {
    console.error("Payment processing error:", error);
    return {
      success: false,
      error: error.message || "Payment processing failed",
      paymentData: {
        payload: paymentPayload,
        error: error.message,
        status: "error",
      },
    };
  }
};

// Helper function to send order notifications
const sendOrderNotifications = async (orderDoc, req, appName) => {
  const customerDB = getCustomerAppName(req, appName);
  const customer = await customerDB.customers.findOne({
    _id: getId(orderDoc.customerId),
  });

  if (!customer) {
    console.error("Customer not found for notifications");
    return;
  }

  const smsContent = smsService.getOrderRecivedContent(
    customer.fullName,
    orderDoc.total,
    orderDoc.order.receipt_method,
    orderDoc.orderId,
    orderDoc.app_language
  );

  await smsService.sendSMS(customer.phone, smsContent, req);
  await smsService.sendSMS("0542454362", smsContent, req);

  websockets.fireWebscoketEvent({
    type: "new order",
    customerIds: [orderDoc.customerId],
    isAdmin: true,
    appName,
  });
};

const generateQR = async (latitude, longitude) => {
  try {
    const qrCodeURI = await QRCode.toDataURL(
      `https://www.waze.com/ul?ll=${latitude},${longitude}&navigate=yes&zoom=17`
    );
    return qrCodeURI;
  } catch (err) {
    console.error(err);
  }
};

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

// Show orders
router.post(
  "/api/order/admin/orders/:page?",

  async (req, res, next) => {
    const appName = req.headers["app-name"];
    const db = req.app.db[appName];
    let finalOrders = [];

    let pageNum = 1;
    if (req.body.pageNumber) {
      pageNum = req.body.pageNumber;
    }

    let statusList = ["1", "2", "3", "4", "5","6"];
    if (req.body.statusList) {
      statusList = req.body.statusList;
    }
    let ordersDate = null;
    if (req.body.ordersDate) {
      ordersDate = req.body.ordersDate;
    }
    let filterBy = {
      status: { $in: statusList },
    };
    const offsetHours = getUTCOffset();
    let statusCount = [];
    if (ordersDate) {
      var start = moment(ordersDate).utcOffset(offsetHours);
      start.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });

      var end = moment(ordersDate).utcOffset(offsetHours);
      end.set({ hour: 23, minute: 59, second: 59, millisecond: 999 });
      // filterBy["$or"] = [
      //   { orderDate: { $gte: start.format(), $lt: end.format() } },
      //   { datetime: { $gte: start.format(), $lt: end.format() } },
      // ];
      if (req.body.isOrderLaterSupport) {
        filterBy = {
          ...filterBy,
          orderDate: { $gte: start.format(), $lt: end.format() },
        };
      } else {
        filterBy = {
          ...filterBy,
          datetime: { $gte: start.format(), $lt: end.format() },
        };
      }

      if (req.body.isOrderLaterSupport) {
        statusCount = await db.orders
          .aggregate([
            {
              $match: {
                orderDate: {
                  $gte: start.format(),
                  $lt: end.format(),
                },
                isViewd: true,
              },
            },
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
              },
            },
          ])
          .toArray();
      } else {
        statusCount = await db.orders
          .aggregate([
            {
              $match: {
                datetime: {
                  $gte: start.format(),
                  $lt: end.format(),
                },
                isViewd: true,
              },
            },
            {
              $group: {
                _id: "$status",
                count: { $sum: 1 },
              },
            },
          ])
          .toArray();
      }
    }
    if (req.body.isNotPrinted) {
      filterBy.isPrinted = false;
    }

    if (!req.body.isViewd) {
      filterBy.isViewd = true;
    }

    if (req.body.isNotViewd) {
      filterBy.isViewd = true;
    }

    let oderDirecton = 1;
    if (req.body.oderDirecton != undefined) {
      oderDirecton = req.body.oderDirecton;
    }
    // Get our paginated data
    const orders = await paginateData(true, req, pageNum, "orders", filterBy, {
      orderDate: oderDirecton,
    });
    // orders?.data?.forEach(async (order)=>{
    for (const order of orders?.data) {
      const customerDB = getCustomerAppName(req, appName);
      const customer = await customerDB.customers.findOne({
        _id: getId(order.customerId),
      });
      // const dataUri = await textToImage.generate(customer.fullName, {
      //   maxWidth: 200,
      //   textAlign: "center",
      // });
      finalOrders.push({
        ...order,
        customerDetails: {
          name: customer?.fullName || order?.name,
          phone: customer?.phone || order?.phone,
          branchId: order?.branchId,
          // recipetName: dataUri,
        },
      });
    }
    // If API request, return json
    // if(req.apiAuthenticated){
    res
      .status(200)
      .json({
        ordersList: finalOrders,
        totalItems: orders?.totalItems,
        statusCount,
      });
    // }
  }
);

router.get("/api/order/admin/not-printed", async (req, res, next) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  let finalOrders = [];

  finalOrders = await db.orders
    .find({
      isPrinted: false,
    })
    .toArray();

  res.status(200).json(finalOrders);
});

router.get("/api/order/admin/not-viewd", async (req, res, next) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];

  const orders = await db.orders
    .find({
      isViewd: false,
      status: "1",
    })
    .toArray();
  const finalOrders = [];
  for (const order of orders) {
    const customerDB = getCustomerAppName(req, appName);
    const customer = await customerDB.customers.findOne({
      _id: getId(order.customerId),
    });
    if (customer) {
      finalOrders.push({
        ...order,
        customerDetails: {
          name: customer.fullName,
          phone: customer.phone,
        },
      });
    }
  }

  res.status(200).json(finalOrders);
});

router.get("/api/order/admin/all/not-viewd", async (req, res, next) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];

  const orders = await db.orders
    .find({
      isViewdAdminAll: false,
      status: "6",
    })
    .toArray();
  const finalOrders = [];
  for (const order of orders) {
    const customerDB = getCustomerAppName(req, appName);
    const customer = await customerDB.customers.findOne({
      _id: getId(order.customerId),
    });
    finalOrders.push({
      ...order,
      customerDetails: {
        name: customer?.fullName || order?.name,
        phone: customer?.phone || order?.phone,
        branchId: order?.branchId,
      },
    });
  }

  res.status(200).json(finalOrders);
});

router.get(
  "/api/order/customer-invoices",
  auth.required,
  async (req, res, next) => {
    const appName = req.headers["app-name"];
    const db = req.app.db[appName];
    const customerId = req.auth.id;

    const orders = await db.orders
      .find({
        customerId: customerId,
        "order.payment_method": "CREDITCARD",
      })
      .toArray();
    res.status(200).json(orders);
  }
);

// router.get(
//   "/api/order/customer-orders",
//   auth.required,
//   async (req, res, next) => {
//     const appName = req.headers['app-name'];
//     const db = req.app.db[appName];
//     const customerId = req.auth.id;
//     const offsetHours = getUTCOffset();
//     var start = moment(new Date()).subtract(1, "days").utcOffset(offsetHours);
//     start.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });

//     var end = moment(new Date()).add(1, "days").utcOffset(offsetHours);
//     end.set({ hour: 23, minute: 59, second: 59, millisecond: 999 });

//     const orders = await paginateData(
//       true,
//       req,
//       1,
//       "orders",
//       {
//         customerId,
//         orderDate: { $gte: start.format(), $lt: end.format() },
//       },
//       { created: -1 }
//     );
//     res.status(200).json(orders.data);
//   }
// );

router.get("/api/order/customer-orders", auth.required, async (req, res) => {
  const customerId = req.auth.id;
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const customerDB = getCustomerAppName(req, appName);

  try {
    const customer = await customerDB.customers.findOne({
      _id: getId(customerId),
    });
    if (!customer) {
      res.status(400).json({
        message: "Customer not found",
      });
      return;
    }

    if (!customer.orders || !customer.orders.length) {
      res.status(200).json([]);
      return;
    }

    // Group orders by their database
    const ordersByAppName = {};
    customer.orders.forEach((order) => {
      const appNameTmp = order.appName || appName; // Use the order's db if specified, otherwise use current app
      if (!ordersByAppName[appNameTmp]) {
        ordersByAppName[appNameTmp] = [];
      }
      ordersByAppName[appNameTmp].push(order.appName ? order.orderId : order);
    });

    const offsetHours = getUTCOffset();
    var start = moment(new Date()).subtract(1, "days").utcOffset(offsetHours);
    start.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });

    var end = moment(new Date()).add(1, "days").utcOffset(offsetHours);
    end.set({ hour: 23, minute: 59, second: 59, millisecond: 999 });

    // Fetch orders from each database
    const allOrders = [];
    for (const [dbName, orderIds] of Object.entries(ordersByAppName)) {
      const currentDb = req.app.db[dbName];
      const oids = orderIds.map((id) => getId(id));

      const orders = await paginateData(
        true,
        req,
        1,
        "orders",
        {
          _id: { $in: oids },
          orderDate: { $gte: start.format(), $lt: end.format() },
        },
        { created: -1 },
        currentDb // Pass the current database to paginateData
      );

      allOrders.push(...orders.data);
    }

    // Sort all orders by creation date
    allOrders.sort((a, b) => new Date(b.created) - new Date(a.created));

    res.status(200).json(allOrders);
  } catch (ex) {
    console.error(`Failed get customer orders: ${ex}`);
    res.status(400).json({ message: "Failed to get customer orders" });
  }
});

router.post("/api/order/byDate", async (req, res, next) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  let finalOrders = [];

  finalOrders = await db.orders
    .find({
      created: {
        $gte: new Date(req.body.startDate),
        $lt: new Date(req.body.endDate),
      },
    })
    .toArray();

  res.status(200).json(finalOrders);
});

router.post("/api/order/addRefund", async (req, res, next) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const parsedBodey = req.body;

  try {
    await db.orders.updateOne(
      {
        _id: getId(parsedBodey.orderId),
      },
      {
        $push: {
          refundData: parsedBodey.refundObj,
        },
      },
      { multi: false }
    );
    res.status(200).json({ msg: "refund added" });
  } catch (err) {
    res.status(400).json({ errorMessage: "refund  failed" });
  }
});

router.post("/api/order/updateCCPayment", async (req, res, next) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const shoofiDB = req.app.db["shoofi"];
  const parsedBodey = req.body;

  try {
    const shoofiStoreData = await shoofiDB.store.findOne({ id: 1 });
    const orderDoc = await db.orders.findOne({
      _id: getId(parsedBodey.orderId),
    });
    const customerId = orderDoc.customerId;
    const customerDB = getCustomerAppName(req, appName);
    const customer = await customerDB.customers.findOne({
      _id: getId(customerId),
    });
    if (!customer) {
      res.status(400).json({
        message: "Customer not found",
      });
      return;
    }

    const zdCreditCredentials = shoofiStoreData.credentials;

    const data = {
      TerminalNumber: zdCreditCredentials.credentials_terminal_number,
      Password: zdCreditCredentials.credentials_password,
      ReferenceID: parsedBodey.creditcard_ReferenceNumber,
      ZCreditChargeResponse: parsedBodey.ZCreditChargeResponse,
    };
    const docId = parsedBodey?.ZCreditInvoiceReceiptResponse?.DocumentID;
    // if (docId) {
    axios
      .post(
        "https://pci.zcredit.co.il/ZCreditWS/api/Transaction/GetTransactionStatusByReferenceId",
        data,
        { responseType: "application/json" }
      )
      .then(async (response) => {
        if (response.data.HasError) {
          // await db.orders.deleteOne({ _id: parsedBodey.orderId });
          await db.orders.updateOne(
            {
              _id: getId(parsedBodey.orderId),
            },
            {
              $set: {
                ccPaymentRefData: {
                  payload: parsedBodey,
                  data: response.data,
                },
                status: "0",
              },
            },
            { multi: false }
          );
          res.status(200).json(response.data);
          return;
        }

        let updateData = {
          ccPaymentRefData: {
            payload: parsedBodey,
            data: response.data,
          },
          status: "1",
        };
        if (orderDoc.order.receipt_method === "DELIVERY") {
          updateData.isShippingPaid = true;
        }
        await db.orders.updateOne(
          {
            _id: getId(parsedBodey.orderId),
          },
          {
            $set: updateData,
          },
          { multi: false }
        );

        const finalOrderDoc = {
          ...orderDoc,
          customerDetails: {
            name: customer.fullName,
            phone: customer.phone,
          },
        };
        websockets.fireWebscoketEvent({
          type: "new order",
          customerIds: [customerId],
          isAdmin: true,
          appName,
        });

        const smsContent = smsService.getOrderRecivedContent(
          customer.fullName,
          orderDoc.total,
          orderDoc.order.receipt_method,
          orderDoc.orderId,
          orderDoc.app_language
        );
        await smsService.sendSMS(customer.phone, smsContent, req);
        await smsService.sendSMS("0542454362", smsContent, req);

        // Send notifications for successful payment
        await sendOrderNotifications(orderDoc, req, appName);
        
        // Invoice mail handling - wrapped in try-catch to continue order processing even if invoice fails
        try {
          const docId = response.data.ZCreditInvoiceReceiptResponse?.DocumentID;
          if (docId) {
            try {
              await invoiceMailService.saveInvoice(docId, req);
              
              // Only attempt URL shortening if invoice save was successful
              try {
                const shortenedUrl = await turl.shorten(
                  `https://shoofi-spaces.fra1.cdn.digitaloceanspaces.com/invoices/doc-${docId}.pdf`
                );
                
                // Update order with shortened URL - non-critical update
                try {
                  await db.orders.updateOne(
                    { _id: getId(orderDoc._id) },
                    {
                      $set: {
                        "ccPaymentRefData.url": shortenedUrl
                      },
                    },
                    { multi: false }
                  );
                } catch (urlUpdateError) {
                  console.error("Failed to update order with invoice URL:", urlUpdateError);
                }
              } catch (urlError) {
                console.error("Failed to shorten invoice URL:", urlError);
              }
            } catch (saveError) {
              console.error("Failed to save invoice:", saveError);
            }
          } else {
            console.error("No document ID in invoice response:", response.data.ZCreditInvoiceReceiptResponse);
          }
        } catch (invoiceError) {
          console.error("Invoice processing error:", invoiceError);
        }

        res.status(200).json({ errorMessage: "valid invoice doc" });
        // } else {
        //   await db.orders.updateOne(
        //     {
        //       _id: getId(parsedBodey.orderId),
        //     },
        //     {
        //       $set: {
        //         ccPaymentRefData: {
        //           payload: parsedBodey,
        //           data: 'no doc ID',
        //         },
        //         status: "0",
        //       },
        //     },
        //     { multi: false }
        //   );
        //   res.status(200).json({ errorMessage: "no invoice doc" });
        // }
      });
    // }, 120000);
    res.status(200).json({ errorMessage: "valid invoice doc" });
    // } catch (err) {
    //   res.status(400).json({ errorMessage: err?.message });
    // }
  } catch (err) {
    res.status(400).json({ errorMessage: err?.message });
  }
});

router.post(
  "/api/order/create",
  upload.array("img"),
  auth.required,
  async (req, res, next) => {
    const appName = req.headers["app-name"];
    const db = req.app.db[appName];
    const config = req.app.config;
    const parsedBodey = JSON.parse(req.body.body);
    const customerId = parsedBodey.customerId || req.auth.id;
    const isCreditCardPay = parsedBodey.order.payment_method == "CREDITCARD";

    const generatedOrderId = orderid.generate();
    let imagesList = [];
    if (req.files && req.files.length > 0) {
      imagesList = await imagesService.uploadImage(req.files, req, "orders");
    }
    let imageIndex = 0;
    let updatedItemsWithImages = [];
    if (imagesList?.length > 0) {
      updatedItemsWithImages = parsedBodey.order.items.map((item) => {
        if (item.clienImage) {
          imageIndex++;
          return {
            ...item,
            clienImage: imagesList[imageIndex - 1],
          };
        }
        return {
          ...item,
          clienImage: null,
        };
      });
    }
    let locationQrCode = null;
    if (parsedBodey.order.receipt_method == "DELIVERY") {
      locationQrCode = await generateQR(
        parsedBodey?.order?.geo_positioning?.latitude,
        parsedBodey?.order?.geo_positioning?.longitude
      );
    }
    const offsetHours = getUTCOffset();

    const orderDoc = {
      ...parsedBodey,
      order: {
        ...parsedBodey.order,
        items:
          updatedItemsWithImages?.length > 0
            ? updatedItemsWithImages
            : parsedBodey.order.items,
        geo_positioning: {
          ...parsedBodey.order.geo_positioning,
          qrURI: locationQrCode,
        },
      },
      created: moment(new Date()).utcOffset(offsetHours).format(),
      customerId,
      orderId: generatedOrderId,
      status: isCreditCardPay ? "0" : "6", // Start with pending for credit card
      isPrinted: false,
      isViewd: false,
      isViewdAdminAll: false,
      ipAddress: req.ip,
      appName: appName,
    };

    try {
      const newDoc = await db.orders.insertOne(orderDoc);
      const orderId = newDoc.insertedId;

      // Handle credit card payment server-side
      if (isCreditCardPay && parsedBodey.paymentData) {
        try {
          const paymentResult = await processCreditCardPayment(
            parsedBodey.paymentData,
            orderDoc,
            req
          );

          if (paymentResult.success) {
            // Update order with successful payment
            await db.orders.updateOne(
              { _id: orderId },
              {
                $set: {
                  status: "1",
                  ccPaymentRefData: paymentResult.paymentData,
                  isShippingPaid: orderDoc.order.receipt_method === "DELIVERY",
                },
              }
            );

            // Send notifications for successful payment
            await sendOrderNotifications(orderDoc, req, appName);
            
            // Invoice mail handling - wrapped in try-catch to continue order processing even if invoice fails
            try {
              const docId = paymentResult?.paymentData?.ZCreditInvoiceReceiptResponse?.DocumentID;
              if (docId) {
                try {
                  await invoiceMailService.saveInvoice(docId, req);
                  
                  // Only attempt URL shortening if invoice save was successful
                  try {
                    const shortenedUrl = await turl.shorten(
                      `https://shoofi-spaces.fra1.cdn.digitaloceanspaces.com/invoices/doc-${docId}.pdf`
                    );
                    
                    // Update order with shortened URL - non-critical update
                    try {
                      await db.orders.updateOne(
                        { _id: getId(orderId) },
                        {
                          $set: {
                            "ccPaymentRefData.url": shortenedUrl
                          },
                        },
                        { multi: false }
                      );
                    } catch (urlUpdateError) {
                      console.error("Failed to update order with invoice URL:", urlUpdateError);
                    }
                  } catch (urlError) {
                    console.error("Failed to shorten invoice URL:", urlError);
                  }
                } catch (saveError) {
                  console.error("Failed to save invoice:", saveError);
                }
              } else {
                console.error("No document ID in invoice response:", paymentResult?.paymentData?.ZCreditInvoiceReceiptResponse);
              }
            } catch (invoiceError) {
              console.error("Invoice processing error:", invoiceError);
            }

            res.status(200).json({
              message: "Order created and payment processed successfully",
              orderId,
              paymentStatus: "success",
            });
            return;
          } else {
            // Payment failed - keep order in pending status
            res.status(200).json({
              message: "Order created but payment failed",
              orderId,
              paymentStatus: "failed",
              paymentError: paymentResult.error,
            });
            return;
          }
        } catch (paymentError) {
          console.error("Payment processing error:", paymentError);
          // Keep order in pending status if payment processing fails
          res.status(200).json({
            message: "Order created but payment processing failed",
            orderId,
            paymentStatus: "error",
            paymentError: paymentError.message,
          });
          return;
        }
      }

      // For non-credit card payments or if no payment data
      if (
        req.headers["app-name"] === "buffalo" ||
        req.headers["app-name"] === "world-of-swimming"
      ) {
        res.status(200).json({
          message: "Order created successfully",
          orderId,
        });
        return;
      }

      const customerDB = getCustomerAppName(req, appName);
      const customer = await customerDB.customers.findOne({
        _id: getId(customerId),
      });
      if (!customer) {
        res.status(400).json({
          message: "Customer not found",
        });
        return;
      }

      if (!customer.addresses || customer.addresses.length === 0) {
        // Add the address from the order to the customer's addresses array
        if (orderDoc.order.address) {
          await customerDB.customers.updateOne(
            { _id: getId(customer._id) },
            { $push: { addresses: orderDoc.order.address } }
          );
          // Optionally, update the in-memory customer object if you use it later
          customer.addresses = [orderDoc.order.address];
        }
      }

      await customerDB.customers.findOneAndUpdate(
        { _id: getId(customerId) },
        {
          $set: {
            ...customer,
            orders: customer.orders
              ? [...customer.orders, { orderId, appName }]
              : [{ orderId, appName }],
          },
        },
        { multi: false, returnOriginal: false }
      );

      if (!isCreditCardPay) {
        await sendOrderNotifications(orderDoc, req, appName);
      }

      res.status(200).json({
        message: "Order created successfully",
        orderId,
      });
    } catch (ex) {
      console.log(ex);
      res.status(400).json({ err: "Your order declined. Please try again" });
    }
  }
);

router.post(
  "/api/order/update/all",
  upload.array("img"),
  auth.required,
  async (req, res, next) => {
    const appName = req.headers["app-name"];
    const db = req.app.db[appName];
    const config = req.app.config;
    const parsedBodey = JSON.parse(req.body.body);
    const customerId = parsedBodey.customerId || req.auth.id;
    const db_orderId = parsedBodey.db_orderId;
    const orderId = parsedBodey.orderId;

    let imagesList = [];
    if (req.files && req.files.length > 0) {
      imagesList = await imagesService.uploadImage(req.files, req, "orders");
    }
    let imageIndex = 0;
    let updatedItemsWithImages = [];
    if (imagesList?.length > 0) {
      updatedItemsWithImages = parsedBodey.order.items.map((item) => {
        if (item.clienImage) {
          imageIndex++;
          return {
            ...item,
            clienImage: imagesList[imageIndex - 1],
          };
        }
        return {
          ...item,
          clienImage: null,
        };
      });
    }

    const orderDoc = {
      ...parsedBodey,
      order: {
        ...parsedBodey.order,
        items:
          updatedItemsWithImages?.length > 0
            ? updatedItemsWithImages
            : parsedBodey.order.items,
      },
      created: moment(new Date()).utcOffset(offsetHours).format(),
      customerId,
      orderId: orderId,
      status: "1",
      isPrinted: false,
    };

    try {
      await db.orders.updateOne(
        {
          _id: getId(db_orderId),
        },
        { $set: orderDoc },
        { multi: false }
      );

      const customerDB = getCustomerAppName(req, appName);
      const customer = await customerDB.customers.findOne({
        _id: getId(customerId),
      });
      if (!customer) {
        res.status(400).json({
          message: "Customer not found",
        });
        return;
      }

      // const smsContent = smsService.getOrderRecivedContent(
      //   customer.fullName,
      //   orderDoc.total,
      //   orderDoc.order.receipt_method,
      //   generatedOrderId,
      //   orderDoc.app_language
      // );
      //smsService.sendSMS(customer.phone, smsContent, req);
      // smsService.sendSMS("0542454362", smsContent, req);

      const finalOrderDoc = {
        ...orderDoc,
        customerDetails: {
          name: customer.fullName,
          phone: customer.phone,
        },
      };
      websockets.fireWebscoketEvent({
        type: "order updated",
        data: finalOrderDoc,
        customerIds: [customerId],
        isAdmin: true,
        appName,
      });

      indexOrders(req.app).then(() => {
        res.status(200).json({
          message: "Order created successfully",
        });
      });
    } catch (ex) {
      console.log(ex);
      res.status(400).json({ err: "Your order declined. Please try again" });
    }
  }
);

router.post("/api/order/update", auth.required, async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  try {
    const updateobj = req.body.updateData;
    await db.orders.updateOne(
      {
        _id: getId(req.body.orderId),
      },
      { $set: updateobj },
      { multi: false }
    );
    const order = await db.orders.findOne({ _id: getId(req.body.orderId) });
    const customerId = order?.customerId;
    websockets.fireWebscoketEvent({
      type: "order status updated",
      data: updateobj,
      customerIds: [customerId],
      isAdmin: true,
      appName,
    });

    const customerDB = getCustomerAppName(req, appName);
    const customer = await customerDB.customers.findOne({
      _id: getId(order.customerId),
    });
    // if (!customer) {
    //   res.status(400).json({
    //     message: "Customer not found",
    //   });
    //   return;
    // }
    // if (updateobj?.status == "2" && updateobj?.shouldSendSms) {
    if (updateobj?.status == "2") {
      let smsContent = "";
      switch (order.order.receipt_method) {
        case "TAKEAWAY":
          smsContent = smsService.getOrderTakeawayReadyContent(
            customer?.fullName,
            order.orderId,
            order.app_language
          );
          break;
        case "DELIVERY":
          const storeData = await db.store.findOne({ id: 1 });
          smsContent = smsService.getOrderDeliveryReadyContent(
            customer?.fullName,
            order.orderId,
            order.app_language,
            storeData.order_company_number
          );
      }
      await smsService.sendSMS(customer?.phone, smsContent, req);
      await smsService.sendSMS("0542454362", smsContent, req);
    }

    // if (updateobj?.status == "3") {
    //   const smsContent = smsService.getOrderDeliveryCompanyContent(
    //     customer.fullName,
    //     order.orderId,
    //     order.app_language,
    //     order.orderDate
    //   );
    //   smsService.sendSMS("0542454362", smsContent, req);
    // }

    return res.status(200).json({ message: "Order successfully updated" });
  } catch (ex) {
    console.info("Error updating order", ex);
    return res.status(400).json({ message: "Failed to update the order" });
  }
});

router.post("/api/order/update/viewd", auth.required, async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];

  try {
    const updateobj = req.body.updateData;
    const offsetHours = getUTCOffset();

    let updateData = {
      isViewd: updateobj.isViewd,
      isViewdAdminAll: updateobj.isViewdAdminAll,
    };
    if (!updateobj.isOrderLaterSupport) {
      const orderDate = moment(updateobj.currentTime)
        .utcOffset(offsetHours)
        .add(updateobj.readyMinutes, "m")
        .format();
      updateData.orderDate = orderDate;
      updateData.status = "1";
    }

    await db.orders.updateOne(
      {
        _id: getId(req.body.orderId),
      },
      {
        $set: updateData,
      },
      { multi: false }
    );

    const order = await db.orders.findOne({ _id: getId(req.body.orderId) });

    if (order.order.receipt_method == "DELIVERY") {
      const customerDB = getCustomerAppName(req, appName);
      const customer = await customerDB.customers.findOne({
        _id: getId(order.customerId),
      });
      if (!customer) {
        res.status(400).json({
          message: "Customer not found",
        });
        return;
      }
      const storeData = await db.store.findOne({ id: 1 });
      const shoofiDB = req.app.db["shoofi"];
      const shoofiStore = await shoofiDB.store.findOne({ id: 1 });

      if (shoofiStore.isSendSmsToDeliveryCompany) {
        const smsDeliveryContent = smsService.getOrderDeliveryCompanyContent(
          customer.fullName,
          order.orderId,
          order.app_language,
          order.orderDate,
          customer.phone,
          storeData.order_company_delta_minutes
        );
        await smsService.sendSMS(
          storeData.order_company_number,
          smsDeliveryContent,
          req
        );
        await smsService.sendSMS("0542454362", smsDeliveryContent, req);
      }
      if (shoofiStore.isSendNotificationToDeliveryCompany) {
        const deliveryData = {
          fullName: customer.fullName,
          phone: customer.phone,
          price: order.orderPrice || "",
          pickupTime: updateobj.readyMinutes,
          storeName: storeData.storeName,
          appName: storeData.appName,
          storeId: storeData._id,
          bookId: order.orderId,
          storeLocation: storeData.location,
          coverageRadius: storeData.coverageRadius,
          customerLocation: order?.order?.geo_positioning,
        };

        deliveryService.bookDelivery({ deliveryData, appDb: req.app.db });
      }
    }
    websockets.fireWebscoketEvent({
      type: "order viewed updated",
      customerIds: [order.customerId],
      isAdmin: true,
      appName,
    });

    // pushNotification.pushToClient(order.customerId, "TEEEEEST", req);

    return res
      .status(200)
      .json({ message: "order viewed successfully updated" });
  } catch (ex) {
    console.info("Error updating order", ex);
    return res.status(400).json({ message: "Failed to update the order" });
  }
});

router.post("/api/order/book-delivery", auth.required, async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  try {
    const updateobj = req.body.updateData;

    await db.orders.updateOne(
      {
        _id: getId(req.body.orderId),
      },
      { $set: updateobj },
      { multi: false }
    );
    const order = await db.orders.findOne({ _id: getId(req.body.orderId) });
    const customerId = order.customerId;
    websockets.fireWebscoketEvent({
      type: "order status updated",
      data: updateobj,
      customerIds: [customerId],
      isAdmin: true,
      appName,
    });

    const customerDB = getCustomerAppName(req, appName);
    const customer = await customerDB.customers.findOne({
      _id: getId(order.customerId),
    });
    if (!customer) {
      res.status(400).json({
        message: "Customer not found",
      });
      return;
    }

    const storeData = await db.store.findOne({ id: 1 });

    if (storeData.isSendSmsToDeliveryCompany) {
      const smsContent = smsService.getOrderDeliveryCompanyContent(
        customer.fullName,
        order.orderId,
        order.app_language,
        order.orderDate,
        customer.phone
      );
      await smsService.sendSMS(storeData.order_company_number, smsContent, req);
      await smsService.sendSMS("0542454362", smsContent, req);
    }
    if (storeData.isSendNotificationToDeliveryCompany) {
      const deliveryData = {
        fullName: customer.fullName,
        phone: customer.phone,
        price: order.orderPrice || "",
        pickupTime: updateobj.readyMinutes || 0,
        storeName: storeData.storeName,
        appName: storeData.appName,
        storeId: storeData._id,
        bookId: order.orderId,
        storeLocation: storeData.location,
        coverageRadius: storeData.coverageRadius,
        customerLocation: order?.order?.geo_positioning,
      };
      deliveryService.bookDelivery({ deliveryData, appDb: req.app.db });
    }
    websockets.fireWebscoketEvent({
      type: "order delivery booked",
      isAdmin: true,
      appName,
    });

    return res
      .status(200)
      .json({ message: "order delivery booked successfully" });
  } catch (ex) {
    console.info("Error order delivery booked", ex);
    return res.status(400).json({ message: "order delivery booked" });
  }
});

router.post(
  "/api/order/book-custom-delivery",
  auth.required,
  async (req, res) => {
    const appName = req.headers["app-name"];
    const db = req.app.db[appName];

    const isStoreOpen = await storeService.isDeliveryCompanyOpen(req);
    if (!isStoreOpen) {
      return res.status(200).json({ isStoreOpen });
    }
    try {
      const deliveryData = req.body.deliveryData;
      const offsetHours = getUTCOffset();

      var deliveryDeltaMinutes = moment()
        .add(deliveryData.time, "m")
        .utcOffset(offsetHours)
        .format("HH:mm");
      const insertRetsult = await db.bookDelivery.insertOne({
        ...deliveryData,
        deliveryDeltaMinutes,
        isDelivered: false,
        isCanceled: false,
        created: moment(new Date()).utcOffset(offsetHours).format(),
      });

      const storeData = await db.store.findOne({ id: 1 });
      if (storeData.isSendSmsToDeliveryCompany) {
        const smsContent = smsService.getCustomOrderDeliveryCompanyContent(
          deliveryData.fullName || "",
          deliveryData.phone,
          deliveryData.price,
          deliveryDeltaMinutes
        );
        await smsService.sendSMS(
          storeData.order_company_number,
          smsContent,
          req
        );
        await smsService.sendSMS("0542454362", smsContent, req);
      }
      if (storeData.isSendNotificationToDeliveryCompany) {
        const deliveryDataX = {
          fullName: deliveryData.fullName,
          phone: deliveryData.phone,
          price: deliveryData.price || "",
          pickupTime: deliveryData.time,
          storeName: storeData.storeName,
          appName: storeData.appName,
          storeId: storeData._id,
          bookId: insertRetsult?.insertedId.toString(),
          storeLocation: storeData.location,
          coverageRadius: storeData.coverageRadius,
          customerLocation: order?.order?.geo_positioning,
        };
        deliveryService.bookDelivery({
          deliveryData: deliveryDataX,
          appDb: req.app.db,
        });
      }

      // websockets.fireWebscoketEvent("order delivery booked");
      return res
        .status(200)
        .json({
          message: "order custom delivery booked successfully",
          isStoreOpen,
        });
    } catch (ex) {
      console.info("Error order custom delivery booked", ex);
      return res
        .status(400)
        .json({ message: "order custom delivery booke failed" });
    }
  }
);

router.post(
  "/api/order/update-custom-delivery",
  auth.required,
  async (req, res) => {
    const appName = req.headers["app-name"];
    const db = req.app.db[appName];
    try {
      let updateData = req.body.updateData;
      const id = updateData._id;
      delete updateData._id;
      await db.bookDelivery.updateOne(
        {
          _id: getId(id),
        },
        { $set: updateData },
        { multi: false }
      );

      if (updateData.isCanceled === true) {
        const storeData = await db.store.findOne({ id: 1 });
        if (storeData.isSendSmsToDeliveryCompany) {
          const smsDeliveryContent =
            smsService.getOrderDeliveryCompanyCanceledContent(
              updateData.fullName,
              updateData.deliveryDeltaMinutes,
              updateData.phone,
              updateData.price
            );
          await smsService.sendSMS(
            storeData.order_company_number,
            smsDeliveryContent,
            req
          );
          await smsService.sendSMS("0542454362", smsDeliveryContent, req);
        }
        if (storeData.isSendNotificationToDeliveryCompany) {
          const deliveryDataX = {
            bookId: id,
            status: "-1",
          };
          deliveryService.updateDelivery({
            deliveryData: deliveryDataX,
            appDb: req.app.db,
          });
        }
      }

      // websockets.fireWebscoketEvent("order delivery booked");
      return res
        .status(200)
        .json({ message: "order custom delivery updated successfully" });
    } catch (ex) {
      console.info("Error order custom delivery updated", ex);
      return res
        .status(400)
        .json({ message: "order custom delivery updated failed" });
    }
  }
);

router.post("/api/order/get-custom-delivery", async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  try {
    const isAll = req.body.isAll;
    const offsetHours = getUTCOffset();

    const startOfToday = moment()
      .utcOffset(offsetHours)
      .startOf("day")
      .subtract(7, "d");

    // Get the end of today in UTC
    const endOfToday = moment().utcOffset(offsetHours).endOf("day").add(3, "h");

    let filterBy = {
      created: {
        $gte: startOfToday.format(),
        $lte: endOfToday.format(),
      },
    };

    if (!isAll) {
      filterBy = {
        ...filterBy,
        isDelivered: false,
        isCanceled: false,
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

router.post("/api/order/printed", auth.required, async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  try {
    await db.orders.updateOne(
      {
        _id: getId(
          req.body?.orderId?.$oid ? req.body.orderId.$oid : req.body.orderId
        ),
      },
      { $set: { isPrinted: req.body.status } },
      { multi: false }
    );
    if (req.body.status === false) {
      websockets.fireWebscoketEvent({
        type: "print not printed",
        isAdmin: true,
        appName,
      });
    }
    return res.status(200).json({ message: "Order successfully printed" });
  } catch (ex) {
    console.info("Error updating order", ex);
    return res.status(400).json({ message: "Failed to print the order" });
  }
});
function relDiff(a, b) {
  let diff = 100 * Math.abs((a - b) / ((a + b) / 2));
  if (a < b) {
    diff = diff * -1;
  }
  return diff.toFixed(2);
}
router.post("/api/order/statistics/new-orders/:page?", async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  let pageNum = 1;
  if (req.body.pageNumber) {
    pageNum = req.body.pageNumber;
  }
  const offsetHours = getUTCOffset();

  var start = moment().subtract(7, "days").utcOffset(offsetHours);
  start.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });

  var end = moment().utcOffset(offsetHours);
  end.set({ hour: 23, minute: 59, second: 59, millisecond: 999 });
  const filterBy = {
    created: { $gte: new Date(start), $lt: new Date(end) },
  };
  let newOrders = await paginateData(true, req, pageNum, "orders", filterBy, {
    created: 1,
  });

  var start2 = moment().subtract(14, "days").utcOffset(offsetHours);
  start2.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });

  var end2 = moment().subtract(8, "days").utcOffset(offsetHours);
  end2.set({ hour: 23, minute: 59, second: 59, millisecond: 999 });
  const filterBy2 = {
    created: { $gte: new Date(start2), $lt: new Date(end2) },
  };
  const prevWeekNewOrders = await paginateData(
    true,
    req,
    pageNum,
    "orders",
    filterBy2,
    {
      created: 1,
    }
  );
  const percentDeff = relDiff(
    newOrders.totalItems,
    prevWeekNewOrders.totalItems
  );
  newOrders.percentDeff = percentDeff;
  try {
    res.status(200).json(newOrders);
  } catch (ex) {
    console.error(colors.red("Failed to search customer: ", ex));
    res.status(400).json({
      message: "Customer search failed.",
    });
  }
});

router.post("/api/order/admin/all-orders/:page?", async (req, res) => {
  try {
    const appName = req.headers["app-name"];
    const dbAdmin = req.app.db["shoofi"];
    const storesList = await dbAdmin.stores.find().toArray();
    let allOrders = [];
    let totalItems = 0;
    const pageNum = req.body.pageNumber || 1;
    const pageSize = 10;
    const skip = (pageNum - 1) * pageSize;

    // Date filter if provided
    let dateFilter = {};
    if (req.body.startDate && req.body.endDate) {
      const offsetHours = getUTCOffset();

      var start = moment(req.body.startDate).utcOffset(offsetHours);
      start.set({ hour: 0, minute: 0, second: 0, millisecond: 0 });

      var end = moment(req.body.endDate).utcOffset(offsetHours);
      end.set({ hour: 23, minute: 59, second: 59, millisecond: 999 });

      dateFilter = {
        orderDate: { $gte: start.format(), $lt: end.format() },
      };
    }

    // Status filter if provided
    let statusFilter = {};
    if (req.body.status && req.body.status.length > 0) {
      statusFilter = { status: { $in: req.body.status } };
    }

    // City filter if provided
    let filteredStores = storesList;
    if (req.body.cityIds && req.body.cityIds.length > 0) {
      filteredStores = storesList.filter((store) =>
        req.body.cityIds.includes(store.cityId)
      );
    }

    // Combine filters
    const filterBy = {
      ...dateFilter,
      ...statusFilter,
    };

    // Get orders from each store
    for (const store of filteredStores) {
      const db = req.app.db[store.appName];
      if (!db) continue;

      const storeOrders = await db.orders
        .find(filterBy)
        .sort({ created: -1 })
        .toArray();

      // Add store info to each order
      const ordersWithStoreInfo = storeOrders.map((order) => ({
        ...order,
        storeName: store.storeName,
        storeAppName: store.appName,
      }));

      allOrders = [...allOrders, ...ordersWithStoreInfo];
    }

    // Sort all orders by creation date
    allOrders.sort((a, b) => new Date(b.created) - new Date(a.created));

    // Get total count before pagination
    totalItems = allOrders.length;

    // Apply pagination
    const paginatedOrders = allOrders.slice(skip, skip + pageSize);

    // Get customer details for each order
    const finalOrders = [];
    for (const order of paginatedOrders) {
      const customerDB = getCustomerAppName(req, order.storeAppName);
      const customer = await customerDB.customers.findOne({
        _id: getId(order.customerId),
      });

      finalOrders.push({
        ...order,
        customerDetails: {
          name: customer?.fullName || order?.name,
          phone: customer?.phone || order?.phone,
          branchId: order?.branchId,
        },
      });
    }

    res.status(200).json({
      ordersList: finalOrders,
      totalItems,
      currentPage: pageNum,
      totalPages: Math.ceil(totalItems / pageSize),
    });
  } catch (error) {
    console.error("Error fetching all orders:", error);
    res.status(400).json({ message: "Failed to fetch orders" });
  }
});

// Get only active orders for the authenticated customer
router.get("/api/order/customer-active-orders", auth.required, async (req, res) => {
  const customerId = req.auth.id;
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const customerDB = getCustomerAppName(req, appName);

  const appType = req.headers["app-type"];
  // Active statuses (from frontend: inProgressStatuses = ["1"])
  const activeStatuses = ["1","3","6","2","11"];
  let customer = null;
  try {
    if(appType === 'shoofi-shoofir'){
      customer = await customerDB.customers.findOne({
        _id: getId(customerId),
      });
    }else if(appType === 'shoofi-partner'){
      customer = await customerDB.storeUsers.findOne({
        _id: getId(customerId),
      });
    }else{
      customer = await customerDB.customers.findOne({
        _id: getId(customerId),
      });
    }
      if (!customer) {
      res.status(400).json({
        message: "Customer not found",
      });
      return;
    }

    if (!customer.orders || !customer.orders.length) {
      res.status(200).json([]);
      return;
    }

    // Group orders by their database
    const ordersByAppName = {};
    customer.orders.forEach((order) => {
      const appNameTmp = order.appName || appName; // Use the order's db if specified, otherwise use current app
      if (!ordersByAppName[appNameTmp]) {
        ordersByAppName[appNameTmp] = [];
      }
      ordersByAppName[appNameTmp].push(order.appName ? order.orderId : order);
    });

    // Fetch active orders from each database
    const allOrders = [];
    for (const [dbName, orderIds] of Object.entries(ordersByAppName)) {
      const currentDb = req.app.db[dbName];
      const oids = orderIds.map((id) => getId(id));

      const orders = await paginateData(
        true,
        req,
        1,
        "orders",
        {
          _id: { $in: oids },
          status: { $in: activeStatuses },
        },
        { created: -1 },
        currentDb // Pass the current database to paginateData
      );

      allOrders.push(...orders.data);
    }

    // Sort all orders by creation date
    allOrders.sort((a, b) => new Date(b.created) - new Date(a.created));

    res.status(200).json(allOrders);
  } catch (ex) {
    console.error(`Failed get customer active orders: ${ex}`);
    res.status(400).json({ message: "Failed to get customer active orders" });
  }
});

module.exports = router;
