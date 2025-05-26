const passport = require("passport");
const LocalStrategy = require("passport-local");
const APP_CONSTS = require("../consts/consts");
const { getCustomerAppName } = require("../utils/app-name-helper");

passport.use(
  new LocalStrategy(
    {
      usernameField: "user[phone]",
      passwordField: "user[password]",
      passReqToCallback: true,
    },
    (req, phone, password, done) => {
      const appName = req.headers["app-name"];
      const customerDB = getCustomerAppName(req, appName);
      customerDB.customers
        .findOne({ phone })
        .then((user) => {
          if (!user || !user.validatePassword(password)) {
            return done(null, false, {
              errors: { "phone or password": "is invalid" },
            });
          }
          return done(null, user);
        })
        .catch(done);
    }
  )
);
