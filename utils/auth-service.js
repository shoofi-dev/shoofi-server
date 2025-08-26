const jwt = require('jsonwebtoken');
const APP_CONSTS = require("../consts/consts");
const { getCustomerAppName } = require("../utils/app-name-helper");

generateJWT = async function (user,req) {
    return new Promise(async function (resolve, reject) {
        const appName = req.headers['app-name'];
        const customerDB = getCustomerAppName(req, appName);
        const today = new Date();
        const expirationDate = new Date(today);
        expirationDate.setDate(today.getDate() + (30 * 50));

        const token = jwt.sign({
            phone: user.phone,
            id: user._id,
            exp: parseInt(expirationDate.getTime() / 1000, 10),
        }, 'secret');
              await customerDB.customers.updateOne(
          { phone: req.body.phone },
          { $set: { 'token': token } },
          { multi: false }
        );
            resolve(token);
    });
}

const toAuthJSON = async function (user, req) {
    return new Promise(function (resolve, reject) {
        generateJWT(user, req).then((result) => {
            resolve({
                ...user,
                token: result,
            });
        });

    });
};

const refreshToken = function(req, res, next) {
    const appName = req.headers['app-name'];
    const customerDB = getCustomerAppName(req, appName);

    let token = req.headers['x-access-token'] || req.headers['authorization']; // Express headers are auto converted to lowercase test
    
    // Standardized Bearer token handling
    if (token && token.startsWith('Bearer ')) {
      // Remove Bearer from string
      token = token.slice(7, token.length);
    
      customerDB.customers.findOne({ token: token })
        .then((result) => {
          if (!result) {
            return res.status(422).json({
              errors: {
                email: 'is required',
              },
            });
          } else {
            generateJWT(result, req).then((newToken) => {
              res.setHeader('Authorization', 'Bearer ' + newToken);
              next();
            });
          }
        });
    } else {
      return res.status(401).json({
        errors: {
          authorization: 'Bearer token is required',
        },
      });
    }
};

const auth = {
    toAuthJSON: toAuthJSON,
    refreshToken: refreshToken
};

module.exports = auth;