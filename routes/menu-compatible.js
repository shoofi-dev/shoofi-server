const express = require('express');
const router = express.Router();
const _ = require('lodash');
const { getId } = require("../lib/common");
const { paginateData } = require('../lib/paginate');
const menuCache = require('../utils/menu-cache');

router.get("/api/menu", async (req, res, next) => {
  try {
    console.time('menuQueryTime');
    
    // Get store ID from request (you may need to adjust this based on your auth setup)
    const storeId = req.headers['app-name'] || req.query.storeId || 'default';
    
    // Determine the database name - this should match your store's appName
    const dbName = req.headers['app-name'] || req.headers['db-name'] || req.query.dbName || 'shoofi';
    
    // Check cache first
    const cachedMenu = await menuCache.get(storeId);
    if (cachedMenu) {
      console.timeEnd('menuQueryTime');
      console.log('Menu served from cache');
      return res.status(200).json(cachedMenu);
    }

    // Use aggregation pipeline for better performance
    const db = req.app.db[dbName];
    
    // Validate database connection
    if (!db) {
      throw new Error(`Database '${dbName}' not available. Available databases: ${Object.keys(req.app.db || {}).join(', ')}`);
    }
    
    // Check if categoryOrders field exists in any product
    const sampleProduct = await db.collection('products').findOne({});
    const hasCategoryOrders = sampleProduct && sampleProduct.categoryOrders;
    
    // Build aggregation pipeline based on whether categoryOrders exists
    let aggregationPipeline = [
      // Match only non-hidden categories
      { $match: { isHidden: { $ne: true } } },
      
      // Sort by order
      { $sort: { order: 1 } },
      
      // Lookup products for each category
      {
        $lookup: {
          from: 'products',
          let: { categoryId: { $toString: '$_id' } },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $in: ['$$categoryId', '$supportedCategoryIds'] },
                    { $ne: ['$isHidden', true] } // Only non-hidden products
                  ]
                }
              }
            },
            // Project only needed fields
            {
              $project: {
                _id: 1,
                nameAR: 1,
                nameHE: 1,
                descriptionAR: 1,
                descriptionHE: 1,
                price: 1,
                img: 1,
                order: 1,
                categoryOrders: 1,
                isInStore: 1,
                count: 1,
                supportedCategoryIds: 1,
                categoryId: 1,
                extras: 1,
                isHidden: 1,
              }
            }
          ],
          as: 'products'
        }
      },
      
      // Project only needed category fields
      {
        $project: {
          _id: 1,
          nameAR: 1,
          nameHE: 1,
          descriptionAR: 1,
          descriptionHE: 1,
          order: 1,
          img: 1,
          products: 1
        }
      }
    ];

    // If categoryOrders exists, add sorting logic
    if (hasCategoryOrders) {
      // Insert sorting logic before the projection in the lookup pipeline
      const lookupStage = aggregationPipeline.find(stage => stage.$lookup);
      const productsPipeline = lookupStage.$lookup.pipeline;
      
      // Insert sorting after the match stage
      const matchIndex = productsPipeline.findIndex(stage => stage.$match);
      if (matchIndex !== -1) {
        productsPipeline.splice(matchIndex + 1, 0, {
          $addFields: {
            categoryOrder: {
              $ifNull: [
                { $arrayElemAt: [{ $objectToArray: "$categoryOrders" }, 0] },
                { k: "$$categoryId", v: "$order" }
              ]
            }
          }
        });
        productsPipeline.splice(matchIndex + 2, 0, {
          $sort: { "categoryOrder.v": 1 }
        });
      }
    } else {
      // Use simple order sorting if categoryOrders doesn't exist
      const lookupStage = aggregationPipeline.find(stage => stage.$lookup);
      const productsPipeline = lookupStage.$lookup.pipeline;
      
      const matchIndex = productsPipeline.findIndex(stage => stage.$match);
      if (matchIndex !== -1) {
        productsPipeline.splice(matchIndex + 1, 0, {
          $sort: { order: 1 }
        });
      }
    }

    const menuAggregation = await db.collection('categories').aggregate(aggregationPipeline).toArray();

    // Extract products for images list
    const allProducts = menuAggregation.reduce((acc, category) => {
      return acc.concat(category.products || []);
    }, []);

    // Create products images list
    const productsImagesList = allProducts
      .filter(product => product.img && product.img.length > 0)
      .map(product => product.img[0]?.uri)
      .filter(Boolean);

    // Group products by category for categoryImages
    const grouped = _.groupBy(allProducts, 'categoryId');

    const menuData = {
      menu: menuAggregation,
      productsImagesList,
      categoryImages: grouped
    };

    // Cache the result
    await menuCache.set(storeId, menuData);

    console.timeEnd('menuQueryTime');
    console.log(`Menu generated for store: ${storeId}`);

    res.status(200).json(menuData);

  } catch (error) {
    console.error('Error fetching menu:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to fetch menu', details: error.message });
  }
});

// Route to clear menu cache (useful for admin operations)
router.post("/api/menu/clear-cache", async (req, res, next) => {
  try {
    await menuCache.clear();
    res.status(200).json({ message: 'Menu cache cleared successfully' });
  } catch (error) {
    console.error('Error clearing menu cache:', error);
    res.status(500).json({ error: 'Failed to clear cache' });
  }
});

// Route to clear cache for specific store
router.post("/api/menu/clear-cache/:storeId", async (req, res, next) => {
  try {
    const { storeId } = req.params;
    await menuCache.clearStore(storeId);
    res.status(200).json({ message: `Menu cache cleared for store: ${storeId}` });
  } catch (error) {
    console.error('Error clearing store cache:', error);
    res.status(500).json({ error: 'Failed to clear store cache' });
  }
});

// Route to get cache statistics
router.get("/api/menu/cache-stats", async (req, res, next) => {
  try {
    const stats = await menuCache.getStats();
    res.status(200).json(stats);
  } catch (error) {
    console.error('Error getting cache stats:', error);
    res.status(500).json({ error: 'Failed to get cache stats' });
  }
});

module.exports = router; 