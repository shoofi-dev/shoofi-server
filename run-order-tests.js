#!/usr/bin/env node

const { testOrderRoutes } = require('./test-order-routes');

console.log('🚀 Starting Order Route Tests...\n');

testOrderRoutes()
  .then(() => {
    console.log('\n✅ All tests completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Tests failed:', error);
    process.exit(1);
  });
