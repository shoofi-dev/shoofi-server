# Order Notification Test

This test file verifies that the notification service is working correctly with order data.

## Prerequisites

1. **MongoDB**: Make sure MongoDB is running locally on port 27017
2. **Database Setup**: Ensure you have the following databases:
   - `nnn` (for the test app)
   - `shoofi` (for global settings)

## Test Data

The test uses the following data:
- **Customer ID**: `68657025ffc6f39f4ad6b389`
- **Order ID**: `7837-688740-4643`
- **App Name**: `nnn`

## Running the Test

### Option 1: Using the runner script
```bash
node run-notification-test.js
```

### Option 2: Running directly
```bash
node test-order-notifications.js
```

## What the Test Does

1. **Customer Verification by App Type**: Checks if the test customer exists in the correct database based on app type:
   - `shoofi-app`: Uses `shoofi` database, `customers` collection
   - `shoofi-shoofir`: Uses `delivery-company` database, `customers` collection  
   - `shoofi-partner`: Uses `shoofi` database, `storeUsers` collection
2. **Direct Notification Service Test**: Tests the notification service directly for each app type
3. **Order Notification Function Test**: Tests the `sendOrderNotifications` function
4. **Database Verification**: Checks if notifications were saved to all relevant databases
5. **Multiple Notification Types**: Tests different types of notifications for each app type

## Expected Output

```
🚀 Starting Order Notification Tests...

✅ Connected to MongoDB

🔍 Test 1: Checking if customer exists using app type logic...

  Testing app type: shoofi-app
    ✅ Customer found in customers: Test Customer (shoofi-app)

  Testing app type: shoofi-shoofir
    ❌ Customer not found in customers. Creating test customer...
    ✅ Test customer created in customers

  Testing app type: shoofi-partner
    ❌ Customer not found in storeUsers. Creating test customer...
    ✅ Test customer created in storeUsers

🔔 Test 2: Testing notification service for each app type...

  Testing notifications for app type: shoofi-app
    ✅ Notification sent successfully for shoofi-app: 507f1f77bcf86cd799439011

  Testing notifications for app type: shoofi-shoofir
    ✅ Notification sent successfully for shoofi-shoofir: 507f1f77bcf86cd799439012

  Testing notifications for app type: shoofi-partner
    ✅ Notification sent successfully for shoofi-partner: 507f1f77bcf86cd799439013

📦 Test 3: Testing sendOrderNotifications function...
✅ sendOrderNotifications executed successfully

📋 Test 4: Checking notifications in all databases...

  Checking shoofi database...
    ✅ Found 2 notifications in shoofi
      1. Order Received: Your order #7837-688740-4643 has been received...
      2. Order Status Update: Your order is now being prepared...

  Checking delivery-company database...
    ✅ Found 1 notifications in delivery-company
      1. Order Received: Your order #7837-688740-4643 has been received...

🎯 Test 5: Testing different notification types for each app type...

  Testing notification types for app type: shoofi-app
    ✅ order_status notification sent for shoofi-app
    ✅ order_ready notification sent for shoofi-app

  Testing notification types for app type: shoofi-shoofir
    ✅ order_status notification sent for shoofi-shoofir
    ✅ order_ready notification sent for shoofi-shoofir

  Testing notification types for app type: shoofi-partner
    ✅ order_status notification sent for shoofi-partner
    ✅ order_ready notification sent for shoofi-partner

🎉 All tests completed!
🔌 MongoDB connection closed
```

## Troubleshooting

### Customer Not Found
If you see "Customer not found", the test will automatically create a test customer with the following details:
- Name: "Test Customer"
- Phone: "+972501234567"
- Email: "test@example.com"
- Notification Token: "ExponentPushToken[test-token-123]"

### Database Connection Issues
Make sure MongoDB is running:
```bash
# Start MongoDB (if using Docker)
docker run -d -p 27017:27017 mongo:latest

# Or start MongoDB service
sudo systemctl start mongod
```

### Missing Dependencies
Install required dependencies:
```bash
npm install
```

## Test Configuration

You can modify the test data in `test-order-notifications.js`:

```javascript
const testData = {
  customerId: "your-customer-id",
  orderDoc: {
    // Your order data
  }
};
```

## Notification Channels Tested

- ✅ WebSocket notifications
- ✅ Push notifications (Expo/Firebase)
- ✅ SMS notifications
- ⚠️ Email notifications (disabled by default)

## Cleanup

The test doesn't automatically clean up the test customer or notifications. To clean up manually:

```javascript
// In MongoDB shell or your app
db.customers.deleteOne({ _id: ObjectId("68657025ffc6f39f4ad6b389") });
db.notifications.deleteMany({ recipientId: ObjectId("68657025ffc6f39f4ad6b389") });
``` 