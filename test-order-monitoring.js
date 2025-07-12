const centralizedFlowMonitor = require('./services/monitoring/centralized-flow-monitor');
const { MongoClient } = require('mongodb');

async function testOrderMonitoring() {
  // Initialize database connection for testing
  const client = new MongoClient(process.env.DATABASE_CONNECTION_STRING || 'mongodb://127.0.0.1:27017', {
    useUnifiedTopology: true
  });
  
  try {
    await client.connect();
    
    // Set up global app.db for the monitoring service
    global.app = {
      db: {
        'shoofi': client.db('shoofi')
      }
    };
    console.log('🧪 Testing Order Flow Monitoring System...\n');

    // Test 1: Track order creation
    console.log('1. Testing order creation tracking...');
    await centralizedFlowMonitor.trackOrderFlowEvent({
      orderId: 'test-order-123',
      orderNumber: 'ORD-2024-001',
      sourceApp: 'shoofi-app',
      eventType: 'order_created',
      status: '0',
      actor: 'Test Customer',
      actorId: 'customer-123',
      actorType: 'customer',
      metadata: {
        receiptMethod: 'DELIVERY',
        totalAmount: 150.50,
        itemsCount: 3
      }
    });
    console.log('✅ Order creation tracked successfully');

    // Test 2: Track order status change
    console.log('\n2. Testing order status change tracking...');
    await centralizedFlowMonitor.trackOrderFlowEvent({
      orderId: 'test-order-123',
      orderNumber: 'ORD-2024-001',
      sourceApp: 'shoofi-partner',
      eventType: 'status_change',
      status: '1',
      actor: 'Store Manager',
      actorId: 'store-user-456',
      actorType: 'store',
      metadata: {
        previousStatus: '0',
        statusChange: '0 → 1',
        updateReason: 'Order confirmed and preparation started'
      }
    });
    console.log('✅ Order status change tracked successfully');

    // Test 3: Track notification
    console.log('\n3. Testing notification tracking...');
    await centralizedFlowMonitor.trackNotificationEvent(
      'test-order-123',
      'ORD-2024-001',
      'shoofi-app',
      'customer_notification',
      'customer-123',
      'customer',
      'success',
      {
        title: 'Order Confirmed',
        body: 'Your order has been confirmed',
        type: 'order_update'
      }
    );
    console.log('✅ Notification tracking successful');

    // Test 4: Track WebSocket event
    console.log('\n4. Testing WebSocket tracking...');
    await centralizedFlowMonitor.trackWebSocketEvent(
      'test-order-123',
      'ORD-2024-001',
      'shoofi-app',
      'status_update',
      'customer-123',
      'customer',
      'success',
      {
        type: 'order_update',
        data: { status: '1' }
      }
    );
    console.log('✅ WebSocket tracking successful');

    // Test 5: Track delivery event
    console.log('\n5. Testing delivery tracking...');
    await centralizedFlowMonitor.trackOrderFlowEvent({
      orderId: 'delivery-789',
      orderNumber: 'ORD-2024-001',
      sourceApp: 'delivery-company',
      eventType: 'delivery_assigned',
      status: 'assigned',
      actor: 'Driver System',
      actorId: 'driver-789',
      actorType: 'driver',
      metadata: {
        driverName: 'Ahmed Driver',
        assignmentTime: new Date()
      }
    });
    console.log('✅ Delivery tracking successful');

    // Test 6: Get order summary
    console.log('\n6. Testing order summary retrieval...');
    const summary = await centralizedFlowMonitor.getOrderStatusSummary('ORD-2024-001');
    console.log('✅ Order summary retrieved successfully');
    console.log('   - Total events:', summary.totalEvents);
    console.log('   - Notifications sent:', summary.notificationsSent);
    console.log('   - WebSockets sent:', summary.websocketsSent);
    console.log('   - Delivery events:', summary.deliveryEvents);

    // Test 7: Get complete timeline
    console.log('\n7. Testing timeline retrieval...');
    const timeline = await centralizedFlowMonitor.getCompleteOrderTimeline('ORD-2024-001');
    console.log('✅ Timeline retrieved successfully');
    console.log('   - Timeline events:', timeline.timeline.length);
    console.log('   - Delivery events:', timeline.deliveryEvents.length);

    // Test 8: Search orders
    console.log('\n8. Testing order search...');
    const searchResults = await centralizedFlowMonitor.searchOrders({
      sourceApp: 'shoofi-app',
      limit: 10
    });
    console.log('✅ Order search successful');
    console.log('   - Search results:', searchResults.results.length);

    console.log('\n🎉 All tests passed successfully!');
    console.log('\n📊 Test Data Summary:');
    console.log('   - Order Number: ORD-2024-001');
    console.log('   - Total Events Created: 5');
    console.log('   - Apps Involved: shoofi-app, shoofi-partner, delivery-company');
    console.log('   - Event Types: order_created, status_change, notification, websocket, delivery');

    console.log('\n🔍 You can now test the admin dashboard with order number: ORD-2024-001');

  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  } finally {
    await client.close();
  }
}

// Run tests
if (require.main === module) {
  testOrderMonitoring()
    .then(() => {
      console.log('\n✅ All tests completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Tests failed:', error);
      process.exit(1);
    });
}

module.exports = { testOrderMonitoring }; 