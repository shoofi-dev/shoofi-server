#!/usr/bin/env node

const { MongoClient } = require('mongodb');

async function findTestUsers() {
  const uri = 'mongodb://localhost:27017';
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    // Check shoofi database for customers
    const shoofiDB = client.db('shoofi');
    console.log('\n🔍 Searching for customers in shoofi database...');
    
    const customers = await shoofiDB.collection('customers')
      .find({}, { projection: { _id: 1, fullName: 1, phone: 1, email: 1 } })
      .limit(5)
      .toArray();
    
    if (customers.length > 0) {
      console.log('✅ Found customers:');
      customers.forEach((customer, index) => {
        console.log(`  ${index + 1}. ID: ${customer._id}`);
        console.log(`     Name: ${customer.fullName || 'N/A'}`);
        console.log(`     Phone: ${customer.phone || 'N/A'}`);
        console.log(`     Email: ${customer.email || 'N/A'}`);
        console.log('');
      });
    } else {
      console.log('❌ No customers found in shoofi database');
    }
    
    // Check for store users
    console.log('🔍 Searching for store users...');
    const storeUsers = await shoofiDB.collection('storeUsers')
      .find({}, { projection: { _id: 1, fullName: 1, appName: 1, email: 1 } })
      .limit(5)
      .toArray();
    
    if (storeUsers.length > 0) {
      console.log('✅ Found store users:');
      storeUsers.forEach((user, index) => {
        console.log(`  ${index + 1}. ID: ${user._id}`);
        console.log(`     Name: ${user.fullName || 'N/A'}`);
        console.log(`     App: ${user.appName || 'N/A'}`);
        console.log(`     Email: ${user.email || 'N/A'}`);
        console.log('');
      });
    } else {
      console.log('❌ No store users found');
    }
    
    // Check for stores
    console.log('🔍 Searching for stores...');
    const stores = await shoofiDB.collection('stores')
      .find({}, { projection: { _id: 1, appName: 1, storeName: 1 } })
      .limit(5)
      .toArray();
    
    if (stores.length > 0) {
      console.log('✅ Found stores:');
      stores.forEach((store, index) => {
        console.log(`  ${index + 1}. ID: ${store._id}`);
        console.log(`     App Name: ${store.appName || 'N/A'}`);
        console.log(`     Store Name: ${store.storeName || 'N/A'}`);
        console.log('');
      });
    } else {
      console.log('❌ No stores found');
    }
    
    // Check delivery-company database
    console.log('🔍 Searching for customers in delivery-company database...');
    const deliveryDB = client.db('delivery-company');
    const deliveryCustomers = await deliveryDB.collection('customers')
      .find({}, { projection: { _id: 1, fullName: 1, phone: 1 } })
      .limit(3)
      .toArray();
    
    if (deliveryCustomers.length > 0) {
      console.log('✅ Found delivery customers:');
      deliveryCustomers.forEach((customer, index) => {
        console.log(`  ${index + 1}. ID: ${customer._id}`);
        console.log(`     Name: ${customer.fullName || 'N/A'}`);
        console.log(`     Phone: ${customer.phone || 'N/A'}`);
        console.log('');
      });
    } else {
      console.log('❌ No customers found in delivery-company database');
    }
    
    console.log('\n💡 Use these IDs to update your test data in test-order-routes.js');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
    console.log('🔌 MongoDB connection closed');
  }
}

findTestUsers();
