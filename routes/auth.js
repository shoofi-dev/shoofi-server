// const ROLES = require('../utils/roles');
const APP_CONSTS = require("../consts/consts");
const { expressjwt } = require("express-jwt");
const jwt = require("jsonwebtoken");
const { getId } = require("../lib/common");
const adminAuthService = require("../utils/admin-auth-service");

const getTokenFromHeaders = async (req, res) => {
  const appType = req.headers['app-type'];
  const {
    headers: { authorization },
  } = req;
  
  if (!authorization) {
    return null;
  }

  const token = authorization?.split(" ")[1];
  if (!token) {
    return null;
  }

  try {
    if (appType === 'shoofi-admin') {
      // Verify admin token using the admin auth service
      const decoded = adminAuthService.verifyAccessToken(token);
      if (!decoded) {
        return null;
      }
      
      // Check if user still exists and is active
      const db = req.app.db['shoofi'];
      const user = await db.shoofiAdminUsers.findOne({
        _id: getId(decoded.id),
        roles: { $exists: true, $ne: [] }
      });
      
      if (!user) {
        return null;
      }
      
      return token;
    } else {
      // Handle other app types with existing logic
      const decoded = jwt.verify(token, "secret");
      let db = null;
      let collection = null;
     
      if (appType === 'shoofi-shoofir') {
        db = req.app.db['delivery-company'];
        collection = 'customers';
      } else {
        db = req.app.db['shoofi'];
        if (appType === 'shoofi-partner') {
          collection = 'storeUsers';
        } else {
          collection = 'customers';
        }
      }
      
      let customer = null;
      const customerId = decoded.id;
     
      customer = await db[collection].findOne({ _id: getId(customerId) });  

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
    }
  } catch (e) {
    console.log("Token verification error:", e);
    return null;
  }
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
    secret: adminAuthService.JWT_SECRET,
    userProperty: "auth", // Changed from "payload" to "auth" for consistency
    getToken: getTokenFromHeaders,
    algorithms: ["HS256"],
  }),
  optional: expressjwt({
    secret: adminAuthService.JWT_SECRET,
    userProperty: "auth", // Changed from "payload" to "auth" for consistency
    getToken: getTokenFromHeaders,
    credentialsRequired: false,
    algorithms: ["HS256"],
  }),
  checkIsInRole: checkIsInRole,
};

module.exports = auth;
