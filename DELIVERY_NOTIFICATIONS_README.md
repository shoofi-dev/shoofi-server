# Delivery Notifications - New Infrastructure

This document describes the updated delivery notification system that now uses the centralized notification service infrastructure.

## Overview

The delivery system has been updated to use the new `NotificationService` instead of the old manual notification creation and push notification calls. This provides:

- **Centralized notification management**
- **Multiple delivery channels** (WebSocket, Push, Email, SMS)
- **Consistent notification format**
- **Better error handling and retry logic**
- **Arabic language support**

## Changes Made

### 1. Updated `services/delivery/book-delivery.js`

**Before:**
```javascript
// Old manual notification creation
pushNotificationWebService.sendNotificationToDevice(
  result.driver.notificationToken, 
  { storeName: deliveryData?.storeName }  
);

await createNotification(
  db,
  result.driver._id,
  'تم تعيين طلب جديد',
  `لقد تم تعيينك للطلب: #${insertedOrder.bookId}`,  
  'order',  
  { 
    orderId: insertedOrder._id, 
    bookId: insertedOrder.bookId, 
    customerName: deliveryData.fullName,
    customerPhone: deliveryData.phone 
  }
);
```

**After:**
```javascript
// New centralized notification service
await notificationService.sendNotification({
  recipientId: result.driver._id,
  title: 'تم تعيين طلب جديد',
  body: `لقد تم تعيينك للطلب: #${insertedOrder.bookId}`,
  type: 'order',
  appName: 'delivery-company',
  appType: 'shoofi-shoofir',
  channels: { websocket: true, push: true, email: false, sms: false },
  data: { 
    orderId: insertedOrder._id, 
    bookId: insertedOrder.bookId, 
    customerName: deliveryData.fullName,
    customerPhone: deliveryData.phone 
  },
  req: null
});
```

### 2. Updated `routes/delivery.js`

**Removed:**
- Old `createNotification` helper function
- Manual database notification operations
- Direct push notification calls

**Updated Routes:**
- `/api/delivery/driver/notifications/read` - Now uses `notificationService.markAsRead()`
- `/api/delivery/notifications/create` - Now uses `notificationService.sendNotification()`
- `/api/delivery/notifications/admin` - Now uses `notificationService.getUserNotifications()`
- `/api/delivery/driver/notifications` - Now uses `notificationService.getUserNotifications()`
- `/api/delivery/admin/reassign` - Now sends notifications via notification service

## Notification Types

### 1. Order Assignment
```javascript
{
  title: 'تم تعيين طلب جديد',
  body: 'لقد تم تعيينك للطلب: #{bookId}',
  type: 'order',
  data: {
    orderId: '...',
    bookId: '...',
    customerName: '...',
    customerPhone: '...'
  }
}
```

### 2. Order Status Updates
```javascript
// Order Delivered
{
  title: 'تم تسليم الطلب',
  body: 'تم تسليم الطلب: #{bookId}',
  type: 'payment'
}

// Order Cancelled
{
  title: 'تم إلغاء الطلب',
  body: 'تم إلغاء الطلب: #{bookId}',
  type: 'alert'
}
```

### 3. Order Reassignment
```javascript
{
  title: 'تم تعيين طلب جديد',
  body: 'لقد تم تعيينك للطلب: #{orderId}',
  type: 'order',
  data: {
    orderId: '...',
    bookId: '...'
  }
}
```

## Configuration

### App Type
Delivery notifications use `appType: 'shoofi-shoofir'` to ensure proper customer lookup in the delivery company database.

### Channels
Default channel configuration for delivery notifications:
```javascript
channels: { 
  websocket: true,  // Real-time notifications
  push: true,       // Push notifications
  email: false,     // Email disabled by default
  sms: false        // SMS disabled by default
}
```

### Database
Notifications are stored in the `delivery-company` database in the `notifications` collection.

## Testing

### Running Tests
```bash
# Run delivery notification tests
node test-delivery-notifications.js
```

### Test Coverage
The test suite covers:
1. **Basic notification sending** to drivers
2. **Order status update notifications**
3. **Order cancellation notifications**
4. **Notification retrieval** for drivers
5. **Mark as read functionality**
6. **Notification templates** for different scenarios
7. **Delivery service integration**

### Test Data
The test creates:
- Test driver with notification token
- Test customer data
- Sample delivery orders
- Various notification types

## API Endpoints

### Driver Notifications
```javascript
// Get driver notifications
POST /api/delivery/driver/notifications
{
  "driverId": "driver_id",
  "limit": 20,
  "offset": 0
}

// Mark notification as read
POST /api/delivery/driver/notifications/read
{
  "notificationId": "notification_id"
}
```

### Admin Notifications
```javascript
// Get all notifications (admin)
POST /api/delivery/notifications/admin
{
  "limit": 50,
  "offset": 0,
  "recipientId": "optional_driver_id"
}

// Create notification manually
POST /api/delivery/notifications/create
{
  "recipientId": "driver_id",
  "title": "Notification Title",
  "body": "Notification Body",
  "type": "order",
  "data": {},
  "channels": {
    "websocket": true,
    "push": true,
    "email": false,
    "sms": false
  }
}
```

### Order Management
```javascript
// Reassign order to new driver
POST /api/delivery/admin/reassign
{
  "orderId": "order_id",
  "bookId": "book_id",
  "newDriverId": "new_driver_id"
}
```

## Error Handling

The new notification system includes comprehensive error handling:

1. **Graceful degradation** - If notification fails, delivery operations continue
2. **Retry logic** - Push notifications retry up to 3 times with exponential backoff
3. **Logging** - All notification attempts are logged for debugging
4. **Channel-specific errors** - Each channel (WebSocket, Push, Email, SMS) is handled separately

## Migration Notes

### Breaking Changes
- Notification format changed from `message` to `body`
- Database schema updated to include delivery status tracking
- Push notification tokens now support both Expo and Firebase

### Backward Compatibility
- Existing notification endpoints maintain the same response format
- Old notification data is preserved in the database
- Client applications can continue using existing notification APIs

## Monitoring

### Notification Status
Each notification record includes delivery status:
```javascript
{
  deliveryStatus: {
    websocket: 'pending' | 'sent' | 'failed',
    push: 'pending' | 'sent' | 'failed',
    email: 'pending' | 'sent' | 'failed',
    sms: 'pending' | 'sent' | 'failed'
  }
}
```

### Logging
- All notification attempts are logged
- Failed notifications include error details
- Success metrics are tracked for each channel

## Future Enhancements

1. **Notification Templates** - Centralized template management
2. **Scheduled Notifications** - Support for delayed notifications
3. **Bulk Notifications** - Send to multiple drivers efficiently
4. **Notification Analytics** - Track delivery success rates
5. **Custom Channels** - Support for additional notification channels

## Support

For issues or questions about the delivery notification system:
1. Check the logs for error details
2. Run the test suite to verify functionality
3. Review the notification service documentation
4. Contact the development team for assistance 