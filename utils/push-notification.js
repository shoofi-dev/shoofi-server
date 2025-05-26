const {
    getId,
  } = require("../lib/common");
  const { Expo } = require("expo-server-sdk");
const APP_CONSTS = require("../consts/consts");
const { getCustomerAppName } = require("../utils/app-name-helper");

pushToClient = async function ( customerId, body, data, req) {
    const appName = req.headers['app-name'];
    const customerDB = getCustomerAppName(req, appName);
  
    const customer = await customerDB.customers.findOne({
      _id: getId(customerId),
    });
    if (!customer || !customer?.notificationToken) {
      return;
    }

    let expo = new Expo();

    const messages =[{
      to: customer?.notificationToken,
      sound: 'default',
      body,
      data,
    }];
    
    let chunks = expo.chunkPushNotifications(messages);
    let tickets = [];
    (async () => {
    // Send the chunks to the Expo push notification service. There are
    // different strategies you could use. A simple one is to send one chunk at a
    // time, which nicely spreads the load out over time:
    for (let chunk of chunks) {
      try {
        let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        console.log(ticketChunk);
        tickets.push(...ticketChunk);
        // NOTE: If a ticket contains an error code in ticket.details.error, you
        // must handle it appropriately. The error codes are listed in the Expo
        // documentation:
        // https://docs.expo.io/push-notifications/sending-notifications/#individual-errors
      } catch (error) {
        console.error(error);
      }
    }
    })();
};

const pushNotification = {
    pushToClient: pushToClient,
};
module.exports = pushNotification;