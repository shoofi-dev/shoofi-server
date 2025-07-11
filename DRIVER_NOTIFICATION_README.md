# Driver Notification System

This document describes the driver notification functionality that was added to the order update system.

## Overview

When an order status is updated to "3" (WAITING_FOR_DRIVER), the system now automatically sends a notification to the assigned driver informing them that the order is ready for pickup.

## Implementation Details

### Location
The driver notification logic is implemented in `routes/order.js` in the order update route (`/api/order/update`).

### Trigger Conditions
The driver notification is sent when:
1. Order status is updated to "3" (WAITING_FOR_DRIVER)
2. Order receipt method is "DELIVERY"
3. A delivery record exists for the order
4. A driver is assigned to the delivery

### Database Updates
When the notification is sent, the delivery record is also updated with:
- `isReadyForPickup: true` - Flag indicating the order is ready for pickup
- `readyForPickupAt: Date` - Timestamp when the order became ready for pickup

### Notification Content
- **Title**: "طلب جاهز للاستلام" (Order Ready for Pickup)
- **Body**: "طلب رقم #[orderId] جاهز للاستلام من المطعم." (Order #[orderId] is ready for pickup from the restaurant)
- **Type**: "order_ready_pickup"
- **App Type**: "shoofi-shoofir" (delivery driver app)

### Data Included
The notification includes the following data:
- `orderId`: The order's internal ID
- `bookId`: The order's public ID
- `orderStatus`: The current order status ("3")
- `customerName`: Customer's full name
- `customerPhone`: Customer's phone number
- `storeName`: Restaurant/store name
- `isReadyForPickup`: Boolean flag indicating the order is ready for pickup

### Delivery Channels
- **WebSocket**: ✅ Enabled for real-time notifications
- **Push**: ✅ Enabled for mobile push notifications
- **Email**: ❌ Disabled
- **SMS**: ❌ Disabled

## Database Integration

### Order Flow
1. Order is created in the main app database (e.g., `shoofi-app`)
2. When order is ready for delivery, a delivery record is created in `delivery-company` database
3. Driver is assigned to the delivery record
4. When order status becomes "3", the system:
   - Finds the delivery record using `bookId` (which matches `orderId`)
   - Retrieves the assigned driver information
   - Sends notification to the driver

### Database Collections Used
- **Main App Database**: `orders` collection
- **Delivery Database**: `bookDelivery` collection (for driver assignment)
- **Delivery Database**: `customers` collection (for driver information)
- **Delivery Database**: `notifications` collection (for storing notifications)

### Database Schema Changes
The `bookDelivery` collection now includes additional fields:
- `isReadyForPickup` (Boolean): Indicates if the order is ready for pickup
- `readyForPickupAt` (Date): Timestamp when the order became ready for pickup

## Code Implementation

```javascript
// Send driver notification when order is ready for pickup (status = "3")
if (updateobj?.status === "3" && order.order.receipt_method === "DELIVERY") {
  try {
    // Find the delivery record for this order
    const deliveryDB = req.app.db["delivery-company"];
    const deliveryRecord = await deliveryDB.bookDelivery.findOne({
      bookId: order.orderId
    });

    if (deliveryRecord && deliveryRecord.driver?._id) {
      // Update delivery record to mark it as ready for pickup
      await deliveryDB.bookDelivery.updateOne(
        { bookId: order.orderId },
        { 
          $set: { 
            isReadyForPickup: true,
            readyForPickupAt: new Date()
          }
        }
      );

      // Send notification to the assigned driver
      await notificationService.sendNotification({
        recipientId: String(deliveryRecord.driver._id),
        title: "طلب جاهز للاستلام",
        body: `طلب رقم #${order.orderId} جاهز للاستلام من المطعم.`,
        type: "order_ready_pickup",
        appName: "delivery-company",
        appType: "shoofi-shoofir",
        channels: {
          websocket: true,
          push: true,
          email: false,
          sms: false
        },
        data: {
          orderId: order._id,
          bookId: order.orderId,
          orderStatus: updateobj.status,
                      customerName: customer?.fullName || "العميل",
            customerPhone: customer?.phone || "",
            storeName: order.storeName || "المطعم",
            isReadyForPickup: true
          },
          req: req
        });
    }
  } catch (driverNotificationError) {
    console.error("Failed to send driver notification:", driverNotificationError);
    // Don't fail the order update if driver notification fails
  }
}
```

## Error Handling

- If the delivery record is not found, no notification is sent
- If no driver is assigned, no notification is sent
- If notification sending fails, the error is logged but the order update continues
- The order update process is not affected by notification failures

## Testing

A test file `test-driver-notification.js` has been created to verify the functionality:

```bash
# Run the driver notification test
node test-driver-notification.js
```

The test:
1. Creates test customer, driver, order, and delivery record
2. Updates order status to "3"
3. Verifies that driver notification is sent
4. Checks that notification is saved to database
5. Cleans up test data

## Integration with Existing Systems

### Order Status Flow
1. **Status "1"**: Order in progress (customer notified)
2. **Status "2"**: Order completed (customer notified)
3. **Status "3"**: Waiting for driver (customer + driver notified) ⭐ **NEW**
4. **Status "4"**: Order cancelled (customer notified)

### Delivery System Integration
- Works with existing delivery assignment system
- Uses the same notification service as other delivery notifications
- Compatible with existing driver app (`shoofi-shoofir`)

## Benefits

1. **Improved Driver Experience**: Drivers are immediately notified when orders are ready
2. **Faster Pickup**: Reduces time between order completion and driver pickup
3. **Better Customer Service**: Faster delivery times
4. **Automated Process**: No manual intervention required
5. **Consistent Notifications**: Uses the same notification infrastructure as other parts of the system

## Future Enhancements

Potential improvements that could be added:
- Notification sound customization for driver notifications
- Priority levels for urgent orders
- Batch notifications for multiple ready orders
- Driver location-based notifications
- Notification acknowledgment tracking 