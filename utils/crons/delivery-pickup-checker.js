const moment = require("moment");
const momentTZ = require("moment-timezone");
const websocketService = require("../../services/websocket/websocket-service");
const notificationService = require("../../services/notification/notification-service");
const { acquireLock, releaseLock } = require("../redis-lock");
const { DELIVERY_STATUS } = require("../../consts/consts");

/**
 * Check for delivery orders where pickup time has passed and send notifications to drivers
 * This cron job runs every 3 minutes to check all delivery orders for pickup delays
 */
async function checkDeliveryPickupDelays(appDb) {
  const lockKey = 'cron:delivery-pickup-checker';
  const lockTtl = 3 * 60 * 1000; // 3 minutes

  // Try to acquire distributed lock
  const gotLock = await acquireLock(lockKey, lockTtl);
  if (!gotLock) {
    console.log('Another server is running the delivery pickup checker cron, skipping.');
    return;
  }

  try {
    console.log("Starting delivery pickup delay checker cron job...");
    
    const deliveryDB = appDb['delivery-company'];
    if (!deliveryDB) {
      console.error("Delivery database not found");
      return;
    }
    
    // Get current time with timezone offset
    const offsetHours = getUTCOffset();
    const currentTime = moment().utcOffset(offsetHours);
    
    // Find delivery orders where pickupTime has passed but order is still active
    const delayedPickupOrders = await deliveryDB.bookDelivery.find({
      status: { 
        $in: [
          DELIVERY_STATUS.WAITING_FOR_APPROVE,
          DELIVERY_STATUS.APPROVED,
          DELIVERY_STATUS.COLLECTED_FROM_RESTAURANT
        ] 
      },
      pickupTime: { $exists: true, $ne: null },
      isPickupDelayNotified: { $ne: true }, // Only notify once per order
      created: { $exists: true }
    }).toArray();
    
    let totalDelayedPickups = 0;
    
    for (const order of delayedPickupOrders) {
      try {
        // Parse pickupTime as a moment object using created's date
        // pickupTime is 'HH:mm', created is ISO string
        const createdDate = moment(order.created);
        const [pickupHour, pickupMinute] = order.pickupTime.split(":");
        const expectedPickupTime = moment(createdDate).set({
          hour: Number(pickupHour),
          minute: Number(pickupMinute),
          second: 0,
          millisecond: 0
        });
        // Check if pickup time has passed
        if (currentTime.isAfter(expectedPickupTime)) {
          const delayMinutes = Math.floor(currentTime.diff(expectedPickupTime, 'minutes', true));
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
                    title: "تأخير في وقت الاستلام",
                    body: `${order.bookId} رقم طلب متأخر بـ ${delayMinutes} دقيقة عن وقت الاستلام المحدد (${expectedPickupTime.format('HH:mm')}). يرجى التواصل مع المطعم.`,
                    type: 'pickup_delayed',
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
                      expectedPickupTime: expectedPickupTime.format(),
                      delayMinutes: delayMinutes,
                      orderStatus: order.status,
                      storeName: order.storeName || "المطعم",
                      customerName: order.fullName || "العميل",
                      customerPhone: order.phone || "",
                      action: 'pickup_delayed'
                    },
                    req: {
                      app: {
                        db: appDb,
                        appName: 'delivery-company'
                      }
                    },
                    soundType: 'driver.wav'
                  });
                  
                  console.log(`Sent pickup delay notification to driver ${driver.fullName} for order ${order.bookId}`);
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
                      title: "تأخير في استلام الطلب",
                      body: `طلب رقم ${order.bookId} متأخر بـ ${delayMinutes} دقيقة عن وقت الاستلام المحدد. يرجى التواصل مع السائق.`,
                      type: 'pickup_delayed_store',
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
                        expectedPickupTime: expectedPickupTime.format(),
                        delayMinutes: delayMinutes,
                        orderStatus: order.status,
                        driverName: order.driver?.name || "السائق",
                        driverPhone: order.driver?.phone || "",
                        customerName: order.fullName || "العميل",
                        action: 'pickup_delayed_store'
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
                  console.log(`Sent pickup delay notifications to ${storeUsers.length} store users for order ${order.bookId}`);
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
                  isPickupDelayNotified: true, 
                  pickupDelayNotifiedAt: currentTime.format(),
                  pickupDelayMinutes: delayMinutes
                } 
              }
            );
            
            // Send WebSocket notification to refresh orders in admin app
            websocketService.sendToAppAdmins('shoofi-partner', {
              type: 'pickup_delayed',
              data: {
                orderId: order._id,
                bookId: order.bookId,
                expectedPickupTime: expectedPickupTime.format(),
                delayMinutes: delayMinutes,
                driverName: order.driver?.name || "السائق",
                storeName: order.storeName || "المطعم",
                action: 'pickup_delayed',
                timestamp: new Date().toISOString()
              },
            }, order.appName);
            
            // Send WebSocket notification to driver app
            if (order.driver && order.driver._id) {
              websocketService.sendToAppAdmins('shoofi-shoofir', {
                type: 'pickup_delayed',
                data: {
                  orderId: order._id,
                  bookId: order.bookId,
                  expectedPickupTime: expectedPickupTime.format(),
                  delayMinutes: delayMinutes,
                  storeName: order.storeName || "المطعم",
                  action: 'pickup_delayed',
                  timestamp: new Date().toISOString()
                },
              }, 'delivery-company');
            }
            
            totalDelayedPickups++;
          }
        }
        
      } catch (orderError) {
        console.error(`Error processing pickup delay for order ${order.bookId}:`, orderError);
        // Continue with other orders even if one fails
      }
    }
    
    console.log(`Delivery pickup delay checker cron job completed. Processed ${totalDelayedPickups} delayed pickups.`);
    
  } catch (error) {
    console.error("Error in delivery pickup delay checker cron job:", error);
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
 * Start the delivery pickup delay checker cron job
 * Runs every 3 minutes
 */
const startDeliveryPickupCheckerCron = (appDb) => {
  const cron = require('node-cron');
  
  // Schedule to run every 3 minutes
  cron.schedule('*/3 * * * *', async () => {
    console.log('Running delivery pickup delay checker cron job...');
    await checkDeliveryPickupDelays(appDb);
  });
  
  console.log('Delivery pickup delay checker cron job scheduled (every 3 minutes)');
};

module.exports = {
  checkDeliveryPickupDelays,
  startDeliveryPickupCheckerCron
}; 