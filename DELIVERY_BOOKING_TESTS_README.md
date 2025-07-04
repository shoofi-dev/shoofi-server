# Delivery Booking Tests

This document describes the comprehensive test suite for delivery booking functionality, including driver assignment, notifications, and status updates.

## Overview

The delivery booking tests verify the complete delivery workflow from order creation to completion, including:

- ✅ **Database initialization** using `DatabaseInitializationService`
- ✅ **Test data creation** (cities, areas, companies, drivers, customers)
- ✅ **Delivery booking** with driver assignment
- ✅ **Notification sending** to drivers
- ✅ **Status updates** (pending → approved → delivered)
- ✅ **Edge cases** and error handling
- ✅ **Statistics and reporting**

## Test Files

### 1. `test-delivery-booking.js`
Main test file containing all delivery booking test functions.

### 2. `test-delivery-booking-runner.js`
Test runner script with proper error handling and colored output.

## Test Configuration

```js
const TEST_CONFIG = {
  MONGODB_URI: 'mongodb://localhost:27017',
  TEST_DRIVER_ID: '68337db5176dbd5c5e15eea2',
  TEST_CUSTOMER_ID: '507f1f77bcf86cd799439012',
  TEST_ORDER_ID: '507f1f77bcf86cd799439013',
  TEST_COMPANY_ID: '507f1f77bcf86cd799439014',
  TEST_AREA_ID: '507f1f77bcf86cd799439015',
  TEST_CITY_ID: '507f1f77bcf86cd799439016'
};
```

## Running the Tests

### Prerequisites
1. MongoDB running on `localhost:27017`
2. Node.js and npm installed
3. Required dependencies installed

### Method 1: Using the Test Runner
```bash
# Make executable (if not already)
chmod +x test-delivery-booking-runner.js

# Run tests
./test-delivery-booking-runner.js
```

### Method 2: Direct Node Execution
```bash
node test-delivery-booking.js
```

## Expected Output

```
🚀 Starting Delivery Booking Tests...

✅ Connected to MongoDB
✅ Databases initialized using DatabaseInitializationService
✅ Available databases: ['delivery-company', 'shoofi', 'test-store']
✅ Test data cleaned up
✅ Test city created: تل أبيب
✅ Test area created: منطقة وسط المدينة
✅ Test delivery company created: شركة التوصيل السريع
✅ Test driver created: أحمد محمد
✅ Test customer created: فاطمة علي

🚚 Testing Delivery Booking...

📦 Test 1: Basic delivery booking
✅ Delivery booking successful
   - Delivery ID: ...
   - Book ID: ...
✅ Delivery record found in database
   - Status: 1
   - Driver: أحمد محمد
   - Company: شركة التوصيل السريع
   - Area: منطقة وسط المدينة
   - Expected Delivery: ...

📱 Test 2: Checking driver notification
✅ Driver notification found
   - Title: تم تعيين طلب جديد
   - Body: لقد تم تعيينك للطلب: #...
   - Type: order
   - Data: { ... }

🔄 Test 3: Testing delivery status update
✅ Delivery status updated successfully
✅ Status update notification sent

✅ Test 4: Testing delivery completion
✅ Delivery completed successfully
✅ Completion notification sent

✅ All delivery booking tests passed!

🚫 Testing Delivery Booking - No Available Drivers...

📦 Test: Delivery booking with no available drivers
✅ Correctly handled no available drivers
   - Message: No available driver found for this location

✅ No drivers test completed!

🔍 Testing Delivery Booking Edge Cases...

📦 Test 1: Missing required fields
✅ Correctly handled invalid delivery data
   - Error: ...

📦 Test 2: Invalid location coordinates
✅ Correctly handled invalid location
   - Message: ...

📦 Test 3: Very short pickup time
✅ Successfully handled short pickup time
   - Pickup time: 1 minutes

✅ All edge case tests completed!

📊 Testing Delivery Statistics...

📊 Test 1: Delivery counts
✅ Delivery statistics:
   - Total deliveries: ...
   - Pending deliveries: ...
   - Completed deliveries: ...
   - Cancelled deliveries: ...

📊 Test 2: Driver performance
✅ Driver performance:
   - Status 0: ... orders, ... total value

📊 Test 3: Company performance
✅ Company performance:
   - Status 0: ... orders, ... avg price

✅ All statistics tests completed!

🎉 All delivery booking tests completed successfully!
✅ Database connection closed
```

## What is Covered
- Delivery booking with valid and invalid data
- Driver assignment and notification
- Status management (pending, approved, delivered)
- Edge cases (no drivers, invalid data)
- Statistics and reporting

## Troubleshooting
- Ensure MongoDB is running and accessible
- Check for correct Node.js version and dependencies
- Review console output for error details

---

For any issues or to extend the tests, edit `test-delivery-booking.js` and follow the existing structure.
