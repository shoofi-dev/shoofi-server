# Order Overdue Checker Feature

## Overview

The Order Overdue Checker feature automatically monitors orders that have passed their `orderDate` (when they should be ready) and sends notifications to store managers. This ensures that stores are alerted when orders are taking longer than expected to prepare.

## How It Works

1. **Automatic Monitoring**: A cron job runs every 5 minutes to check all stores
2. **Order Date Comparison**: Compares current time with each order's `orderDate`
3. **Smart Filtering**: Only checks orders that are approved (`isViewd: true`) and still in progress
4. **One-time Notifications**: Prevents duplicate notifications using `isOverdueNotified` flag
5. **Store Status Check**: Only checks orders for stores that are currently open

## Implementation Details

### Cron Job Schedule
- **Frequency**: Every 5 minutes
- **Pattern**: `*/5 * * * *`

### Distributed Locking
- **Redis Lock Key**: `cron:order-overdue-checker`
- **Lock TTL**: 5 minutes
- **Purpose**: Ensures only one server runs the job when scaled to multiple instances

### Logic Flow
1. **Acquire Distributed Lock**: Uses Redis to ensure only one server runs the job
2. **Get All Stores**: Queries the `shoofi` database's `stores` collection
3. **Filter Active Stores**: Only processes stores that are currently open (`isOpen: true`)
4. **Find Overdue Orders**: Searches for orders where:
   - `orderDate < currentTime` (order should be ready)
   - `status` is "1" (IN_PROGRESS) or "3" (WAITING_FOR_DRIVER)
   - `isViewd: true` (order has been approved by store)
   - `isOverdueNotified: { $ne: true }` (not already notified)
5. **Send Notifications**: Notifies all active store users for each overdue order
6. **Mark as Notified**: Sets `isOverdueNotified: true` to prevent duplicate notifications
7. **Release Lock**: Always releases the lock when job completes or fails

### Order Statuses Checked
- **"1"**: IN_PROGRESS - Order is being prepared
- **"3"**: WAITING_FOR_DRIVER - Order is ready, waiting for delivery driver

## API Endpoints

### Manual Trigger (Testing)
```
POST /api/store/check-overdue-orders
```
Triggers the overdue order checker job manually for testing purposes.

## WebSocket Events

When an overdue order is detected, the following WebSocket event is sent:

### To Admin App (`shoofi-partner`)
```javascript
{
  type: 'order_overdue',
  data: {
    orderId: 'order_id',
    orderNumber: 'ORDER-123',
    customerName: 'Customer Name',
    overdueMinutes: 15,
    receiptMethod: 'توصيل', // or 'استلام'
    action: 'order_overdue',
    timestamp: '2024-01-01T10:30:00.000Z'
  }
}
```

## Notification Content

### Push/WebSocket Notification
- **Title**: "طلب متأخر" (Order Overdue)
- **Body**: `طلب رقم {orderNumber} من {customerName} متأخر بـ {overdueMinutes} دقيقة ({receiptMethod})`
- **Sound**: `store.wav`

### Notification Data
```javascript
{
  orderId: 'order_id',
  orderNumber: 'ORDER-123',
  customerName: 'Customer Name',
  overdueMinutes: 15,
  receiptMethod: 'توصيل', // or 'استلام'
  orderDate: '2024-01-01T10:00:00.000Z',
  currentTime: '2024-01-01T10:15:00.000Z',
  action: 'order_overdue'
}
```

## Database Changes

### New Fields Added to Orders Collection
- `isOverdueNotified`: Boolean - Prevents duplicate notifications
- `overdueNotifiedAt`: Date - Timestamp when overdue notification was sent

## Configuration

The feature uses existing store configuration:
- `store.isOpen` - Current open/closed status
- `storeUsers.isActive` - Active store users to notify

## Benefits

1. **Proactive Alerts**: Notifies stores before customers complain
2. **Improved Customer Experience**: Helps stores manage order preparation times
3. **Reduced Manual Monitoring**: Automatically checks all stores every 5 minutes
4. **Smart Filtering**: Only checks relevant orders and active stores
5. **No Duplicate Notifications**: Prevents notification spam
6. **Real-time Updates**: Immediate notifications via WebSocket and push

## Monitoring

The cron job logs its activities:
- When it starts and completes
- Which stores are processed
- How many overdue orders are found
- How many notifications are sent
- Any errors that occur

Logs can be monitored in the application console or log files.

## Testing

To test the feature:
1. Create an order with an `orderDate` in the past
2. Ensure the order status is "1" or "3" and `isViewd: true`
3. Ensure the store is open (`isOpen: true`)
4. Either wait for the cron job to run (every 5 minutes) or use the manual trigger endpoint
5. Verify the overdue notification is sent to store users

## Integration with Existing Features

This feature works alongside existing order management features:

- **Order Creation**: Orders get `orderDate` when approved
- **Status Updates**: Only checks orders in progress
- **Store Management**: Respects store open/closed status
- **Notification System**: Uses existing notification service
- **WebSocket System**: Uses existing WebSocket service

## Performance Considerations

- **Efficient Queries**: Uses indexed fields (`orderDate`, `status`, `isViewd`)
- **Batch Processing**: Processes stores one by one to avoid memory issues
- **Error Handling**: Continues processing even if individual orders fail
- **Distributed Locking**: Prevents duplicate processing in multi-server setups

## Troubleshooting

### Common Issues

#### 1. **No Notifications Sent**
- Check if store is open (`isOpen: true`)
- Verify order status is "1" or "3"
- Ensure `isViewd: true` on the order
- Check if `isOverdueNotified` is not already true

#### 2. **Duplicate Notifications**
- Verify `isOverdueNotified` flag is being set correctly
- Check Redis lock is working properly

#### 3. **Orders Not Detected**
- Verify `orderDate` is in the past
- Check timezone settings
- Ensure order meets all filtering criteria

### Debug Commands

```bash
# Check Redis lock
redis-cli ttl "cron:order-overdue-checker"

# Check order dates
db.orders.find({ orderDate: { $lt: new Date() } }).sort({ orderDate: -1 }).limit(5)

# Check overdue orders
db.orders.find({
  orderDate: { $lt: new Date() },
  status: { $in: ["1", "3"] },
  isViewd: true,
  isOverdueNotified: { $ne: true }
})
``` 