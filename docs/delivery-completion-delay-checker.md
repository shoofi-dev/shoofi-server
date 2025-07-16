# Delivery Completion Delay Checker Feature

## Overview

The Delivery Completion Delay Checker feature automatically monitors delivery orders where the `expectedDeliveryAt` time has passed and sends notifications to both drivers and store managers. This ensures that all parties are alerted when orders are taking longer than expected to be delivered to the customer.

## How It Works

1. **Automatic Monitoring**: A cron job runs every 4 minutes to check all delivery orders
2. **Expected Delivery Time Check**: Compares current time with each order's `expectedDeliveryAt`
3. **Smart Filtering**: Only checks orders that are active and haven't been notified yet
4. **Dual Notifications**: Sends notifications to both drivers and store managers
5. **Delay Threshold**: Only notifies if delay is significant (5+ minutes)

## Implementation Details

### Cron Job Schedule
- **Frequency**: Every 4 minutes
- **Pattern**: `*/4 * * * *`

### Distributed Locking
- **Redis Lock Key**: `cron:delivery-completion-delay-checker`
- **Lock TTL**: 4 minutes
- **Purpose**: Ensures only one server runs the job when scaled to multiple instances

### Logic Flow
1. **Acquire Distributed Lock**: Uses Redis to ensure only one server runs the job
2. **Get Active Orders**: Queries delivery orders with status COLLECTED_FROM_RESTAURANT or APPROVED
3. **Check for Delays**: Compares current time with `expectedDeliveryAt`
4. **Send Notifications**: If delay ≥ 5 minutes:
   - Notifies assigned driver (if active)
   - Notifies store managers
   - Sends WebSocket events
5. **Mark as Notified**: Sets `isDeliveryDelayNotified: true` to prevent duplicates
6. **Release Lock**: Always releases the lock when job completes or fails

### Order Statuses Checked
- **COLLECTED_FROM_RESTAURANT**: Driver collected from restaurant
- **APPROVED**: Driver approved the order

## API Endpoints

### Manual Trigger (Testing)
```
POST /api/store/check-delivery-completion-delays
```
Triggers the delivery completion delay checker job manually for testing purposes.

## WebSocket Events

When a delivery delay is detected, the following WebSocket events are sent:

### To Admin App (`shoofi-partner`)
```javascript
{
  type: 'delivery_delayed',
  data: {
    orderId: 'order_id',
    bookId: 'ORDER-123',
    expectedDeliveryAt: '2024-01-01T10:00:00.000Z',
    delayMinutes: 15,
    driverName: 'Driver Name',
    storeName: 'Store Name',
    action: 'delivery_delayed',
    timestamp: '2024-01-01T10:15:00.000Z'
  }
}
```

### To Driver App (`shoofi-shoofir`)
```javascript
{
  type: 'delivery_delayed',
  data: {
    orderId: 'order_id',
    bookId: 'ORDER-123',
    expectedDeliveryAt: '2024-01-01T10:00:00.000Z',
    delayMinutes: 15,
    storeName: 'Store Name',
    action: 'delivery_delayed',
    timestamp: '2024-01-01T10:15:00.000Z'
  }
}
```

## Notification Content

### Driver Notification
- **Title**: "تأخير في تسليم الطلب" (Delivery Delay)
- **Body**: `طلب رقم {bookId} متأخر بـ {delayMinutes} دقيقة عن وقت التسليم المتوقع ({expectedDeliveryAt}). يرجى التواصل مع العميل وتسليم الطلب في أقرب وقت ممكن.`
- **Sound**: `driver.wav`

### Store Manager Notification
- **Title**: "تأخير في تسليم الطلب" (Delivery Delay)
- **Body**: `طلب رقم {bookId} متأخر بـ {delayMinutes} دقيقة عن وقت التسليم المتوقع. يرجى التواصل مع السائق.`
- **Sound**: `storelate.wav`

### Notification Data
```javascript
{
  orderId: 'order_id',
  bookId: 'ORDER-123',
  expectedDeliveryAt: '2024-01-01T10:00:00.000Z',
  delayMinutes: 15,
  orderStatus: 'COLLECTED_FROM_RESTAURANT',
  storeName: 'Store Name',
  driverName: 'Driver Name',
  driverPhone: '050-1234567',
  customerName: 'Customer Name',
  action: 'delivery_delayed'
}
```

## Database Changes

### New Fields Added to bookDelivery Collection
- `isDeliveryDelayNotified`: Boolean - Prevents duplicate notifications
- `deliveryDelayNotifiedAt`: Date - Timestamp when delivery delay notification was sent
- `deliveryDelayMinutes`: Number - Number of minutes the delivery was delayed

## Configuration

The feature uses existing delivery configuration:
- `bookDelivery.expectedDeliveryAt` - Expected delivery timestamp
- `bookDelivery.driver` - Assigned driver information
- `bookDelivery.appName` - Store app name for notifications

## Benefits

1. **Proactive Alerts**: Notifies drivers and stores before customers complain
2. **Improved Communication**: Ensures both parties are aware of delays
3. **Reduced Manual Monitoring**: Automatically checks all orders every 4 minutes
4. **Smart Filtering**: Only checks relevant orders and significant delays
5. **No Duplicate Notifications**: Prevents notification spam
6. **Real-time Updates**: Immediate notifications via WebSocket and push
7. **Dual Notifications**: Both drivers and store managers are informed

## Monitoring

The cron job logs its activities:
- When it starts and completes
- How many delayed deliveries are found
- How many notifications are sent
- Any errors that occur

Logs can be monitored in the application console or log files.

## Testing

To test the feature:
1. Create a delivery order with an `expectedDeliveryAt` in the past
2. Ensure the order status is one of the active statuses
3. Either wait for the cron job to run (every 4 minutes) or use the manual trigger endpoint
4. Verify notifications are sent to both driver and store

## Integration with Existing Features

This feature works alongside existing delivery management features:

- **Order Creation**: Orders get `expectedDeliveryAt` when created
- **Status Updates**: Only checks orders in active statuses
- **Driver Assignment**: Notifies assigned drivers
- **Store Management**: Notifies store managers
- **Notification System**: Uses existing notification service
- **WebSocket System**: Uses existing WebSocket service

## Performance Considerations

- **Efficient Queries**: Uses indexed fields (`status`, `expectedDeliveryAt`)
- **Batch Processing**: Processes orders one by one to avoid memory issues
- **Error Handling**: Continues processing even if individual orders fail
- **Distributed Locking**: Prevents duplicate processing in multi-server setups
- **Delay Threshold**: Only processes significant delays (5+ minutes)

## Troubleshooting

### Common Issues

#### 1. **No Notifications Sent**
- Check if order status is in active statuses
- Verify `expectedDeliveryAt` exists and is not null
- Ensure `isDeliveryDelayNotified` is not already true
- Check if delay is ≥ 5 minutes

#### 2. **Duplicate Notifications**
- Verify `isDeliveryDelayNotified` flag is being set correctly
- Check Redis lock is working properly

#### 3. **Orders Not Detected**
- Verify `expectedDeliveryAt` is set correctly
- Check timezone settings
- Ensure order meets all filtering criteria

#### 4. **Driver Not Notified**
- Check if driver is assigned (`order.driver._id`)
- Verify driver is active (`driver.isActive: true`)
- Ensure driver exists in database

### Debug Commands

```bash
# Check Redis lock
redis-cli ttl "cron:delivery-completion-delay-checker"

# Check delivery orders with expected delivery times
db.bookDelivery.find({ 
  expectedDeliveryAt: { $exists: true, $ne: null },
  status: { $in: ["COLLECTED_FROM_RESTAURANT", "APPROVED"] }
}).sort({ expectedDeliveryAt: -1 }).limit(5)

# Check delayed delivery orders
db.bookDelivery.find({
  expectedDeliveryAt: { $exists: true, $ne: null, $lt: new Date() },
  status: { $in: ["COLLECTED_FROM_RESTAURANT", "APPROVED"] },
  isDeliveryDelayNotified: { $ne: true }
})

# Check delivery delay notifications
db.bookDelivery.find({
  isDeliveryDelayNotified: true
}).sort({ deliveryDelayNotifiedAt: -1 }).limit(10)
``` 