# Arabic Notification Texts Summary

This document summarizes all the Arabic notification texts that have been updated in the Shoofi server.

## Order-Related Notifications

### Store Owner Notifications
- **Title**: "طلب جديد تم استلامه" (New Order Received)
- **Body**: "طلب جديد رقم #[orderId] بمبلغ [total]₪" (New order #[orderId] received for [total]₪)

### Customer Notifications
- **Title**: "تم استلام طلبك" (Your Order Received)
- **Body**: "طلبك رقم #[orderId] تم استلامه وهو قيد المعالجة" (Your order #[orderId] has been received and is being processed)

### Order Status Updates
- **Title**: "تحديث حالة الطلب" (Order Status Update)
- **Body**: "طلبك قيد التحضير الآن" (Your order is now being prepared)

### Order Ready
- **Title**: "الطلب جاهز" (Order Ready)
- **Body**: "طلبك جاهز للاستلام/التوصيل" (Your order is ready for pickup/delivery)

## Test Notifications

### Test Notifications
- **Title**: "إشعار تجريبي" (Test Notification)
- **Body**: "هذا إشعار تجريبي للتحقق من عمل النظام" (This is a test notification to verify the system works)

### Sample Notifications
- **Body**: "هذا إشعار تجريبي لاختبار النظام" (This is a sample notification to test the system)

## Files Updated

1. **routes/order.js**
   - Store owner notifications
   - Customer order notifications

2. **test-order-routes.js**
   - Store owner notifications
   - Customer status update notifications

3. **test-order-notifications.js**
   - All test notification texts
   - Order status notifications
   - Order ready notifications

4. **test-notifications.js**
   - Test notification texts

5. **bin/test-notifications.js**
   - Test notification texts

6. **utils/migrations/create-notifications-collection.js**
   - Sample notification text

## Usage

These Arabic notification texts are now used throughout the system for:
- Order creation notifications to store owners
- Order status updates to customers
- Test notifications during development
- Sample notifications in migrations

## Notes

- All notification texts are now in Arabic
- The texts maintain the same functionality while being localized
- Dynamic content (order IDs, amounts) is still inserted into the Arabic text
- The notification system supports both Arabic and English content
