#!/usr/bin/env node

/**
 * Simple runner script for testing the persistent alerts system
 * Usage: node run-persistent-alerts-test.js
 */

const { runAllTests } = require('./test-persistent-alerts');

console.log('🚀 Starting Persistent Alerts System Test Runner\n');

runAllTests()
  .then(() => {
    console.log('\n✅ All tests completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Tests failed:', error);
    process.exit(1);
  }); 