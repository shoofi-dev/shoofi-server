# Store Open Reminder Feature

## Overview

The Store Open Reminder feature automatically sends notifications to store managers when their store should be open according to working hours but the `isOpen` property is set to false. This ensures that stores don't miss opening their business when they should be open.

## How It Works

1. **Automatic Monitoring**: A cron job runs every 30 minutes to check all stores
2. **Working Hours Check**: Uses the existing `storeService.isStoreOpenNow()` logic to determine if stores should be open
3. **Reminder Notifications**: Sends WebSocket notifications to store managers when stores should be open but aren't
4. **Smart Filtering**: Skips stores that are manually closed (`isStoreClose: true`)

## Implementation Details

### Cron Job Schedule
- **Frequency**: Every 30 minutes
- **Pattern**: `*/30 * * * *`

### Distributed Locking
- **Redis Lock Key**: `cron:store-open-reminder`
- **Lock TTL**: 5 minutes
- **Purpose**: Ensures only one server runs the job when scaled to multiple instances

### Logic Flow
1. **Acquire Distributed Lock**: Uses Redis to ensure only one server runs the job
2. The cron job queries the `shoofi` database's `stores` collection to get all store app names
3. For each store app, it checks if the database exists and the store is currently closed
4. Skips stores that are manually closed (`isStoreClose: true`)
5. Uses the existing `storeService.isStoreOpenNow()` function to determine if the store should be open
6. If the store should be open but `isOpen` is false, sends reminder notifications
7. Sends WebSocket notifications to admin users
8. **Release Lock**: Always releases the lock when job completes or fails

### Files Modified/Created

#### New Files
- `utils/crons/store-open-reminder.js` - Main cron job implementation
- `utils/redis-lock.js` - Distributed locking utility

#### Modified Files
- `app.js` - Added cron job initialization
- `routes/store.js` - Added manual trigger endpoint for testing

## API Endpoints

### Manual Trigger (Testing)
```
POST /api/store/open-reminder
```
Triggers the open reminder job manually for testing purposes.

## WebSocket Events

When a store should be open but isn't, the following WebSocket event is sent:

### To Admin App (`shoofi-partner`)
```javascript
{
  type: 'store_open_reminder',
  data: {
    action: 'store_open_reminder',
    appName: 'store-app-name',
    reason: 'Store should be open according to working hours',
    workingHours: {
      start: '09:00',
      end: '18:00'
    },
    currentTime: '2024-01-01T10:30:00.000Z',
    storeName: 'Store Name'
  }
}
```

## Configuration

The feature uses the existing store configuration:
- `store.openHours` - Working hours configuration
- `store.isOpen` - Current open/closed status
- `store.isStoreClose` - Manual override to keep store closed (skips reminders)

## Benefits

1. **Proactive Notifications**: Alerts store managers before they miss opening
2. **Improved Customer Experience**: Ensures stores are open when they should be
3. **Reduced Manual Monitoring**: Automatically checks all stores every 30 minutes
4. **Smart Filtering**: Respects manual store closures
5. **Real-time Updates**: Immediate notifications via WebSocket

## Monitoring

The cron job logs its activities:
- When it starts and completes
- Which stores are processed
- How many reminders are sent
- Any errors that occur

Logs can be monitored in the application console or log files.

## Testing

To test the feature:
1. Set a store's `isOpen` to `false`
2. Ensure the store's working hours indicate it should be open
3. Either wait for the cron job to run (every 30 minutes) or use the manual trigger endpoint
4. Verify the reminder notification is sent

## Integration with Auto-Close Feature

This feature works alongside the Store Auto-Close feature:

- **Auto-Close**: Closes stores when work hours end (daily at 12:00 AM and 6:00 AM)
- **Open Reminder**: Reminds stores to open when work hours begin (every 30 minutes)

Together, they provide complete automation for store opening and closing based on working hours.

## Future Enhancements

Potential improvements:
- Configurable reminder frequency per store
- Email notifications in addition to WebSocket
- SMS notifications for critical reminders
- Dashboard to view reminder history
- Escalation notifications if store doesn't open after multiple reminders
- Integration with store manager's calendar/schedule 