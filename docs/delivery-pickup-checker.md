# Delivery Pickup Delay Checker Feature

## Overview

The Delivery Pickup Delay Checker feature automatically monitors delivery orders where the pickup time has passed and sends notifications to both drivers and store managers. This ensures that all parties are alerted when orders are taking longer than expected to be picked up from the restaurant.

## How It Works

1. **Automatic Monitoring**: A cron job runs every 3 minutes to check all delivery orders
2. **Pickup Time Calculation**: Calculates expected pickup time based on order creation time + pickupTime
3. **Smart Filtering**: Only checks orders that are active and haven't been notified yet
4. **Dual Notifications**: Sends notifications to both drivers and store managers
5. **Delay Threshold**: Only notifies if delay is significant (5+ minutes)

## Implementation Details

### Cron Job Schedule
- **Frequency**: Every 3 minutes
- **Pattern**: `*/3 * * * *`

### Distributed Locking
- **Redis Lock Key**: `cron:delivery-pickup-checker`
- **Lock TTL**: 3 minutes
- **Purpose**: Ensures only one server runs the job when scaled to multiple instances

### Logic Flow
1. **Acquire Distributed Lock**: Uses Redis to ensure only one server runs the job
2. **Get Active Orders**: Queries delivery orders with status WAITING_FOR_APPROVE, APPROVED, or COLLECTED_FROM_RESTAURANT
3. **Calculate Pickup Times**: For each order, calculates expected pickup time (created + pickupTime)
4. **Check for Delays**: Compares current time with expected pickup time
5. **Send Notifications**: If delay ≥ 5 minutes:
   - Notifies assigned driver (if active)
   - Notifies store managers
   - Sends WebSocket events
6. **Mark as Notified**: Sets `isPickupDelayNotified: true` to prevent duplicates
7. **Release Lock**: Always releases the lock when job completes or fails

### Order Statuses Checked
- **WAITING_FOR_APPROVE**: Order waiting for driver approval
- **APPROVED**: Driver approved the order
- **COLLECTED_FROM_RESTAURANT**: Driver collected from restaurant

## API Endpoints

### Manual Trigger (Testing)
```
POST /api/store/check-pickup-delays
```
Triggers the delivery pickup delay checker job manually for testing purposes.

## WebSocket Events

When a pickup delay is detected, the following WebSocket events are sent:

### To Admin App (`shoofi-partner`)
```javascript
{
  type: 'pickup_delayed',
  data: {
    orderId: 'order_id',
    bookId: 'ORDER-123',
    expectedPickupTime: '2024-01-01T10:00:00.000Z',
    delayMinutes: 15,
    driverName: 'Driver Name',
    storeName: 'Store Name',
    action: 'pickup_delayed',
    timestamp: '2024-01-01T10:15:00.000Z'
  }
}
```

### To Driver App (`shoofi-shoofir`)
```javascript
{
  type: 'pickup_delayed',
  data: {
    orderId: 'order_id',
    bookId: 'ORDER-123',
    expectedPickupTime: '2024-01-01T10:00:00.000Z',
    delayMinutes: 15,
    storeName: 'Store Name',
    action: 'pickup_delayed',
    timestamp: '2024-01-01T10:15:00.000Z'
  }
}
```

## Notification Content

### Driver Notification
- **Title**: "تأخير في وقت الاستلام" (Pickup Time Delay)
- **Body**: `طلب رقم {bookId} متأخر بـ {delayMinutes} دقيقة عن وقت الاستلام المحدد ({expectedPickupTime}). يرجى التواصل مع المطعم.`
- **Sound**: `driver.wav`

### Store Manager Notification
- **Title**: "تأخير في استلام الطلب" (Order Pickup Delay)
- **Body**: `طلب رقم {bookId} متأخر بـ {delayMinutes} دقيقة عن وقت الاستلام المحدد. يرجى التواصل مع السائق.`
- **Sound**: `storelate.wav`

### Notification Data
```javascript
{
  orderId: 'order_id',
  bookId: 'ORDER-123',
  expectedPickupTime: '2024-01-01T10:00:00.000Z',
  delayMinutes: 15,
  orderStatus: 'APPROVED',
  storeName: 'Store Name',
  driverName: 'Driver Name',
  driverPhone: '050-1234567',
  customerName: 'Customer Name',
  action: 'pickup_delayed'
}
```

## Database Changes

### New Fields Added to bookDelivery Collection
- `isPickupDelayNotified`: Boolean - Prevents duplicate notifications
- `pickupDelayNotifiedAt`: Date - Timestamp when pickup delay notification was sent
- `pickupDelayMinutes`: Number - Number of minutes the pickup was delayed

## Configuration

The feature uses existing delivery configuration:
- `bookDelivery.pickupTime` - Minutes from order creation to expected pickup
- `bookDelivery.created` - Order creation timestamp
- `bookDelivery.driver` - Assigned driver information
- `bookDelivery.appName` - Store app name for notifications

## Benefits

1. **Proactive Alerts**: Notifies drivers and stores before customers complain
2. **Improved Communication**: Ensures both parties are aware of delays
3. **Reduced Manual Monitoring**: Automatically checks all orders every 3 minutes
4. **Smart Filtering**: Only checks relevant orders and significant delays
5. **No Duplicate Notifications**: Prevents notification spam
6. **Real-time Updates**: Immediate notifications via WebSocket and push
7. **Dual Notifications**: Both drivers and store managers are informed

## Monitoring

The cron job logs its activities:
- When it starts and completes
- How many delayed pickups are found
- How many notifications are sent
- Any errors that occur

Logs can be monitored in the application console or log files.

## Testing

To test the feature:
1. Create a delivery order with a `pickupTime` (e.g., 10 minutes)
2. Ensure the order status is one of the active statuses
3. Wait for the pickup time to pass (or manually adjust timestamps)
4. Either wait for the cron job to run (every 3 minutes) or use the manual trigger endpoint
5. Verify notifications are sent to both driver and store

## Integration with Existing Features

This feature works alongside existing delivery management features:

- **Order Creation**: Orders get `pickupTime` when created
- **Status Updates**: Only checks orders in active statuses
- **Driver Assignment**: Notifies assigned drivers
- **Store Management**: Notifies store managers
- **Notification System**: Uses existing notification service
- **WebSocket System**: Uses existing WebSocket service

## Performance Considerations

- **Efficient Queries**: Uses indexed fields (`status`, `pickupTime`, `created`)
- **Batch Processing**: Processes orders one by one to avoid memory issues
- **Error Handling**: Continues processing even if individual orders fail
- **Distributed Locking**: Prevents duplicate processing in multi-server setups
- **Delay Threshold**: Only processes significant delays (5+ minutes)

## Troubleshooting

### Common Issues

#### 1. **No Notifications Sent**
- Check if order status is in active statuses
- Verify `pickupTime` exists and is not null
- Ensure `isPickupDelayNotified` is not already true
- Check if delay is ≥ 5 minutes

#### 2. **Duplicate Notifications**
- Verify `isPickupDelayNotified` flag is being set correctly
- Check Redis lock is working properly

#### 3. **Orders Not Detected**
- Verify `pickupTime` is set correctly
- Check timezone settings
- Ensure order meets all filtering criteria

#### 4. **Driver Not Notified**
- Check if driver is assigned (`order.driver._id`)
- Verify driver is active (`driver.isActive: true`)
- Ensure driver exists in database

### Debug Commands

```bash
# Check Redis lock
redis-cli ttl "cron:delivery-pickup-checker"

# Check delivery orders with pickup times
db.bookDelivery.find({ 
  pickupTime: { $exists: true, $ne: null },
  status: { $in: ["WAITING_FOR_APPROVE", "APPROVED", "COLLECTED_FROM_RESTAURANT"] }
}).sort({ created: -1 }).limit(5)

# Check delayed pickup orders
db.bookDelivery.find({
  pickupTime: { $exists: true, $ne: null },
  status: { $in: ["WAITING_FOR_APPROVE", "APPROVED", "COLLECTED_FROM_RESTAURANT"] },
  isPickupDelayNotified: { $ne: true }
})

# Check pickup delay notifications
db.bookDelivery.find({
  isPickupDelayNotified: true
}).sort({ pickupDelayNotifiedAt: -1 }).limit(10)
```

## Comparison with Order Overdue Checker

| Feature | Order Overdue Checker | Delivery Pickup Checker |
|---------|----------------------|-------------------------|
| **Purpose** | Check store order preparation delays | Check delivery pickup delays |
| **Frequency** | Every 5 minutes | Every 3 minutes |
| **Database** | Store orders collection | Delivery bookDelivery collection |
| **Target Users** | Store managers | Drivers + Store managers |
| **Delay Threshold** | Any delay | 5+ minutes |
| **Status Check** | "1" (IN_PROGRESS) | WAITING_FOR_APPROVE, APPROVED, COLLECTED_FROM_RESTAURANT |
| **Time Field** | `orderDate` | `created + pickupTime` |

## Future Enhancements

1. **Configurable Thresholds**: Allow stores to set custom delay thresholds
2. **Escalation Notifications**: Send additional notifications for longer delays
3. **Customer Notifications**: Optionally notify customers about pickup delays
4. **Analytics**: Track pickup delay patterns and statistics
5. **Integration with Maps**: Show driver location relative to store
6. **Automated Actions**: Automatically reassign orders for long delays 