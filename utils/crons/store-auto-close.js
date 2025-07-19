const moment = require("moment");
const momentTZ = require("moment-timezone");
const storeService = require("../store-service");
const websocketService = require("../../services/websocket/websocket-service");
const { acquireLock, releaseLock } = require("../redis-lock");

/**
 * Automatically close stores when their work hours end
 * This cron job runs every 6 hours to check all stores and turn off isOpen
 * when they should be closed according to their working hours
 */
async function autoCloseStores(appDb) {
  const lockKey = 'cron:store-auto-close';
  const lockTtl = 10 * 60 * 1000; // 10 minutes (longer than expected job time)

  // Try to acquire distributed lock
  const gotLock = await acquireLock(lockKey, lockTtl);
  if (!gotLock) {
    console.log('Another server is running the store auto-close cron, skipping.');
    return;
  }

  try {
    console.log("Starting store auto-close cron job...");
    
    // Get all store app names from the shoofi database
    const shoofiDb = appDb['shoofi'];
    if (!shoofiDb) {
      console.error("Shoofi database not found");
      return;
    }
    
    const stores = await shoofiDb.stores.find({ appName: { $exists: true } }).toArray();
    console.log(`Found ${stores.length} stores to process`);
    
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
        
        // Skip if store is already closed
        if (!store.isOpen) {
          console.log(`Store for ${appName} is already closed`);
          continue;
        }
        
        // Check if store should be open based on working hours
        const storeStatus = storeService.isStoreOpenNow(store.openHours);
        
        // If store should be closed but isOpen is true, close it
        if (!storeStatus.isOpen) {
          console.log(`Auto-closing store for ${appName} - work hours ended`);
          
          // Update the store to close it
          await db.store.updateOne(
            { id: 1 },
            { $set: { isOpen: false } }
          );
          
          // Clear explore cache for this store
          const { clearExploreCacheForStore } = require('../explore-cache');
          await clearExploreCacheForStore(storeData);
          
          // Send websocket notifications
          // Notify admin users
          websocketService.sendToAppAdmins('shoofi-partner', {
            type: 'store_auto_closed',
            data: { 
              action: 'store_auto_closed', 
              appName: appName,
              reason: 'Work hours ended',
              closedAt: new Date().toISOString()
            }
          }, appName);
          
          // Notify customers to refresh their store data
          websocketService.sendToAppCustomers('shoofi-shopping', {
            type: 'store_refresh',
            data: { 
              action: 'store_auto_closed', 
              appName: appName 
            }
          });
          
          console.log(`Successfully auto-closed store for ${appName}`);
        } else {
          console.log(`Store for ${appName} should remain open`);
        }
        
      } catch (error) {
        console.error(`Error processing store for ${appName}:`, error);
        // Continue with other apps even if one fails
      }
    }
    
    console.log("Store auto-close cron job completed successfully");
    
  } catch (error) {
    console.error("Error in store auto-close cron job:", error);
  } finally {
    // Release the lock
    await releaseLock(lockKey);
  }
}

/**
 * Start the store auto-close cron job
 * Runs every day at 12:00 AM and 6:00 AM
 */
const startStoreAutoCloseCron = (appDb) => {
  const cron = require('node-cron');
  
  // Schedule to run at 12:00 AM and 6:00 AM every day
  cron.schedule('0 0,6 * * *', async () => {
    console.log('Running store auto-close cron job...');
    await autoCloseStores(appDb);
  });
  
  console.log('Store auto-close cron job scheduled (daily at 12:00 AM and 6:00 AM)');
};

module.exports = {
  autoCloseStores,
  startStoreAutoCloseCron
}; 