const moment = require("moment");
const momentTZ = require("moment-timezone");
const websocketService = require("../../services/websocket/websocket-service");
const notificationService = require("../../services/notification/notification-service");
const { acquireLock, releaseLock } = require("../redis-lock");
const { DELIVERY_STATUS } = require("../../consts/consts");

/**
 * Check for delivery orders where expectedDeliveryAt has passed and send notifications to drivers
 * This cron job runs every 4 minutes to check all delivery orders for delivery delays
 */
async function checkDeliveryCompletionDelays(appDb) {
  const lockKey = 'cron:delivery-completion-delay-checker';
  const lockTtl = 4 * 60 * 1000; // 4 minutes

  // Try to acquire distributed lock
  const gotLock = await acquireLock(lockKey, lockTtl);
  if (!gotLock) {
    console.log('Another server is running the delivery completion delay checker cron, skipping.');
    return;
  }

  try {
    console.log("Starting delivery completion delay checker cron job...");
    
    const deliveryDB = appDb['delivery-company'];
    if (!deliveryDB) {
      console.error("Delivery database not found");
      return;
    }
    
    // Get current time with timezone offset
    const offsetHours = getUTCOffset();
    const currentTime = moment().utcOffset(offsetHours);
    
    // Find delivery orders where expectedDeliveryAt has passed but order is still active
    const delayedDeliveryOrders = await deliveryDB.bookDelivery.find({
      status: { 
        $in: [
          DELIVERY_STATUS.COLLECTED_FROM_RESTAURANT,
          DELIVERY_STATUS.APPROVED
        ] 
      },
      expectedDeliveryAt: { $exists: true, $ne: null, $lt: currentTime.format() },
      isDeliveryDelayNotified: { $ne: true }, // Only notify once per order
      completedAt: { $exists: false }
    }).toArray();
    
    let totalDelayedDeliveries = 0;
    
    for (const order of delayedDeliveryOrders) {
      try {
        // Calculate how many minutes delayed
        const expectedDeliveryAt = moment(order.expectedDeliveryAt);
        const delayMinutes = Math.floor(currentTime.diff(expectedDeliveryAt, 'minutes', true));
        
        // Only notify if delay is significant (e.g., more than 5 minutes)
        if (delayMinutes >= 5) {
          // Get driver details if assigned
          if (order.driver && order.driver._id) {
            try {
              const driver = await deliveryDB.customers.findOne({
                _id: order.driver._id
              });
              
              if (driver && driver.isActive) {
                // Send notification to driver
                await notificationService.sendNotification({
                  recipientId: order.driver._id.toString(),
                  title: "تأخير في تسليم الطلب",
                  body: `طلب رقم ${order.bookId} متأخر بـ ${delayMinutes} دقيقة عن وقت التسليم المتوقع (${expectedDeliveryAt.format('HH:mm')}). يرجى التواصل مع العميل وتسليم الطلب في أقرب وقت ممكن.`,
                  type: 'delivery_delayed',
                  appName: 'delivery-company',
                  appType: 'shoofi-shoofir',
                  channels: {
                    websocket: true,
                    push: true,
                    email: false,
                    sms: false
                  },
                  data: {
                    orderId: order._id,
                    bookId: order.bookId,
                    expectedDeliveryAt: expectedDeliveryAt.format(),
                    delayMinutes: delayMinutes,
                    orderStatus: order.status,
                    storeName: order.storeName || "المطعم",
                    customerName: order.fullName || "العميل",
                    customerPhone: order.phone || "",
                    action: 'delivery_delayed'
                  },
                  req: {
                    app: {
                      db: appDb,
                      appName: 'delivery-company'
                    }
                  },
                  soundType: 'driver.wav'
                });
                
                console.log(`Sent delivery delay notification to driver ${driver.fullName} for order ${order.bookId}`);
              }
            } catch (driverError) {
              console.error(`Error processing driver notification for order ${order.bookId}:`, driverError);
            }
          }
          
          // Send notification to store users (admin app)
          if (order.appName) {
            try {
              // Get store users to notify
              const shoofiDB = appDb['shoofi'];
              const storeUsers = await shoofiDB.storeUsers.find({
                appName: order.appName,
                isActive: true
              }).toArray();
              
              if (storeUsers.length > 0) {
                const storeNotificationPromises = storeUsers.map(user => 
                  notificationService.sendNotification({
                    recipientId: user._id.toString(),
                    title: "تأخير في تسليم الطلب",
                    body: `طلب رقم ${order.bookId} متأخر بـ ${delayMinutes} دقيقة عن وقت التسليم المتوقع. يرجى التواصل مع السائق.`,
                    type: 'delivery_delayed_store',
                    appName: order.appName,
                    appType: 'shoofi-partner',
                    channels: {
                      websocket: true,
                      push: true,
                      email: false,
                      sms: false
                    },
                    data: {
                      orderId: order._id,
                      bookId: order.bookId,
                      expectedDeliveryAt: expectedDeliveryAt.format(),
                      delayMinutes: delayMinutes,
                      orderStatus: order.status,
                      driverName: order.driver?.name || "السائق",
                      driverPhone: order.driver?.phone || "",
                      customerName: order.fullName || "العميل",
                      action: 'delivery_delayed_store'
                    },
                    req: {
                      app: {
                        db: appDb,
                        appName: order.appName
                      }
                    },
                    soundType: 'storelate.wav'
                  })
                );
                
                await Promise.allSettled(storeNotificationPromises);
                console.log(`Sent delivery delay notifications to ${storeUsers.length} store users for order ${order.bookId}`);
              }
            } catch (storeError) {
              console.error(`Error sending store notifications for order ${order.bookId}:`, storeError);
            }
          }
          
          // Mark order as notified to prevent duplicate notifications
          await deliveryDB.bookDelivery.updateOne(
            { _id: order._id },
            { 
              $set: { 
                isDeliveryDelayNotified: true, 
                deliveryDelayNotifiedAt: currentTime.format(),
                deliveryDelayMinutes: delayMinutes
              } 
            }
          );
          
          // Send WebSocket notification to refresh orders in admin app
          websocketService.sendToAppAdmins('shoofi-partner', {
            type: 'delivery_delayed',
            data: {
              orderId: order._id,
              bookId: order.bookId,
              expectedDeliveryAt: expectedDeliveryAt.format(),
              delayMinutes: delayMinutes,
              driverName: order.driver?.name || "السائق",
              storeName: order.storeName || "المطعم",
              action: 'delivery_delayed',
              timestamp: new Date().toISOString()
            },
          }, order.appName);
          
          // Send WebSocket notification to driver app
          if (order.driver && order.driver._id) {
            websocketService.sendToAppAdmins('shoofi-shoofir', {
              type: 'delivery_delayed',
              data: {
                orderId: order._id,
                bookId: order.bookId,
                expectedDeliveryAt: expectedDeliveryAt.format(),
                delayMinutes: delayMinutes,
                storeName: order.storeName || "المطعم",
                action: 'delivery_delayed',
                timestamp: new Date().toISOString()
              },
            }, 'delivery-company');
          }
          
          totalDelayedDeliveries++;
        }
      } catch (orderError) {
        console.error(`Error processing delivery delay for order ${order.bookId}:`, orderError);
        // Continue with other orders even if one fails
      }
    }
    
    console.log(`Delivery completion delay checker cron job completed. Processed ${totalDelayedDeliveries} delayed deliveries.`);
    
  } catch (error) {
    console.error("Error in delivery completion delay checker cron job:", error);
  } finally {
    // Release the lock
    await releaseLock(lockKey);
  }
}

/**
 * Get UTC offset for Israel timezone
 */
function getUTCOffset() {
  const israelTimezone = "Asia/Jerusalem";
  const israelTime = momentTZ.tz(israelTimezone);
  return israelTime.utcOffset();
}

/**
 * Start the delivery completion delay checker cron job
 * Runs every 4 minutes
 */
const startDeliveryCompletionDelayCheckerCron = (appDb) => {
  const cron = require('node-cron');
  
  // Schedule to run every 4 minutes
  cron.schedule('*/4 * * * *', async () => {
    console.log('Running delivery completion delay checker cron job...');
    await checkDeliveryCompletionDelays(appDb);
  });
  
  console.log('Delivery completion delay checker cron job scheduled (every 4 minutes)');
};

module.exports = {
  checkDeliveryCompletionDelays,
  startDeliveryCompletionDelayCheckerCron
}; 