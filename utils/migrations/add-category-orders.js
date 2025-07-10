/**
 * Migration script to add categoryOrders field to existing products
 * This script should be run once to migrate existing data to the new structure
 */

const { getId } = require("../../lib/common");

const migrateCategoryOrders = async (db) => {
  try {
    console.log('Starting categoryOrders migration...');
    
    // Get all products
    const products = await db.collection('products').find({}).toArray();
    console.log(`Found ${products.length} products to migrate`);
    
    const bulkOps = [];
    let migratedCount = 0;
    
    for (const product of products) {
      if (product.supportedCategoryIds && product.supportedCategoryIds.length > 0) {
        // Initialize categoryOrders if it doesn't exist
        const categoryOrders = product.categoryOrders || {};
        
        // Set order for each category the product belongs to
        product.supportedCategoryIds.forEach(catId => {
          if (categoryOrders[catId] === undefined) {
            categoryOrders[catId] = product.order || 0;
          }
        });
        
        bulkOps.push({
          updateOne: {
            filter: { _id: product._id },
            update: { $set: { categoryOrders } }
          }
        });
        
        migratedCount++;
      }
    }

    if (bulkOps.length > 0) {
      const result = await db.collection('products').bulkWrite(bulkOps);
      console.log(`✅ Successfully migrated ${result.modifiedCount} products`);
      console.log(`📊 Total products processed: ${migratedCount}`);
    } else {
      console.log('ℹ️ No products to migrate');
    }
    
    return { success: true, migratedCount: migratedCount };
  } catch (error) {
    console.error('❌ Error during migration:', error);
    throw error;
  }
};

const rollbackCategoryOrders = async (db) => {
  try {
    console.log('Rolling back categoryOrders migration...');
    
    const result = await db.collection('products').updateMany(
      {},
      { $unset: { categoryOrders: "" } }
    );
    
    console.log(`✅ Successfully rolled back ${result.modifiedCount} products`);
    return { success: true, rolledBackCount: result.modifiedCount };
  } catch (error) {
    console.error('❌ Error during rollback:', error);
    throw error;
  }
};

const validateMigration = async (db) => {
  try {
    console.log('Validating migration...');
    
    const productsWithCategoryOrders = await db.collection('products').countDocuments({
      categoryOrders: { $exists: true }
    });
    
    const totalProducts = await db.collection('products').countDocuments({});
    
    console.log(`📊 Products with categoryOrders: ${productsWithCategoryOrders}`);
    console.log(`📊 Total products: ${totalProducts}`);
    
    if (productsWithCategoryOrders === totalProducts) {
      console.log('✅ Migration validation successful');
      return true;
    } else {
      console.log('⚠️ Migration validation failed - not all products have categoryOrders');
      return false;
    }
  } catch (error) {
    console.error('❌ Error during validation:', error);
    return false;
  }
};

module.exports = {
  migrateCategoryOrders,
  rollbackCategoryOrders,
  validateMigration
}; 