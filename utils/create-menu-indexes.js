/**
 * Database indexes for optimal menu performance
 * Run this script to create the necessary indexes
 */

const createMenuIndexes = async (db) => {
  try {
    console.log('Creating menu performance indexes...');

    // Categories collection indexes
    await db.collection('categories').createIndex(
      { isHidden: 1, order: 1 },
      { name: 'categories_visibility_order' }
    );

    await db.collection('categories').createIndex(
      { order: 1 },
      { name: 'categories_order' }
    );

    // Products collection indexes
    await db.collection('products').createIndex(
      { supportedCategoryIds: 1, isHidden: 1, order: 1 },
      { name: 'products_category_visibility_order' }
    );

    await db.collection('products').createIndex(
      { supportedCategoryIds: 1 },
      { name: 'products_category_lookup' }
    );

    await db.collection('products').createIndex(
      { isHidden: 1, order: 1 },
      { name: 'products_visibility_order' }
    );

    // Compound index for aggregation pipeline
    await db.collection('products').createIndex(
      { 
        supportedCategoryIds: 1, 
        isHidden: 1, 
        order: 1,
        _id: 1 
      },
      { name: 'products_menu_aggregation' }
    );

    console.log('✅ Menu indexes created successfully');
  } catch (error) {
    console.error('❌ Error creating menu indexes:', error);
    throw error;
  }
};

module.exports = { createMenuIndexes }; 