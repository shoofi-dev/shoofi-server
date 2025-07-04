# Order Route Tests

This directory contains comprehensive tests for the order creation and update routes in the Shoofi server.

## Files

- `test-order-routes.js` - Main test file containing all order route tests
- `run-order-tests.js` - Runner script to execute the tests
- `find-test-users.js` - Helper script to find existing users in database
- `ORDER_TESTS_README.md` - This documentation file

## Test Coverage

The tests cover the following scenarios:

### 1. Order Creation Tests
- **Cash Payment Orders**: Tests order creation with cash payment method
- **Credit Card Payment Orders**: Tests order creation with credit card payment method
- **Store Owner Notifications**: Verifies notifications are sent to store owners when orders are created
- **Database Operations**: Tests proper order insertion and customer data updates

### 2. Order Update Tests
- **Status Updates**: Tests order status changes (viewed, prepared, etc.)
- **Customer Notifications**: Verifies notifications are sent to customers when order status changes
- **Database Updates**: Tests proper order document updates

### 3. Notification System Tests
- **Multi-Channel Notifications**: Tests websocket, push, email, and SMS notifications
- **App Type Support**: Tests notifications across different app types (shoofi-app, shoofi-shoofir, shoofi-partner)
- **Database Verification**: Verifies notifications are properly stored in the database

### 4. Database Integration Tests
- **Database Initialization**: Tests proper database and collection setup
- **Customer Lookup**: Tests customer retrieval across different app types
- **Store User Management**: Tests store user creation and notification delivery

## Prerequisites

1. **MongoDB**: Ensure MongoDB is running on `localhost:27017`
2. **Dependencies**: All required npm packages should be installed
3. **Environment**: Node.js environment should be properly configured
4. **Existing Data**: The test expects existing customers and store users in the database
   - Update `customerId` in `testData` to match an existing customer
   - Update `appName` in `testData.orderDoc.appName` to match an existing store

## Running the Tests

### Method 1: Direct Execution
```bash
node test-order-routes.js
```

### Method 2: Using Runner Script
```bash
node run-order-tests.js
```

### Method 3: With npm script (if added to package.json)
```bash
npm run test:orders
```

## Test Output

The tests provide detailed console output including:

- ✅ Success indicators for each test step
- ❌ Error indicators with detailed error messages
- 📊 Database operation results
- 🔔 Notification delivery status
- 📋 Summary of all operations performed

## Expected Test Results

When running successfully, you should see:

1. **Database Connection**: Successful MongoDB connection
2. **Test Data Setup**: Customer and store user creation
3. **Order Creation**: Successful order insertion for both payment methods
4. **Notifications**: Successful notification delivery to store owners and customers
5. **Order Updates**: Successful order status updates
6. **Verification**: Confirmation of notifications stored in database

## Troubleshooting

### Common Issues

1. **MongoDB Connection Failed**
   - Ensure MongoDB is running: `mongod`
   - Check connection string in test file

2. **Database Initialization Failed**
   - Verify DatabaseInitializationService is properly configured
   - Check database permissions

3. **Notification Service Errors**
   - Verify notification service dependencies are installed
   - Check notification service configuration

4. **Customer Lookup Failed**
   - Verify customer data exists in the correct database
   - Check app type configuration
   - Update `customerId` in test data to match existing customer
   - Ensure customer exists in the correct database (shoofi, delivery-company, etc.)

5. **Store User Not Found**
   - Verify store users exist for the specified app name
   - Update `orderDoc.appName` to match existing store
   - Check that store users are in the `shoofi` database

### Debug Mode

To run tests with additional debugging information, modify the test file to include more detailed logging:

```javascript
// Add this at the top of testOrderRoutes function
const debug = true;
if (debug) {
  console.log('Debug mode enabled');
  // Add more detailed logging throughout the test
}
```

## Integration with Main Application

These tests are designed to work with the main Shoofi server application. They use the same:

- Database initialization service
- Notification service
- Customer lookup logic
- Order processing logic

## Extending the Tests

To add new test scenarios:

1. Add new test functions to `testOrderRoutes()`
2. Follow the existing pattern of setup, execution, and verification
3. Include proper error handling and logging
4. Update this README with new test descriptions

## Test Data

The tests use the following test data:

- **Customer ID**: `68657025ffc6f39f4ad6b389` (must exist in database)
- **Store User ID**: `test-store-user-id` (must exist in database)
- **App Name**: `nnn` (must match existing store)
- **Test Order**: Complete order document with items, address, and payment info

**Important**: Before running tests, update these values to match existing data in your database:
1. Set `customerId` to an existing customer ID
2. Set `orderDoc.appName` to an existing store app name
3. Ensure the store has associated store users in the `shoofi` database

### Finding Existing Data

You can use the helper script to find existing users:

```bash
node find-test-users.js
```

Or run these MongoDB queries manually:

```javascript
// Find customers in shoofi database
db.customers.find({}, {_id: 1, fullName: 1, phone: 1}).limit(5)

// Find store users for a specific app
db.storeUsers.find({appName: "your-app-name"}, {_id: 1, fullName: 1, appName: 1})

// Find all stores
db.stores.find({}, {appName: 1, storeName: 1})
```

## Cleanup

The tests create test data in the database. In a production environment, you may want to add cleanup logic to remove test data after tests complete.

## Contributing

When adding new tests:

1. Follow the existing code structure and patterns
2. Include comprehensive error handling
3. Add detailed logging for debugging
4. Update this documentation
5. Test thoroughly before committing
