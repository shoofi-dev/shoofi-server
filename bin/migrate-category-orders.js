#!/usr/bin/env node

/**
 * Command-line script to migrate existing products to use category-specific ordering
 * Usage: node bin/migrate-category-orders.js [storeName]
 */

const { MongoClient } = require('mongodb');
const { migrateCategoryOrders, validateMigration } = require('../utils/migrations/add-category-orders');

// Database configuration
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DATABASE_PREFIX = process.env.DATABASE_PREFIX || 'shoofi';

async function runMigration(storeName = null) {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    if (storeName) {
      // Migrate specific store
      const dbName = `${DATABASE_PREFIX}-${storeName}`;
      const db = client.db(dbName);
      
      console.log(`\n🔄 Migrating store: ${storeName} (${dbName})`);
      await migrateCategoryOrders(db);
      
      console.log(`\n✅ Validating migration for ${storeName}...`);
      const isValid = await validateMigration(db);
      
      if (isValid) {
        console.log(`✅ Migration completed successfully for ${storeName}`);
      } else {
        console.log(`⚠️ Migration validation failed for ${storeName}`);
      }
    } else {
      // Migrate all stores
      const adminDb = client.db('admin');
      const databases = await adminDb.admin().listDatabases();
      
      const storeDatabases = databases.databases
        .filter(db => db.name.startsWith(DATABASE_PREFIX))
        .map(db => db.name);
      
      console.log(`\n🔄 Found ${storeDatabases.length} stores to migrate:`);
      storeDatabases.forEach(db => console.log(`  - ${db}`));
      
      for (const dbName of storeDatabases) {
        const db = client.db(dbName);
        const storeName = dbName.replace(`${DATABASE_PREFIX}-`, '');
        
        console.log(`\n🔄 Migrating store: ${storeName} (${dbName})`);
        await migrateCategoryOrders(db);
        
        console.log(`✅ Validating migration for ${storeName}...`);
        const isValid = await validateMigration(db);
        
        if (isValid) {
          console.log(`✅ Migration completed successfully for ${storeName}`);
        } else {
          console.log(`⚠️ Migration validation failed for ${storeName}`);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const storeName = args[0] || null;

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: node bin/migrate-category-orders.js [storeName]

Options:
  storeName    Migrate specific store only (optional)
  --help, -h   Show this help message

Examples:
  node bin/migrate-category-orders.js                    # Migrate all stores
  node bin/migrate-category-orders.js shoofi             # Migrate specific store
  node bin/migrate-category-orders.js --help             # Show help
  `);
  process.exit(0);
}

// Run migration
console.log('🚀 Starting Category Orders Migration');
console.log('=====================================');
runMigration(storeName).then(() => {
  console.log('\n🎉 Migration process completed!');
  process.exit(0);
}).catch((error) => {
  console.error('\n💥 Migration process failed:', error);
  process.exit(1);
}); 