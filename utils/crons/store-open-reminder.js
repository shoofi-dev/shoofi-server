const moment = require("moment");
const momentTZ = require("moment-timezone");
const storeService = require("../store-service");
const websocketService = require("../../services/websocket/websocket-service");
const { acquireLock, releaseLock } = require("../redis-lock");

/**
 * Send reminder notifications to stores that should be open but aren't
 * This cron job runs every 30 minutes to check all stores and send reminders
 * when they should be open according to their working hours but isOpen is false
 */
async function sendStoreOpenReminders(appDb) {
  const lockKey = 'cron:store-open-reminder';
  const lockTtl = 5 * 60 * 1000; // 5 minutes (longer than expected job time)

  // Try to acquire distributed lock
  const gotLock = await acquireLock(lockKey, lockTtl);
  if (!gotLock) {
    console.log('Another server is running the store open reminder cron, skipping.');
    return;
  }

  try {
    console.log("Starting store open reminder cron job...");
    
    // Get all store app names from the shoofi database
    const shoofiDb = appDb['shoofi'];
    if (!shoofiDb) {
      console.error("Shoofi database not found");
      return;
    }
    
    const stores = await shoofiDb.stores.find({ appName: { $exists: true } }).toArray();
    console.log(`Found ${stores.length} stores to check for reminders`);
    
    let reminderCount = 0;
    
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
        
        // Skip if store is already open
        if (store.isOpen) {
          console.log(`Store for ${appName} is already open`);
          continue;
        }
        
        // Skip if store is manually closed
        if (store.isStoreClose) {
          console.log(`Store for ${appName} is manually closed, skipping reminder`);
          continue;
        }
        
        // Check if store should be open based on working hours
        const storeStatus = storeService.isStoreOpenNow(store.openHours);
        
        // If store should be open but isOpen is false, send reminder
        if (storeStatus.isOpen) {
          console.log(`Sending reminder to store ${appName} - should be open but is closed`);
          
          // Send websocket notifications
          // Notify admin users with reminder
          websocketService.sendToAppAdmins('shoofi-partner', {
            type: 'store_open_reminder',
            data: { 
              action: 'store_open_reminder', 
              appName: appName,
              reason: 'Store should be open according to working hours',
              workingHours: storeStatus.workingHours,
              currentTime: new Date().toISOString(),
              storeName: storeInfo.name_ar || storeInfo.name_he || appName
            }
          }, appName);
          
          // Also send to the specific store's partner app if different
          if (appName !== 'shoofi-partner') {
            websocketService.sendToAppAdmins('shoofi-partner', {
              type: 'store_open_reminder',
              data: { 
                action: 'store_open_reminder', 
                appName: appName,
                reason: 'Store should be open according to working hours',
                workingHours: storeStatus.workingHours,
                currentTime: new Date().toISOString(),
                storeName: storeInfo.name_ar || storeInfo.name_he || appName
              }
            }, appName);
          }
          
          reminderCount++;
          console.log(`Successfully sent reminder to store ${appName}`);
        } else {
          console.log(`Store for ${appName} should remain closed`);
        }
        
      } catch (error) {
        console.error(`Error processing store reminder for ${appName}:`, error);
        // Continue with other apps even if one fails
      }
    }
    
    console.log(`Store open reminder cron job completed. Sent ${reminderCount} reminders.`);
    
  } catch (error) {
    console.error("Error in store open reminder cron job:", error);
  } finally {
    // Release the lock
    await releaseLock(lockKey);
  }
}

/**
 * Start the store open reminder cron job
 * Runs every 30 minutes
 */
const startStoreOpenReminderCron = (appDb) => {
  const cron = require('node-cron');
  
  // Schedule to run every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    console.log('Running store open reminder cron job...');
    await sendStoreOpenReminders(appDb);
  });
  
  console.log('Store open reminder cron job scheduled (every 30 minutes)');
};

module.exports = {
  sendStoreOpenReminders,
  startStoreOpenReminderCron
}; 