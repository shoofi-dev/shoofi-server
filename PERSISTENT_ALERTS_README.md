# Persistent Alerts System

## Overview

The Persistent Alerts System ensures that store managers receive persistent notifications for new orders until they approve them by setting `isViewd = true`. This system integrates with the existing `isViewd` property flow.

## Features

- **Persistent Notifications**: Store managers receive notifications that persist until order approval
- **Automatic Clearing**: Alerts are automatically cleared when `isViewd` is set to true
- **Reminder System**: Automatic reminders every 5 minutes for pending orders
- **Multi-App Support**: Works with all app types (shoofi-app, shoofi-shoofir, shoofi-partner)
- **Arabic Support**: All notifications are in Arabic
- **Multiple Channels**: WebSocket and push notifications

## How It Works

### 1. Order Creation
When a new order is created:
- `sendStoreOwnerNotifications()` is called
- This function now also calls `persistentAlertsService.sendPersistentAlert()`
- A persistent alert record is created in the database
- Initial notifications are sent to all active store users

### 2. Order Approval (isViewd = true)
When the store approves an order via "update/viewd" endpoint:
- The existing logic updates `isViewd: true`
- New logic calls `persistentAlertsService.clearPersistentAlert()`
- The persistent alert is marked as "approved"
- Approval notifications are sent to store users

### 3. Reminder System
A cron job runs every 5 minutes:
- Finds pending alerts that need reminders
- Sends reminder notifications to store users
- Tracks reminder count (max 5 reminders)

## Database Schema

### persistentAlerts Collection
```javascript
{
  _id: ObjectId,
  orderId: ObjectId,
  orderNumber: String,
  appName: String,
  customerName: String,
  orderTotal: Number,
  orderItems: Array,
  status: String, // "pending" | "approved"
  createdAt: Date,
  approvedAt: Date,
  approvedBy: String,
  lastReminderSent: Date,
  reminderCount: Number,
  maxReminders: Number,
  reminderInterval: Number,
  storeUsers: [{
    userId: ObjectId,
    name: String,
    role: String,
    notified: Boolean
  }]
}
```

## API Endpoints

### Get Pending Orders
```
GET /api/persistent-alerts/pending
Headers: app-name, app-type
```

### Get Alert Statistics
```
GET /api/persistent-alerts/stats
Headers: app-name
```

## Files

### Core Files
- `utils/persistent-alerts.js` - Main persistent alerts service
- `utils/crons/persistent-alerts-cron.js` - Cron jobs for reminders and cleanup
- `routes/order.js` - Updated with persistent alerts integration

### Test Files
- `test-persistent-alerts.js` - Comprehensive test suite

## Testing

Run the test suite:
```bash
node test-persistent-alerts.js
```

## Configuration

### Reminder Settings
- **Reminder Interval**: 5 minutes
- **Max Reminders**: 5 per order
- **Cleanup**: Old alerts deleted after 24 hours

### Notification Channels
- **WebSocket**: Real-time notifications
- **Push**: Mobile push notifications
- **Email**: Disabled by default
- **SMS**: Disabled by default

## Integration Points

### Order Creation
```javascript
// In sendStoreOwnerNotifications function
await persistentAlertsService.sendPersistentAlert(orderDoc, req, appName);
```

### Order Approval
```javascript
// In "update/viewd" endpoint
if (updateobj.isViewd === true) {
  await persistentAlertsService.clearPersistentAlert(order._id, req, appName);
}
```

## Arabic Notification Texts

### New Order Alert
- **Title**: "طلب جديد يتطلب الموافقة"
- **Body**: "طلب جديد رقم {orderNumber} من {customerName} بقيمة {orderTotal}₪"

### Reminder Alert
- **Title**: "تذكير: طلب في انتظار الموافقة"
- **Body**: "طلب رقم {orderNumber} من {customerName} لا يزال في انتظار الموافقة"

### Approval Alert
- **Title**: "تمت الموافقة على الطلب"
- **Body**: "تمت الموافقة على الطلب رقم {orderNumber} من {customerName}"

## Monitoring

### Logs
- All persistent alert activities are logged
- Check logs for: "persistent-alerts", "reminder", "approval"

### Statistics
- Track response times
- Monitor reminder counts
- Alert on high pending order counts

## Troubleshooting

### Common Issues

1. **Alerts not being sent**
   - Check if store users exist and are active
   - Verify appName matches between order and store users

2. **Alerts not being cleared**
   - Ensure `isViewd` is being set to `true`
   - Check if orderId matches between order and alert

3. **Reminders not working**
   - Verify cron job is running
   - Check database connection

### Debug Commands
```javascript
// Check pending alerts
const alerts = await persistentAlertsService.getPendingOrders(req, appName);

// Check alert statistics
const stats = await persistentAlertsService.getAlertStats(req, appName);

// Manually send reminder
await persistentAlertsService.sendReminders(req, appName);
``` 