const fs = require("fs");
const yenv = require("yenv");
const firebaseAdmin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey-sari-apps.json');

require('dotenv').config({ path: `.env.${process.env.NODE_ENV}` })
console.log("process.env",process.env.DB_CONNECTION_STRING)
const path = require("path");
const express = require("express");
const logger = require("morgan");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const moment = require("moment");
const _ = require("lodash");
const MongoStore = require("connect-mongodb-session")(session);
const numeral = require("numeral");
const helmet = require("helmet");
const colors = require("colors");
const cron = require("node-cron");
const crypto = require("crypto");
const websockets = require("./utils/websockets");
const smsService = require("./utils/sms");
// const pushNotificationWebService = require("./utils/push-notification/push-web");
const cronOrdersService = require("./utils/crons/orders");

const {
  getConfig,
  getPaymentConfig,
  updateConfigLocal,
} = require("./lib/config");
const { addSchemas } = require("./lib/schema");
const { initDb, getDbUri } = require("./lib/db");
const { writeGoogleData } = require("./lib/googledata");
let handlebars = require("express-handlebars");
const cors = require("cors");
require("./config/passport");

// Validate our settings schema
const Ajv = require("ajv");
const ajv = new Ajv({ useDefaults: true });

// get config
const config = getConfig();

const baseConfig = ajv.validate(require("./config/settingsSchema"), config);
if (baseConfig === false) {
  console.log(colors.red(`settings.json incorrect: ${ajv.errorsText()}`));
  process.exit(2);
}

// require the routes
const shoofiAdmin = require("./routes/shoofi-admin");
const index = require("./routes/index");
const admin = require("./routes/admin");
const category = require("./routes/category");
const product = require("./routes/product");
const menu = require("./routes/menu");
const customer = require("./routes/customer");
const analytics = require("./routes/analytics");
const calander = require("./routes/calander");
const course = require("./routes/course");
const teacher = require("./routes/teacher");
const translations = require("./routes/translations");
const geo = require("./routes/geo");
const clientErrorHandler = require("./routes/client-error-handler");
const store = require("./routes/store");
const order = require("./routes/order");
const user = require("./routes/user");
const transactions = require("./routes/transactions");
const reviews = require("./routes/reviews");
const delivery = require("./routes/delivery");
const pushNotificationWeb = require("./routes/push-notification-web");

firebaseAdmin.initializeApp({
  credential: firebaseAdmin.credential.cert(serviceAccount),
});
// pushNotificationWebService.sendNotificationToDevice('ezRF7UkbioPV6B4SpEYbtn:APA91bFarImZBWKckSaSRNLxlXraPcgdTaB6Ci11D8WpqHRpB4_yPbmODvJRaFR_Tey5blSYTHeLVJKdFx5WN2vQLSCGKfjx0QHzphC_s3L0HaDOZCL8VxU');
const app = express();



app.enable("trust proxy");
app.use(helmet());
app.set("port", process.env.PORT || 1111);
app.use(logger("dev"));
app.use(express.urlencoded({ extended: false }));
app.use(cors());
// app.use(
//   session({
//     secret: "secret",
//     cookie: { maxAge: 60000 },
//     resave: false,
//     saveUninitialized: false,
//   })
// );

app.use(express.json({}));

// Set locales from session

// Make stuff accessible to our router
app.use((req, res, next) => {
  //req.handlebars = handlebars;
  console.log(`Incoming request: ${req.method} ${req.url}`);

  next();
});

// Setup the routes
app.use("/", shoofiAdmin);
app.use("/", index);
app.use("/", customer);
app.use("/", calander);
app.use("/", course);
app.use("/", teacher);
app.use("/", translations);
app.use("/", geo);
app.use("/", clientErrorHandler);
app.use("/", store);
app.use("/", category);
app.use("/", product);
app.use("/", menu);
app.use("/", order);
app.use("/", user);
app.use("/", admin);
app.use("/", transactions);
app.use("/", reviews);
app.use("/", delivery);
app.use("/", pushNotificationWeb);
app.use("/", analytics);
// Payment route(s)
// _.forEach(config.paymentGateway, (gateway) => {
//     app.use(`/${gateway}`, require(`./lib/payments/${gateway}`));
// });

// catch 404 and forward to error handler
app.use((req, res, next) => {
  const err = new Error("Not Found");
  err.status = 404;
  next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get("env") === "development") {
  app.use((err, req, res, next) => {
    res.status(err.status || 500);

    res.json({
      errors: {
        message: err.message,
        error: err,
      },
    });
  });
}

// CORS configuration
const corsOptions = {
  origin: 'http://localhost:3000', // Replace with your React app's URL
  methods: ['GET', 'POST', 'PUT', 'DELETE'], // Allowed HTTP methods
  credentials: true, // Include credentials like cookies in requests
};

app.use(cors(corsOptions));

// production error handler
// no stacktraces leaked to user
app.use((err, req, res, next) => {
  console.error(colors.red(err.stack));
  if (err && err.code === "EACCES") {
    res.status(400).json({ message: "File upload error. Please try again." });
    return;
  }
  res.status(err.status || 500);
  res.json({
    errors: {
      message: err.message,
      error: {},
    },
  });
});

// Nodejs version check
const nodeVersionMajor = parseInt(
  process.version.split(".")[0].replace("v", "")
);
if (nodeVersionMajor < 7) {
  console.log(
    colors.red(
      `Please use Node.js version 7.x or above. Current version: ${nodeVersionMajor}`
    )
  );
  process.exit(2);
}

app.on("uncaughtException", (err) => {
  console.error(colors.red(err.stack));
  process.exit(2);
});

console.log("config.databaseConnectionString", config.databaseConnectionString);

initDb(async (err, db) => {
  // On connection error we display then exit
  if (err) {
    console.log(colors.red(`Error connecting to MongoDB: ${err}`));
    process.exit(2);
  }

  // add db to app for routes
  app.db = db;
  app.config = config;
  app.port = app.get("port");


cron.schedule("0 0 * * *", function () {
  console.log("---------------------");
  console.log("running a task every 1 day");
 // smsService.checkSMSBalance(app.db);

});

// cron.schedule('*/1 * * * *', function () {
//   cronOrdersService.updateExpiredOrders(app.db)
// });
// cron.schedule('*/5 * * * *', function () {
//   cronOrdersService.checkDeliveryDelay(app.db)
// });
// cron.schedule('*/2 * * * *', function () {
//   cronOrdersService.checkOrderStatusZeroCC(app.db)
// });



  // Fire up the cron job to clear temp held stock
  // cron.schedule("*/1 * * * *", async () => {
  //   const validSessions = await db.sessions.find({}).toArray();
  //   const validSessionIds = [];
  //   _.forEach(validSessions, (value) => {
  //     validSessionIds.push(value._id);
  //   });

  //   // Remove any invalid cart holds
  //   await db.cart.deleteMany({
  //     sessionId: { $nin: validSessionIds },
  //   });
  // });

  // Fire up the cron job to create google product feed
  // cron.schedule("0 * * * *", async () => {
  //   await writeGoogleData(db);
  // });

  // // Create indexes on startup
  // if (process.env.NODE_ENV !== "test") {
  //   try {
  //    // await runIndexing(app);
  //   } catch (ex) {
  //     console.error(colors.red(`Error setting up indexes: ${ex.message}`));
  //   }
  // }

  // // Start cron job to index
  // if (process.env.NODE_ENV !== "test") {
  //   cron.schedule("*/30 * * * *", async () => {
  //     try {
  //      // await runIndexing(app);
  //     } catch (ex) {
  //       console.error(colors.red(`Error setting up indexes: ${ex.message}`));
  //     }
  //   });
  // }

  // Set trackStock for testing
  if (process.env.NODE_ENV === "test") {
    config.trackStock = true;
  }

  // Process schemas
  await addSchemas();

  // Start the app
  try {
    const server = await app.listen(app.get("port"));
    console.log("APPJS")
    websockets.initWebSockets(server);

 
    app.emit("appStarted");
    if (process.env.NODE_ENV !== "test") {
      console.log(
        colors.green(
          `expressCart running on host: http://localhost:${app.get("port")}`
        )
      );
    }
  } catch (ex) {
    console.error(colors.red(`Error starting expressCart app:${ex.message}`));
    process.exit(2);
  }



});

module.exports = app;
