const firebaseAdmin = require('firebase-admin');

const sendNotificationToDevice = async (deviceToken,data, status) => {
  let message = {};
  if(status === "-1"){
    message = {
      notification: {
        title: 'الغيت الطلبية',
        body: data?.storeName,
      },
      token: deviceToken, // FCM token of the target device
    };
  }else{
    message = {
      notification: {
        title: 'طلبية جديدة',
        body: data?.storeName,
      },
      token: deviceToken, // FCM token of the target device
    };
  }
  
    try {
      const response = await firebaseAdmin.messaging().send(message);
      console.log('Successfully sent message:', response);
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

const pushNotificationWebService = {
    sendNotificationToDevice: sendNotificationToDevice,
  };
  module.exports = pushNotificationWebService;