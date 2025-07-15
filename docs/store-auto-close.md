# Store Auto-Close Feature

## Overview

The Store Auto-Close feature automatically turns off the `isOpen` property for stores when their work hours end. This ensures that stores are automatically closed at the end of their business day without requiring manual intervention.

## How It Works

1. **Manual Opening**: Store managers manually turn on `isOpen` when they start work using the existing store update API
2. **Automatic Closing**: A cron job runs every 6 hours to check all stores and automatically close them if their work hours have ended
3. **Real-time Notifications**: When a store is auto-closed, both admin users and customers are notified via WebSocket

## Implementation Details

### Cron Job Schedule
- **Frequency**: Every day at 12:00 AM and 6:00 AM
- **Pattern**: `0 0,6 * * *`

### Distributed Locking
- **Redis Lock Key**: `cron:store-auto-close`
- **Lock TTL**: 10 minutes
- **Purpose**: Ensures only one server runs the job when scaled to multiple instances

### Logic Flow
1. **Acquire Distributed Lock**: Uses Redis to ensure only one server runs the job
2. The cron job queries the `shoofi` database's `stores` collection to get all store app names
3. For each store app, it checks if the database exists and the store is currently open
4. Uses the existing `storeService.isStoreOpenNow()` function to determine if the store should be open based on working hours
5. If the store should be closed but `isOpen` is true, it automatically closes the store
6. Sends WebSocket notifications to both admin and customer apps
7. **Release Lock**: Always releases the lock when job completes or fails

### Files Modified/Created

#### New Files
- `utils/crons/store-auto-close.js` - Main cron job implementation
- `utils/redis-lock.js` - Distributed locking utility

#### Modified Files
- `app.js` - Added cron job initialization
- `routes/store.js` - Added manual trigger endpoint for testing

## API Endpoints

### Manual Trigger (Testing)
```
POST /api/store/auto-close
```
Triggers the auto-close job manually for testing purposes.

## WebSocket Events

When a store is auto-closed, the following WebSocket events are sent:

### To Admin App (`shoofi-partner`)
```javascript
{
  type: 'store_auto_closed',
  data: {
    action: 'store_auto_closed',
    appName: 'app-name',
    reason: 'Work hours ended',
    closedAt: '2024-01-01T18:00:00.000Z'
  }
}
```

### To Customer App (`shoofi-shopping`)
```javascript
{
  type: 'store_refresh',
  data: {
    action: 'store_auto_closed',
    appName: 'app-name'
  }
}
```

## Configuration

The feature uses the existing store configuration:
- `store.openHours` - Working hours configuration
- `store.isOpen` - Current open/closed status
- `store.isStoreClose` - Manual override to keep store closed

## Benefits

1. **Automation**: No manual intervention required to close stores
2. **Consistency**: Ensures stores are always closed when they should be
3. **Real-time Updates**: Customers and admins are immediately notified
4. **Reliability**: Uses existing, tested logic for determining store hours
5. **Scalability**: Works for all apps in the system

## Monitoring

The cron job logs its activities:
- When it starts and completes
- Which stores are processed
- Which stores are auto-closed
- Any errors that occur

Logs can be monitored in the application console or log files.

## Testing

To test the feature:
1. Set a store's `isOpen` to `true`
2. Ensure the store's working hours indicate it should be closed
3. Either wait for the cron job to run (daily at 12:00 AM or 6:00 AM) or use the manual trigger endpoint
4. Verify the store is closed and notifications are sent

## Integration with Open Reminder Feature

This feature works alongside the Store Open Reminder feature:

- **Auto-Close**: Closes stores when work hours end (daily at 12:00 AM and 6:00 AM)
- **Open Reminder**: Reminds stores to open when work hours begin (every 30 minutes)

Together, they provide complete automation for store opening and closing based on working hours.

## Future Enhancements

Potential improvements:
- Configurable cron schedule per app
- Email notifications in addition to WebSocket
- Dashboard to view auto-close history
- Manual override to prevent auto-closing for special events
- Integration with store manager's calendar/schedule 