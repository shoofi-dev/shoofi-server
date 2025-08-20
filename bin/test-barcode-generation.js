#!/usr/bin/env node

/**
 * Test Script: Verify barcodeId generation
 * 
 * This script tests the barcodeId generation function to ensure
 * it produces unique IDs as expected.
 */

const { generateUniqueBarcodeId } = require('./add-barcode-ids-to-products');

console.log('🧪 Testing barcodeId generation...\n');

// Test 1: Generate multiple IDs for same store
console.log('📝 Test 1: Multiple IDs for same store (shoofi)');
const shoofiIds = [];
for (let i = 0; i < 5; i++) {
  const id = generateUniqueBarcodeId('shoofi');
  shoofiIds.push(id);
  console.log(`   ${i + 1}. ${id}`);
}

// Test 2: Generate IDs for different stores
console.log('\n📝 Test 2: IDs for different stores');
const stores = ['shoofi', 'partner', 'delivery', 'test-store'];
stores.forEach(store => {
  const id = generateUniqueBarcodeId(store);
  console.log(`   ${store}: ${id}`);
});

// Test 3: Check uniqueness
console.log('\n📝 Test 3: Uniqueness check');
const allIds = [...shoofiIds, ...stores.map(store => generateUniqueBarcodeId(store))];
const uniqueIds = new Set(allIds);

if (allIds.length === uniqueIds.size) {
  console.log('   ✅ All generated IDs are unique!');
} else {
  console.log('   ❌ Duplicate IDs found!');
}

console.log(`   Total IDs: ${allIds.length}`);
console.log(`   Unique IDs: ${uniqueIds.size}`);

// Test 4: Format validation
console.log('\n📝 Test 4: Format validation');
const testId = generateUniqueBarcodeId('shoofi');
const formatRegex = /^[A-Z]{3}_\d+_[a-z0-9]{6}$/;

if (formatRegex.test(testId)) {
  console.log('   ✅ Format is correct!');
  console.log(`   Example: ${testId}`);
} else {
  console.log('   ❌ Format is incorrect!');
  console.log(`   Got: ${testId}`);
}

// Test 5: Performance test
console.log('\n📝 Test 5: Performance test (1000 IDs)');
const startTime = Date.now();
const performanceIds = [];
for (let i = 0; i < 1000; i++) {
  performanceIds.push(generateUniqueBarcodeId('performance-test'));
}
const endTime = Date.now();
const duration = endTime - startTime;

console.log(`   Generated 1000 IDs in ${duration}ms`);
console.log(`   Average: ${(duration / 1000).toFixed(2)}ms per ID`);

// Check uniqueness of performance test
const uniquePerformanceIds = new Set(performanceIds);
if (performanceIds.length === uniquePerformanceIds.size) {
  console.log('   ✅ All 1000 IDs are unique!');
} else {
  console.log('   ❌ Duplicates found in performance test!');
}

console.log('\n🎉 Test completed!');
