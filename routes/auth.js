// const ROLES = require('../utils/roles');
const APP_CONSTS = require("../consts/consts");
const { expressjwt } = require("express-jwt");
const jwt = require("jsonwebtoken");
const { getId } = require("../lib/common");
const fakeTokenForBuffalo = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJwaG9uZSI6IjA1NDI0NTQzNjIiLCJpZCI6IjY1N2RhODVmNDE4ZTAwNTZlMDcwYTAwMCIsImV4cCI6MTc1NDkyNzQ3OCwiaWF0IjoxNzIzODIzNDc4fQ.aVmYgx_MJkfpWYBFI6TDI4YfZSAhEhBBz_R3S7K9l3M";
const getTokenFromHeaders = async (req, res) => {
  const appName = req.headers['app-name'];
  let db = null;

  if(APP_CONSTS.SARI_APPS_DB_LIST.includes(appName)){
    db = req.app.db[appName];
  }else{
    db = req.app.db['shoofi'];
  }
  const {
    headers: { authorization },
  } = req;
  var token = authorization?.split(" ")[1],
    decoded;
  try {
    if(req.headers['app-name'] === 'buffalo' || req.headers['app-name'] === 'delivery-company'){
      return fakeTokenForBuffalo;
    }else{
      decoded = jwt.verify(token, "secret");
    }
  } catch (e) {
    console.log("E", e);
    return null;
  }
  const cutomerId = decoded.id;
  // check for existing customer
  const customer = await db.customers.findOne({
    _id: getId(cutomerId),
  });

  if (!customer) {
    return null;
  }
  if (customer.token !== token) {
    return null;
  }

  if (authorization && authorization.split(" ")[0] === "Token") {
    return authorization.split(" ")[1];
  } else if (req.body.token) {
    return req.body.token;
  }
  return null;
};

const checkIsInRole = (...roles) => (req, res, next) => {
  const {
    body: { user },
  } = req;
  if (!user) {
    return res.status(400).json({
      errors: {
        password: "User is missing",
      },
    });
  }

  const hasRole = roles.find((role) => user.role === role);
  if (!hasRole) {
    return res.status(400).json({
      errors: {
        password: "Admin section!",
      },
    });
  }

  return next();
};

const auth = {
  required: expressjwt({
    secret: "secret",
    userProperty: "payload",
    getToken: getTokenFromHeaders,
    algorithms: ["HS256"],
  }),
  optional: expressjwt({
    secret: "secret",
    userProperty: "payload",
    getToken: getTokenFromHeaders,
    credentialsRequired: false,
    algorithms: ["HS256"],
  }),
  checkIsInRole: checkIsInRole,
};

module.exports = auth;
