# Order Status Mapping

This document provides a complete mapping between the frontend order status constants and the backend notification messages.

## Frontend Constants (shoofi-app/consts/shared.ts)

```typescript
export const ORDER_STATUS = {
  IN_PROGRESS: "1",
  COMPLETED: "2",
  WAITING_FOR_DRIVER: "3",
  CANCELLED: "4",
  REJECTED: "5",
  PENDING: "6",
  CANCELLED_BY_ADMIN: "7",
  CANCELLED_BY_CUSTOMER: "8",
  CANCELLED_BY_DRIVER: "9",
  PICKED_UP: "10",
  PICKED_UP_BY_DRIVER: "11",
  DELIVERED: "12",
};
```

## Backend Notification Mapping

### Complete Status-to-Notification Mapping

| Status Code | Frontend Constant | Arabic Title | Arabic Body | Notification Type | Description |
|-------------|-------------------|--------------|-------------|-------------------|-------------|
| `1` | `IN_PROGRESS` | طلبك قيد التحضير | طلبك رقم #[orderId] قيد التحضير الآن. | `order` | Order is being prepared |
| `2` | `COMPLETED` (Takeaway) | طلبك جاهز للاستلام | طلبك رقم #[orderId] جاهز للاستلام من المطعم. | `order` | Order ready for pickup |
| `2` | `COMPLETED` (Delivery) | طلبك جاهز للتوصيل | طلبك رقم #[orderId] تم تحضيره وهو جاهز للتوصيل. | `order` | Order prepared and ready for delivery |
| `3` | `WAITING_FOR_DRIVER` | في انتظار السائق | طلبك رقم #[orderId] جاهز وتم إرساله للسائق. | `order` | Order sent to driver for assignment |
| `4` | `CANCELLED` | تم إلغاء طلبك | طلبك رقم #[orderId] تم إلغاؤه. إذا كان لديك أي استفسار، يرجى التواصل معنا. | `order_cancelled` | Order cancelled (general) |
| `5` | `REJECTED` | تم رفض طلبك | عذراً، تم رفض طلبك رقم #[orderId]. يرجى التواصل معنا للمزيد من المعلومات. | `order_rejected` | Order rejected by restaurant |
| `6` | `PENDING` | تم استلام طلبك | طلبك رقم #[orderId] تم استلامه وهو قيد المراجعة. | `order` | Order received and under review |
| `7` | `CANCELLED_BY_ADMIN` | تم إلغاء طلبك من قبل الإدارة | طلبك رقم #[orderId] تم إلغاؤه من قبل الإدارة. يرجى التواصل معنا للمزيد من المعلومات. | `order_cancelled_admin` | Order cancelled by admin |
| `8` | `CANCELLED_BY_CUSTOMER` | تم إلغاء طلبك | طلبك رقم #[orderId] تم إلغاؤه بنجاح. | `order_cancelled_customer` | Order cancelled by customer |
| `9` | `CANCELLED_BY_DRIVER` | تم إلغاء الطلب من قبل السائق | طلبك رقم #[orderId] تم إلغاؤه من قبل السائق. سيتم إعادة تعيين سائق جديد. | `order_cancelled_driver` | Order cancelled by driver |
| `10` | `PICKED_UP` | تم استلام طلبك | طلبك رقم #[orderId] تم استلامه من المطعم. | `order` | Order picked up from restaurant |
| `11` | `PICKED_UP_BY_DRIVER` | تم استلام الطلب من قبل السائق | طلبك رقم #[orderId] تم استلامه من قبل السائق وهو في الطريق إليك. | `order` | Order picked up by driver |
| `12` | `DELIVERED` | تم تسليم طلبك | طلبك رقم #[orderId] تم تسليمه بنجاح. نتمنى لك وجبة شهية! | `delivery_complete` | Order delivered successfully |

## Implementation Details

### Backend Route: `/api/order/update`

The order update route automatically sends notifications when the order status changes:

```javascript
// Send customer notifications based on status changes
if (customer && updateobj?.status) {
  try {
    let notificationTitle = "";
    let notificationBody = "";
    let notificationType = "order";
    
    switch (updateobj.status) {
      case "1": // IN_PROGRESS
        notificationTitle = "طلبك قيد التحضير";
        notificationBody = `طلبك رقم #${order.orderId} قيد التحضير الآن.`;
        break;
      case "2": // COMPLETED
        if (order.order.receipt_method === "TAKEAWAY") {
          notificationTitle = "طلبك جاهز للاستلام";
          notificationBody = `طلبك رقم #${order.orderId} جاهز للاستلام من المطعم.`;
        } else {
          notificationTitle = "طلبك جاهز للتوصيل";
          notificationBody = `طلبك رقم #${order.orderId} تم تحضيره وهو جاهز للتوصيل.`;
        }
        break;
      // ... other cases
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
```

### Notification Types

Different notification types are used for different scenarios:

- `order`: Standard order status updates
- `order_cancelled`: General order cancellation
- `order_rejected`: Order rejection by restaurant
- `order_cancelled_admin`: Cancellation by admin
- `order_cancelled_customer`: Cancellation by customer
- `order_cancelled_driver`: Cancellation by driver
- `delivery_complete`: Order delivered successfully

### Receipt Method Handling

For status `2` (COMPLETED), the system differentiates between:

- **Takeaway**: "طلبك جاهز للاستلام" (Your order is ready for pickup)
- **Delivery**: "طلبك جاهز للتوصيل" (Your order is ready for delivery)

## Testing

### Test Coverage

The comprehensive test suite (`test-order-status-notifications-fixed.js`) covers all 12 status codes:

1. ✅ Order In Progress (1)
2. ✅ Order Completed - Delivery (2)
3. ✅ Order Completed - Takeaway (2)
4. ✅ Waiting For Driver (3)
5. ✅ Order Cancelled (4)
6. ✅ Order Rejected (5)
7. ✅ Order Pending (6)
8. ✅ Order Cancelled By Admin (7)
9. ✅ Order Cancelled By Customer (8)
10. ✅ Order Cancelled By Driver (9)
11. ✅ Order Picked Up (10)
12. ✅ Order Picked Up By Driver (11)
13. ✅ Order Delivered (12)

### Test Results

All tests pass successfully, confirming that:
- ✅ All status codes are handled correctly
- ✅ Arabic notifications are generated properly
- ✅ Different notification types are assigned correctly
- ✅ Receipt method differentiation works for status 2
- ✅ Error handling is robust

## Integration Points

### SMS Integration

The existing SMS system for status 2 (ready) is preserved and works alongside the new notification system.

### WebSocket Integration

WebSocket events are still fired for real-time updates to connected clients.

### App Type Detection

The system automatically detects the correct app type:
- `shoofi-app`: Default customer app
- `shoofi-partner`: Partner/restaurant app  
- `shoofi-shoofir`: Delivery driver app

## Future Considerations

### Potential Enhancements

1. **Customizable Messages**: Allow store owners to customize notification messages
2. **Notification Preferences**: Let customers choose which notifications to receive
3. **Rich Notifications**: Include order details, images, or action buttons
4. **Multi-language Support**: Expand beyond Arabic to other languages
5. **Analytics**: Track notification delivery and engagement rates

### Configuration Options

- Notification templates per store
- Customer notification preferences
- Delivery timing optimization
- A/B testing for different message variations 