const moment = require("moment");
const momentTZ = require("moment-timezone");
const websocketService = require("../../services/websocket/websocket-service");
const notificationService = require("../../services/notification/notification-service");
const { acquireLock, releaseLock } = require("../redis-lock");
const { getCustomerAppName } = require("../app-name-helper");

/**
 * Check for orders that have passed their orderDate and send notifications to stores
 * This cron job runs every 5 minutes to check all stores for overdue orders
 */
async function checkOverdueOrders(appDb) {
  const lockKey = 'cron:order-overdue-checker';
  const lockTtl = 5 * 60 * 1000; // 5 minutes

  // Try to acquire distributed lock
  const gotLock = await acquireLock(lockKey, lockTtl);
  if (!gotLock) {
    console.log('Another server is running the order overdue checker cron, skipping.');
    return;
  }

  try {
    console.log("Starting order overdue checker cron job...");
    
    // Get all store app names from the shoofi database
    const shoofiDb = appDb['shoofi'];
    if (!shoofiDb) {
      console.error("Shoofi database not found");
      return;
    }
    
    const stores = await shoofiDb.stores.find({ appName: { $exists: true } }).toArray();
    console.log(`Found ${stores.length} stores to check for overdue orders`);
    
    let totalOverdueOrders = 0;
    
    for (const storeInfo of stores) {
      const appName = storeInfo.appName;
      
      try {
        const db = appDb[appName];
        
        if (!db) {
          console.log(`Database not found for app: ${appName}`);
          continue;
        }
        
        // Get the store for this app
        const store = await db.store.findOne({ id: 1 });
        
        if (!store) {
          console.log(`No store found for app: ${appName}`);
          continue;
        }
        
        // Skip if store is closed
        if (!store.isOpen) {
          console.log(`Store for ${appName} is closed, skipping overdue check`);
          continue;
        }
        
        // Get current time with timezone offset
        const offsetHours = getUTCOffset();
        const currentTime = moment().utcOffset(offsetHours);
        
        // Find orders that have passed their orderDate but are still in progress
        const overdueOrders = await db.orders.find({
          orderDate: { $lt: currentTime.format() },
          status: { $in: ["1"] }, // IN_PROGRESS
          isViewd: true, // Only check approved orders
          isOverdueNotified: { $ne: true } // Only notify once per order
        }).toArray();
        
        if (overdueOrders.length > 0) {
          console.log(`Found ${overdueOrders.length} overdue orders for ${appName}`);
          
          // Get store users to notify
          const storeUsers = await shoofiDb.storeUsers.find({
            appName: appName,
            isActive: true
          }).toArray();
          
          if (storeUsers.length === 0) {
            console.log(`No active store users found for ${appName}`);
            continue;
          }
          
          // Process each overdue order
          for (const order of overdueOrders) {
            try {
              // Get customer details
              const customerDB = getCustomerAppName({ app: { db: appDb } }, appName);
              const customer = await customerDB.customers.findOne({
                _id: order.customerId
              });
              
              const customerName = customer?.fullName || order?.name || "العميل";
              const orderNumber = order.orderId;
              const receiptMethod = order.order?.receipt_method === "DELIVERY" ? "توصيل" : "استلام";
              
              // Calculate how many minutes overdue
              const orderDate = moment(order.orderDate);
              const overdueMinutes = Math.floor(currentTime.diff(orderDate, 'minutes', true));
              
              // Send notifications to all store users
              const notificationPromises = storeUsers.map(user => 
                notificationService.sendNotification({
                  recipientId: user._id.toString(),
                  title: "طلب متأخر",
                  body: `طلب رقم ${orderNumber} من ${customerName} متأخر بـ ${overdueMinutes} دقيقة (${receiptMethod})`,
                  type: 'order_overdue',
                  appName: appName,
                  appType: 'shoofi-partner',
                  channels: {
                    websocket: true,
                    push: true,
                    email: false,
                    sms: false
                  },
                  data: {
                    orderId: order._id,
                    orderNumber: orderNumber,
                    customerName: customerName,
                    overdueMinutes: overdueMinutes,
                    receiptMethod: receiptMethod,
                    orderDate: order.orderDate,
                    currentTime: currentTime.format(),
                    action: 'order_overdue'
                  },
                  req: {
                    app: {
                      db: appDb,
                      appName: appName
                    }
                  },
                  soundType: 'storelate.wav'
                })
              );
              
              await Promise.allSettled(notificationPromises);
              
              // Mark order as notified to prevent duplicate notifications
              await db.orders.updateOne(
                { _id: order._id },
                { $set: { isOverdueNotified: true, overdueNotifiedAt: currentTime.format() } }
              );
              
              // Send WebSocket notification to refresh orders in admin app
              websocketService.sendToAppAdmins('shoofi-partner', {
                type: 'order_overdue',
                data: {
                  orderId: order._id,
                  orderNumber: orderNumber,
                  customerName: customerName,
                  overdueMinutes: overdueMinutes,
                  receiptMethod: receiptMethod,
                  action: 'order_overdue',
                  timestamp: new Date().toISOString()
                },
              }, appName);
              
              totalOverdueOrders++;
              console.log(`Sent overdue notification for order ${orderNumber} in ${appName}`);
              
            } catch (orderError) {
              console.error(`Error processing overdue order ${order.orderId} in ${appName}:`, orderError);
              // Continue with other orders even if one fails
            }
          }
        } else {
          console.log(`No overdue orders found for ${appName}`);
        }
        
      } catch (error) {
        console.error(`Error processing store ${appName} for overdue orders:`, error);
        // Continue with other stores even if one fails
      }
    }
    
    console.log(`Order overdue checker cron job completed. Processed ${totalOverdueOrders} overdue orders.`);
    
  } catch (error) {
    console.error("Error in order overdue checker cron job:", error);
  } finally {
    // Release the lock
    await releaseLock(lockKey);
  }
}

/**
 * Start the order overdue checker cron job
 * Runs every 5 minutes
 */
const startOrderOverdueCheckerCron = (appDb) => {
  const cron = require('node-cron');
  
  // Schedule to run every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    console.log('Running order overdue checker cron job...');
    await checkOverdueOrders(appDb);
  });
  
  console.log('Order overdue checker cron job scheduled (every 5 minutes)');
};

module.exports = {
  checkOverdueOrders,
  startOrderOverdueCheckerCron
}; 