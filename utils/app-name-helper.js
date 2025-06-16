const APP_CONSTS = require("../consts/consts");

/**
 * Helper function to get the correct database for customer operations based on app name
 * @param {Object} req - Express request object
 * @param {string} appName - The name of the app from request headers
 * @returns {Object} The database object to use for customer operations
 */
const getCustomerAppName = (req, appName) => {
    return req.app.db['shoofi'];
};

module.exports = {
    getCustomerAppName
}; 