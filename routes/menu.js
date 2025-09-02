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
    
    // Get app type to determine if we should show hidden products
    const appType = req.headers['app-type'] || 'shoofi-app';
    const shouldShowHiddenProducts = appType === 'shoofi-partner' || appType === 'shoofi-admin';
    const isAdminApp = appType === 'shoofi-partner' || appType === 'shoofi-admin';
    
    // Check cache first (only for non-admin apps)
    if (!isAdminApp) {
      const cachedMenu = await menuCache.get(storeId);
      if (cachedMenu) {
        console.timeEnd('menuQueryTime');
        console.log('Menu served from cache');
        return res.status(200).json(cachedMenu);
      }
    }

    // Use aggregation pipeline for better performance
    const db = req.app.db[dbName];
    
    // Validate database connection
    if (!db) {
      throw new Error(`Database '${dbName}' not available. Available databases: ${Object.keys(req.app.db || {}).join(', ')}`);
    }
    
    // Build aggregation pipeline
    const aggregationPipeline = [
      // Match only non-hidden categories (unless it's shoofi-partner)
      ...(shouldShowHiddenProducts ? [] : [{ $match: { isHidden: { $ne: true } } }]),
      
      // Sort categories by order
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
                    ...(shouldShowHiddenProducts ? [] : [{ $ne: ['$isHidden', true] }]) // Only non-hidden products (unless it's shoofi-partner)
                  ]
                }
              }
            },
            // Sort products by order (legacy field)
            { $sort: { order: 1 } },
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
          products: 1,
          supportedGeneralCategoryIds: 1,
          isHidden: 1,
        }
      }
    ];

    const menuAggregation = await db.collection('categories').aggregate(aggregationPipeline).toArray();

    // Post-process to sort products by categoryOrders if available
    const processedMenu = menuAggregation.map(category => {
      if (category.products && category.products.length > 0) {
        // Sort products by categoryOrders if available, otherwise by order
        const sortedProducts = category.products.sort((a, b) => {
          const orderA = a.categoryOrders?.[category._id] ?? a.order ?? 999999;
          const orderB = b.categoryOrders?.[category._id] ?? b.order ?? 999999;
          return orderA - orderB;
        });
        
        return {
          ...category,
          products: sortedProducts
        };
      }
      return category;
    });

    // Extract products for images list
    const allProducts = processedMenu.reduce((acc, category) => {
      return acc.concat(category.products || []);
    }, []);



    // Check if generalCategories collection exists and fetch data
    let generalCategories = null;
    try {
      const collections = await db.listCollections({ name: 'general-categories' }).toArray();
      if (collections.length > 0) {
        // Fetch general categories
        const generalCategoriesData = await db.collection('general-categories').find({}).toArray();
        
        // Fetch all categories (subcategories) to filter by supportedGeneralCategoryIds
        const allCategories = await db.collection('categories').find({}).toArray();
        
        // Process general categories and add filtered subcategories
        generalCategories = generalCategoriesData.map(generalCategory => {
          const subCategories = allCategories.filter(category => 
            category.supportedGeneralCategoryIds && 
            category.supportedGeneralCategoryIds.some(id => 
              id.$oid === generalCategory._id.$oid || id === generalCategory._id.$oid
            )
          );
          
          return {
            ...generalCategory,
            subCategories: subCategories.sort((a, b) => (a.order || 0) - (b.order || 0))
          };
        });
      }
    } catch (error) {
      console.warn('Error fetching generalCategories:', error.message);
      // Continue without generalCategories if there's an error
    }

    const menuData = {
      menu: processedMenu,
      ...(generalCategories && { generalCategories })
    };

    // Cache the result (only for non-admin apps)
    if (!isAdminApp) {
      await menuCache.set(storeId, menuData);
    }

    console.timeEnd('menuQueryTime');
    console.log(`Menu generated for store: ${storeId}${isAdminApp ? ' (admin app - no cache)' : ''}`);

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

// Route to refresh menu cache
router.post("/api/menu/refresh", async (req, res, next) => {
  try {
    await menuCache.clear();
    // Trigger a new menu generation
    const storeId = req.headers['app-name'] || req.query.storeId || 'default';
    const dbName = req.headers['app-name'] || req.headers['db-name'] || req.query.dbName || 'shoofi';
    const appType = req.headers['app-type'] || 'shoofi-app';
    const shouldShowHiddenProducts = appType === 'shoofi-partner' || appType === 'shoofi-admin';
    const isAdminApp = appType === 'shoofi-partner' || appType === 'shoofi-admin';
    
    // This will regenerate the cache
    const db = req.app.db[dbName];
    
    if (!db) {
      throw new Error(`Database '${dbName}' not available`);
    }
    
    const aggregationPipeline = [
      // Match only non-hidden categories (unless it's shoofi-partner)
      ...(shouldShowHiddenProducts ? [] : [{ $match: { isHidden: { $ne: true } } }]),
      { $sort: { order: 1 } },
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
                    ...(shouldShowHiddenProducts ? [] : [{ $ne: ['$isHidden', true] }]) // Only non-hidden products (unless it's shoofi-partner)
                  ]
                }
              }
            },
            { $sort: { order: 1 } },
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
    
    const menuAggregation = await db.collection('categories').aggregate(aggregationPipeline).toArray();

    // Post-process to sort products by categoryOrders if available
    const processedMenu = menuAggregation.map(category => {
      if (category.products && category.products.length > 0) {
        // Sort products by categoryOrders if available, otherwise by order
        const sortedProducts = category.products.sort((a, b) => {
          const orderA = a.categoryOrders?.[category._id] ?? a.order ?? 999999;
          const orderB = b.categoryOrders?.[category._id] ?? b.order ?? 999999;
          return orderA - orderB;
        });
        
        return {
          ...category,
          products: sortedProducts
        };
      }
      return category;
    });

    const allProducts = processedMenu.reduce((acc, category) => {
      return acc.concat(category.products || []);
    }, []);


    const grouped = _.groupBy(allProducts, 'categoryId');

    // Check if generalCategories collection exists and fetch data
    let generalCategories = null;
    try {
      const collections = await db.listCollections({ name: 'general-categories' }).toArray();
      if (collections.length > 0) {
        // Fetch general categories
        const generalCategoriesData = await db.collection('general-categories').find({}).toArray();
        
        // Fetch all categories (subcategories) to filter by supportedGeneralCategoryIds
        const allCategories = await db.collection('categories').find({}).toArray();
        
        // Process general categories and add filtered subcategories
        generalCategories = generalCategoriesData.map(generalCategory => {
          const subCategories = allCategories.filter(category => 
            category.supportedGeneralCategoryIds && 
            category.supportedGeneralCategoryIds.some(id => 
              id.$oid === generalCategory._id.$oid || id === generalCategory._id.$oid
            )
          );
          
          return {
            ...generalCategory,
            subCategories: subCategories.sort((a, b) => (a.order || 0) - (b.order || 0))
          };
        });
      }
    } catch (error) {
      console.warn('Error fetching generalCategories:', error.message);
      // Continue without generalCategories if there's an error
    }

    const menuData = {
      menu: processedMenu,
      ...(generalCategories && { generalCategories })
    };

    // Cache the result (only for non-admin apps)
    if (!isAdminApp) {
      await menuCache.set(storeId, menuData);
    }

    res.status(200).json({ 
      message: `Menu cache refreshed successfully${isAdminApp ? ' (admin app - no cache)' : ''}`, 
      data: menuData 
    });
  } catch (error) {
    console.error('Error refreshing menu cache:', error);
    res.status(500).json({ error: 'Failed to refresh cache', details: error.message });
  }
});

// Mock menu route - returns mock store menu filtered by current store products
router.get("/api/menu/mock", async (req, res, next) => {
  try {
    console.time('mockMenuQueryTime');
    
    // Get store ID from request (you may need to adjust this based on your auth setup)
    const storeId = req.headers['app-name'] || req.query.storeId || 'default';
    
    // Determine the database name - this should match your store's appName
    const dbName = req.headers['app-name'] || req.headers['db-name'] || req.query.dbName || 'shoofi';
    
    // Get app type to determine if we should show hidden products
    const appType = req.headers['app-type'] || 'shoofi-app';
    const shouldShowHiddenProducts = appType === 'shoofi-partner' || appType === 'shoofi-admin';
    const isAdminApp = appType === 'shoofi-partner' || appType === 'shoofi-admin';
    
    // Use aggregation pipeline for better performance
    const db = req.app.db[dbName];
    
    // Validate database connection
    if (!db) {
      throw new Error(`Database '${dbName}' not available. Available databases: ${Object.keys(req.app.db || {}).join(', ')}`);
    }

    // Get the mock store appName from the current store's configuration
    let mockStoreAppName = null;
    try {
      const storeConfig = await db.collection('store').findOne({});
      if (storeConfig && storeConfig.mockStoreAppName) {
        mockStoreAppName = storeConfig.mockStoreAppName;
      }
    } catch (error) {
      console.warn('Could not find mock store configuration:', error.message);
    }

    // If no mock store is configured, return empty menu
    if (!mockStoreAppName) {
      console.log(`No mock store configured for store: ${storeId}`);
      return res.status(200).json({
        menu: [],
        generalCategories: []
      });
    }

    // Get mock store database
    const mockDb = req.app.db[mockStoreAppName];
    if (!mockDb) {
      throw new Error(`Mock store database '${mockStoreAppName}' not available`);
    }

    // Build aggregation pipeline for mock store menu
    const mockAggregationPipeline = [
      // Match only non-hidden categories (unless it's admin app)
      ...(shouldShowHiddenProducts ? [] : [{ $match: { isHidden: { $ne: true } } }]),
      
      // Sort categories by order
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
                    ...(shouldShowHiddenProducts ? [] : [{ $ne: ['$isHidden', true] }]) // Only non-hidden products (unless it's admin app)
                  ]
                }
              }
            },
            // Sort products by order (legacy field)
            { $sort: { order: 1 } },
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
                barcode: 1,
                barcodeId: 1
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
          products: 1,
          supportedGeneralCategoryIds: 1,
          isHidden: 1,
        }
      }
    ];

    const mockMenuAggregation = await mockDb.collection('categories').aggregate(mockAggregationPipeline).toArray();

    // Get current store products to filter out duplicates
    const currentStoreProducts = await db.collection('products').find({}, {
      projection: { 
        _id: 1, 
        barcode: 1, 
        barcodeId: 1,
        nameAR: 1,
        nameHE: 1
      }
    }).toArray();

    // Create sets for faster lookup
    const currentStoreBarcodes = new Set(currentStoreProducts.map(p => p.barcode).filter(Boolean));
    const currentStoreBarcodeIds = new Set(currentStoreProducts.map(p => p.barcodeId).filter(Boolean));
    const currentStoreNames = new Set([
      ...currentStoreProducts.map(p => p.nameAR).filter(Boolean),
      ...currentStoreProducts.map(p => p.nameHE).filter(Boolean)
    ]);

    // Filter out products that already exist in current store
    const filteredMockMenu = mockMenuAggregation.map(category => {
      if (category.products && category.products.length > 0) {
        const filteredProducts = category.products.filter(product => {
          // Check if product already exists by barcode, barcodeId, or name
          const hasBarcode = product.barcode && currentStoreBarcodes.has(product.barcode);
          const hasBarcodeId = product.barcodeId && currentStoreBarcodeIds.has(product.barcodeId);
          const hasName = (product.nameAR && currentStoreNames.has(product.nameAR)) ||
                         (product.nameHE && currentStoreNames.has(product.nameHE));
          
          // Return true if product doesn't exist in current store
          return  !hasBarcodeId && !hasName;
        });

        // Sort products by categoryOrders if available, otherwise by order
        const sortedProducts = filteredProducts.sort((a, b) => {
          const orderA = a.categoryOrders?.[category._id] ?? a.order ?? 999999;
          const orderB = b.categoryOrders?.[category._id] ?? b.order ?? 999999;
          return orderA - orderB;
        });
        
        return {
          ...category,
          products: sortedProducts
        };
      }
      return category;
    });

    // Extract products for images list
    const allProducts = filteredMockMenu.reduce((acc, category) => {
      return acc.concat(category.products || []);
    }, []);

    // Check if generalCategories collection exists and fetch data from mock store
    let generalCategories = null;
    try {
      const collections = await mockDb.listCollections({ name: 'general-categories' }).toArray();
      if (collections.length > 0) {
        // Fetch general categories
        const generalCategoriesData = await mockDb.collection('general-categories').find({}).toArray();
        
        // Fetch all categories (subcategories) to filter by supportedGeneralCategoryIds
        const allCategories = await mockDb.collection('categories').find({}).toArray();
        
        // Process general categories and add filtered subcategories
        generalCategories = generalCategoriesData.map(generalCategory => {
          const subCategories = allCategories.filter(category => 
            category.supportedGeneralCategoryIds && 
            category.supportedGeneralCategoryIds.some(id => 
              id.$oid === generalCategory._id.$oid || id === generalCategory._id.$oid
            )
          );
          
          return {
            ...generalCategory,
            subCategories: subCategories.sort((a, b) => (a.order || 0) - (b.order || 0))
          };
        });
      }
    } catch (error) {
      console.warn('Error fetching generalCategories from mock store:', error.message);
      // Continue without generalCategories if there's an error
    }

    const menuData = {
      menu: filteredMockMenu,
      ...(generalCategories && { generalCategories })
    };

    console.timeEnd('mockMenuQueryTime');
    console.log(`Mock menu generated for store: ${storeId} from mock store: ${mockStoreAppName}`);

    res.status(200).json(menuData);

  } catch (error) {
    console.error('Error fetching mock menu:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to fetch mock menu', details: error.message });
  }
});

// Search products across all stores and return matching stores
router.post("/api/menu/search", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || typeof query !== "string" || query.length < 2) {
      return res.status(400).json({ error: "Query is required and must be at least 2 characters." });
    }

    // 1. Get all stores from the main shoofi db
    const mainDb = req.app.db['shoofi'];
    const allStores = await mainDb.collection('stores').find({ appName: { $exists: true } }).toArray();

    // 2. Search for stores by name_ar or name_he (case-insensitive, prefix/word start match for Arabic/Hebrew)
    const storeNameRegex = new RegExp(`(^|\\s)${query}`, 'i');
    const storeNameMatches = await mainDb.collection('stores').find({
      $or: [
        { name_ar: storeNameRegex },
        { name_he: storeNameRegex }
      ],
      appName: { $exists: true }
    }).toArray();

    // 3. For each store, search its products collection
    const productResults = await Promise.all(
      allStores.map(async (store) => {
        const dbName = store.appName;
        const db = req.app.db[dbName];
        if (!db) return null;

        // Check if products collection exists
        const collections = await db.listCollections({ name: 'products' }).toArray();
        if (collections.length === 0) {
          return null;
        }

        // Use regex for Arabic/Hebrew prefix/word start matching instead of text index
        const productNameRegex = new RegExp(`(^|\\s)${query}`, 'i');
        const products = await db.collection('products').find({
          $or: [
            { nameAR: productNameRegex },
            { nameHE: productNameRegex },
            { descriptionAR: productNameRegex },
            { descriptionHE: productNameRegex }
          ]
        }, {
          projection: { nameAR: 1, nameHE: 1, descriptionAR: 1, descriptionHE: 1 }
        }).limit(10).toArray();

        if (products.length > 0) {
          return { store, products };
        }
        return null;
      })
    );

    // 4. Merge results, deduplicating by appName
    const resultsByAppName = {};
    // Add product search results
    for (const result of productResults) {
      if (result && result.store && result.store.appName) {
        resultsByAppName[result.store.appName] = { store: result.store, products: result.products };
      }
    }
    // Add store name matches (with empty products if not already present)
    for (const store of storeNameMatches) {
      if (store && store.appName && !resultsByAppName[store.appName]) {
        resultsByAppName[store.appName] = { store, products: [] };
      }
    }

    // 5. Prepare final result
    const storesWithMatches = Object.values(resultsByAppName);

    res.json({ stores: storesWithMatches });
  } catch (error) {
    console.error("Search error:", error);
    res.status(500).json({ error: "Search failed", details: error.message });
  }
});

module.exports = router;