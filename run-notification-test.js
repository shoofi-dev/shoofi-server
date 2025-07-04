#!/usr/bin/env node

const { testOrderNotifications } = require('./test-order-notifications');

console.log('🚀 Running Order Notification Test...\n');

// Set environment variables if needed
process.env.NODE_ENV = 'test';

testOrderNotifications()
  .then(() => {
    console.log('\n✅ Test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }); 