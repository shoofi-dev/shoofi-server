# Order Status Notifications

This document describes the customer notification system that automatically sends notifications when order status is updated through the `/api/order/update` route.

## Overview

The order status notification system automatically sends push notifications, websocket messages, and other notifications to customers when their order status changes. This provides real-time updates to customers about their order progress.

## Implementation

### Route: `/api/order/update`

The order update route has been enhanced to include automatic customer notifications based on status changes.

### Notification Logic

When an order status is updated, the system:

1. **Checks if customer exists** - Retrieves customer information from the database
2. **Determines notification content** - Based on the new status and receipt method
3. **Sends notification** - Uses the centralized notification service
4. **Handles errors gracefully** - Notification failures don't break the order update

### Status-Based Notifications

| Status | Title (Arabic) | Body (Arabic) | Type | Description |
|--------|----------------|---------------|------|-------------|
| `1` | طلبك قيد التحضير | طلبك رقم #[orderId] قيد التحضير الآن. | order | Order in progress/being prepared |
| `2` (Takeaway) | طلبك جاهز للاستلام | طلبك رقم #[orderId] جاهز للاستلام من المطعم. | order | Order ready for pickup |
| `2` (Delivery) | طلبك جاهز للتوصيل | طلبك رقم #[orderId] تم تحضيره وهو جاهز للتوصيل. | order | Order prepared and ready for delivery |
| `3` | في انتظار السائق | طلبك رقم #[orderId] جاهز وتم إرساله للسائق. | order | Waiting for driver assignment |
| `4` | تم إلغاء طلبك | طلبك رقم #[orderId] تم إلغاؤه. إذا كان لديك أي استفسار، يرجى التواصل معنا. | order_cancelled | Order cancelled |
| `5` | تم رفض طلبك | عذراً، تم رفض طلبك رقم #[orderId]. يرجى التواصل معنا للمزيد من المعلومات. | order_rejected | Order rejected |
| `6` | تم استلام طلبك | طلبك رقم #[orderId] تم استلامه وهو قيد المراجعة. | order | Order received and under review |
| `7` | تم إلغاء طلبك من قبل الإدارة | طلبك رقم #[orderId] تم إلغاؤه من قبل الإدارة. يرجى التواصل معنا للمزيد من المعلومات. | order_cancelled_admin | Order cancelled by admin |
| `8` | تم إلغاء طلبك | طلبك رقم #[orderId] تم إلغاؤه بنجاح. | order_cancelled_customer | Order cancelled by customer |
| `9` | تم إلغاء الطلب من قبل السائق | طلبك رقم #[orderId] تم إلغاؤه من قبل السائق. سيتم إعادة تعيين سائق جديد. | order_cancelled_driver | Order cancelled by driver |
| `10` | تم استلام طلبك | طلبك رقم #[orderId] تم استلامه من المطعم. | order | Order picked up from restaurant |
| `11` | تم استلام الطلب من قبل السائق | طلبك رقم #[orderId] تم استلامه من قبل السائق وهو في الطريق إليك. | order | Order picked up by driver and on the way |
| `12` | تم تسليم طلبك | طلبك رقم #[orderId] تم تسليمه بنجاح. نتمنى لك وجبة شهية! | delivery_complete | Order delivered successfully |

### Notification Channels

The system sends notifications through multiple channels:

- **WebSocket**: Real-time updates to connected clients
- **Push Notifications**: Mobile app notifications
- **Email**: Disabled by default (can be enabled)
- **SMS**: Disabled by default (SMS is handled separately for status 2)

### App Type Detection

The system automatically detects the app type based on the app name:

- `shoofi-app`: Default customer app
- `shoofi-partner`: Partner/restaurant app
- `shoofi-shoofir`: Delivery driver app

## Code Structure

### Main Route Handler

```javascript
router.post("/api/order/update", auth.required, async (req, res) => {
  // ... existing order update logic ...
  
  // Send customer notifications based on status changes
  if (customer && updateobj?.status) {
    try {
      // Determine notification content based on status
      let notificationTitle = "";
      let notificationBody = "";
      let notificationType = "order";
      
      switch (updateobj.status) {
        case "1":
          notificationTitle = "تم استلام طلبك";
          notificationBody = `طلبك رقم #${order.orderId} تم استلامه وهو قيد المعالجة.`;
          break;
        // ... other status cases ...
      }
      
      // Send notification using centralized service
      await notificationService.sendNotification({
        recipientId: order.customerId,
        title: notificationTitle,
        body: notificationBody,
        type: notificationType,
        appName: order.appName,
        appType: appType,
        channels: {
          websocket: true,
          push: true,
          email: false,
          sms: false
        },
        data: {
          orderId: order.orderId,
          orderStatus: updateobj.status,
          receiptMethod: order.order.receipt_method,
          total: order.total,
          customerName: customer.fullName
        },
        req: req
      });
    } catch (notificationError) {
      console.error("Failed to send customer notification:", notificationError);
      // Don't fail the order update if notification fails
    }
  }
});
```

## Testing

### Test File: `test-order-status-notifications.js`

A comprehensive test file is provided to verify the notification system:

```bash
node test-order-status-notifications.js
```

### Test Coverage

The test file covers:

1. **Database Initialization**: Uses `DatabaseInitializationService`
2. **Test Data Creation**: Creates test customers, orders, and stores
3. **Status Testing**: Tests all order statuses (1-6)
4. **Receipt Method Testing**: Tests both delivery and takeaway
5. **Notification Verification**: Checks notifications in database
6. **Cleanup**: Removes test data after completion

### Test Output

The test provides detailed output showing:

- Database connection status
- Test data creation
- Notification sending for each status
- Notification content verification
- Database cleanup

## Configuration

### Environment Variables

- `MONGODB_URI`: MongoDB connection string (default: `mongodb://localhost:27017`)

### Notification Settings

Notifications can be configured by modifying the channels object:

```javascript
channels: {
  websocket: true,    // Real-time updates
  push: true,         // Mobile push notifications
  email: false,       // Email notifications
  sms: false          // SMS notifications (handled separately)
}
```

## Error Handling

### Graceful Degradation

- Notification failures don't break order updates
- Errors are logged but don't affect the main flow
- Customer experience is maintained even if notifications fail

### Error Logging

```javascript
catch (notificationError) {
  console.error("Failed to send customer notification:", notificationError);
  // Don't fail the order update if notification fails
}
```

## Integration with Existing Systems

### SMS Integration

The existing SMS system for status 2 (ready) is preserved:

```javascript
if (updateobj?.status == "2") {
  let smsContent = "";
  switch (order.order.receipt_method) {
    case "TAKEAWAY":
      smsContent = smsService.getOrderTakeawayReadyContent(/*...*/);
      break;
    case "DELIVERY":
      smsContent = smsService.getOrderDeliveryReadyContent(/*...*/);
  }
  // SMS sending logic...
}
```

### WebSocket Integration

WebSocket events are still fired for real-time updates:

```javascript
websockets.fireWebscoketEvent({
  type: "order status updated",
  data: updateobj,
  customerIds: [customerId],
  isAdmin: true,
  appName,
});
```

## Best Practices

### Performance

- Notifications are sent asynchronously
- Database queries are optimized
- Error handling prevents cascading failures

### Security

- Authentication required (`auth.required`)
- Customer data validation
- App name and type validation

### Maintainability

- Centralized notification service
- Clear status mapping
- Comprehensive error logging
- Test coverage

## Troubleshooting

### Common Issues

1. **Notification not sent**: Check customer exists and has notification token
2. **Wrong app type**: Verify app name detection logic
3. **Database errors**: Check MongoDB connection and permissions
4. **Notification service errors**: Check notification service configuration

### Debug Steps

1. Check console logs for error messages
2. Verify customer data in database
3. Test notification service independently
4. Check app name and type headers

### Logs to Monitor

- Order update success/failure
- Customer lookup results
- Notification sending attempts
- Error messages and stack traces

## Future Enhancements

### Potential Improvements

1. **Customizable Messages**: Allow store owners to customize notification messages
2. **Notification Preferences**: Let customers choose which notifications to receive
3. **Rich Notifications**: Include order details, images, or action buttons
4. **Analytics**: Track notification delivery and engagement rates
5. **A/B Testing**: Test different notification messages and timing

### Configuration Options

- Notification templates per store
- Customer notification preferences
- Delivery timing optimization
- Multi-language support expansion 