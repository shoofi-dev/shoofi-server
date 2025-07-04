#!/usr/bin/env node

const { runTests } = require('./test-delivery-notifications');
const colors = require('colors');

console.log(colors.blue.bold('🚀 Delivery Notifications Test Runner'));
console.log(colors.gray('=====================================\n'));

// Handle process termination
process.on('SIGINT', () => {
  console.log(colors.yellow('\n⚠️  Test interrupted by user'));
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(colors.red('❌ Unhandled Rejection at:'), promise);
  console.error(colors.red('❌ Reason:'), reason);
  process.exit(1);
});

// Run the tests
runTests()
  .then(() => {
    console.log(colors.green.bold('\n🎉 All delivery notification tests completed successfully!'));
    process.exit(0);
  })
  .catch((error) => {
    console.error(colors.red.bold('\n💥 Test suite failed:'));
    console.error(colors.red(error));
    process.exit(1);
  }); 