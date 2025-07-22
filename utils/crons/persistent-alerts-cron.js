const cron = require('node-cron');
const PersistentAlertsService = require('../persistent-alerts');
const logger = require('../logger');

// Mock request object for cron jobs
const createCronRequest = () => ({
  app: {
    db: global.db // Assuming global.db is available
  },
  headers: {
    "app-name": "shoofi-app"
  }
});

/**
 * Cron job to send reminders for pending orders
 * Runs every 5 minutes
 */
const startPersistentAlertsCron = (db) => {
  // Send reminders every 5 minutes
  cron.schedule('*/1 * * * *', async () => {
    try {
      logger.info('Starting persistent alerts reminder cron job');
      
      
        try {
          await PersistentAlertsService.sendReminders(db);
          logger.info(`Sent reminders for persistent alerts`);
        } catch (error) {
          logger.error(`Failed to send reminders for persistent alerts:`, error);
        }
      
      logger.info('Persistent alerts reminder cron job completed');
    } catch (error) {
      logger.error('Error in persistent alerts cron job:', error);
    }
  }, {
    scheduled: true,
    timezone: "Asia/Jerusalem"
  });

  logger.info('Persistent alerts cron job started');
};

/**
 * Cleanup old alerts (older than 24 hours)
 * Runs daily at 2 AM
 */
const startCleanupCron = (db) => {
  cron.schedule('0 2 * * *', async () => {
    try {
      logger.info('Starting persistent alerts cleanup cron job');
      
      
        try {
          const shoofiDB = db['shoofi'];
          const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
          
          const result = await shoofiDB.persistentAlerts.deleteMany({
            createdAt: { $lt: cutoffDate },
            status: { $in: ['pending', 'approved'] }
          });
          
          logger.info(`Cleaned up ${result.deletedCount} old alerts`);
        } catch (error) {
          logger.error(`Failed to cleanup alerts:`, error);
        }
      
      logger.info('Persistent alerts cleanup cron job completed');
    } catch (error) {
      logger.error('Error in persistent alerts cleanup cron job:', error);
    }
  }, {
    scheduled: true,
    timezone: "Asia/Jerusalem"
  });

  logger.info('Persistent alerts cleanup cron job started');
};

module.exports = {
  startPersistentAlertsCron,
  startCleanupCron
}; 