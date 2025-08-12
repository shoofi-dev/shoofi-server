const express = require('express');
const router = express.Router();
const moment = require('moment');
const momentTZ = require('moment-timezone');
const { validateJson } = require('../lib/schema');
const { getId } = require('../lib/common');
const { uploadFile, deleteImages } = require('./product');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const auth = require('./auth');

const getUTCOffset = () => {
  const israelTimezone = "Asia/Jerusalem";

  // Get the current time in UTC
  const utcTime = moment.utc();

  // Get the current time in Israel timezone
  const israelTime = momentTZ.tz(israelTimezone);

  // Get the UTC offset in minutes for Israel
  const israelOffsetMinutes = israelTime.utcOffset();

  // Convert the offset to hours
  return israelOffsetMinutes;
};

// Apply coupon
router.post('/api/coupons/apply', async (req, res) => {
    const db = req.app.db['shoofi'];
    
    // Validate required fields
    if (!req.body.code || !req.body.orderAmount || !req.body.userId) {
        return res.status(400).json({
            message: 'Coupon code, order amount, and user ID are required'
        });
    }

    // Find coupon
    const coupon = await db.coupons.findOne({ 
        code: req.body.code.toUpperCase(),
        isActive: true
    });

    if (!coupon) {
        return res.status(400).json({
            message: 'Invalid coupon code'
        });
    }

    // Check if coupon is customer-specific
    if (coupon.isCustomerSpecific && coupon.customerId) {
        if (coupon.customerId.toString() !== req.body.userId) {
            return res.status(400).json({
                message: 'This coupon is not valid for your account'
            });
        }
    }

    // Validate dates
    const offsetHours = getUTCOffset();
    if (!moment().utcOffset(offsetHours).isBetween(moment(coupon.start).utcOffset(offsetHours), moment(coupon.end).utcOffset(offsetHours))) {
        return res.status(400).json({
            message: 'Coupon has expired'
        });
    }

    // Validate minimum order amount
    if (coupon.minOrderAmount && req.body.orderAmount < coupon.minOrderAmount) {
        return res.status(400).json({
            message: `Minimum order amount of ${coupon.minOrderAmount} required`
        });
    }

    // Check if coupon is applicable to the current store/category/area
    if (coupon.applicableTo) {
        let isApplicable = true;
        
        // Check stores restriction (now using appName instead of storeId)
        if (coupon.applicableTo.stores && coupon.applicableTo.stores.length > 0) {
            if (!req.body.appName || !coupon.applicableTo.stores.includes(req.body.appName)) {
                isApplicable = false;
            }
        }
        
        // Check categories restriction
        if (coupon.applicableTo.categories && coupon.applicableTo.categories.length > 0) {
            if (!req.body.categoryIds || !req.body.categoryIds.some(catId => coupon.applicableTo.categories.includes(catId))) {
                isApplicable = false;
            }
        }
        
        // Check products restriction
        if (coupon.applicableTo.products && coupon.applicableTo.products.length > 0) {
            if (!req.body.productIds || !req.body.productIds.some(prodId => coupon.applicableTo.products.includes(prodId))) {
                isApplicable = false;
            }
        }
        
        // Check supported areas restriction
        if (coupon.applicableTo.supportedAreas && coupon.applicableTo.supportedAreas.length > 0) {
            const requestAreaIds = req.body.areaIds ? (Array.isArray(req.body.areaIds) ? req.body.areaIds : [req.body.areaIds]) : [];
            if (requestAreaIds.length === 0 || !requestAreaIds.some(areaId => coupon.applicableTo.supportedAreas.includes(areaId))) {
                isApplicable = false;
            }
        }
        
        if (!isApplicable) {
            return res.status(400).json({
                message: 'This coupon is not applicable to the current order'
            });
        }
    }

    // Check usage limits
    const totalUsage = await db.couponUsages.countDocuments({ couponCode: coupon.code });
    if (totalUsage >= coupon.usageLimit) {
        return res.status(400).json({
            message: 'Coupon usage limit reached'
        });
    }

    const userUsage = await db.couponUsages.countDocuments({
        couponCode: coupon.code,
        userId: req.body.userId
    });
    if (userUsage >= coupon.usagePerUser) {
        return res.status(400).json({
            message: 'You have reached the usage limit for this coupon'
        });
    }

    // Calculate discount
    let discountAmount = 0;
    switch (coupon.type) {
        case 'percentage':
            discountAmount = (req.body.orderAmount * coupon.value) / 100;
            if (coupon.maxDiscount) {
                discountAmount = Math.min(discountAmount, coupon.maxDiscount);
            }
            break;
        case 'fixed_amount':
            discountAmount = coupon.value;
            break;
        case 'free_delivery':
            discountAmount = req.body.deliveryFee || 0;
            break;
    }

    return res.status(200).json({
        message: 'Coupon applied successfully',
        coupon: {
            _id: coupon._id,
            code: coupon.code,
            name: coupon.name,
            type: coupon.type,
            value: coupon.value,
            maxDiscount: coupon.maxDiscount,
            minOrderAmount: coupon.minOrderAmount,
            usageLimit: coupon.usageLimit,
            usagePerUser: coupon.usagePerUser,
            start: coupon.start,
            end: coupon.end,
            applicableTo: coupon.applicableTo,
            isActive: coupon.isActive,
            isCustomerSpecific: coupon.isCustomerSpecific,
            customerId: coupon.customerId,
            isAutoApply: coupon.isAutoApply,
            createdAt: coupon.createdAt,
            updatedAt: coupon.updatedAt
        },
        discountAmount: discountAmount
    });
});

// Redeem coupon
router.post('/api/coupons/redeem', async (req, res) => {
    const db = req.app.db['shoofi'];

    // Validate required fields
    if (!req.body.code || !req.body.userId || !req.body.orderId || !req.body.discountAmount) {
        return res.status(400).json({
            message: 'Coupon code, user ID, order ID, and discount amount are required'
        });
    }

    try {
        // Create usage record
        const usageDoc = {
            couponCode: req.body.code.toUpperCase(),
            userId: req.body.userId,
            orderId: req.body.orderId,
            discountAmount: parseFloat(req.body.discountAmount),
            usedAt: new Date()
        };

        await db.couponUsages.insertOne(usageDoc);

        return res.status(200).json({
            message: 'Coupon redeemed successfully',
            usage: usageDoc
        });
    } catch (err) {
        return res.status(400).json({
            message: 'Failed to redeem coupon'
        });
    }
});

// Get all active and valid coupons (by date)
router.get('/api/coupons/active', async (req, res) => {
    const appName ='shoofi';
    const db = req.app.db[appName];
    const { page = 1, limit = 50, includeExpired = false, storeAppName } = req.query;

    try {
        // Use the same timezone handling as coupon creation
        const offsetHours = getUTCOffset();
        const currentTime = moment().utcOffset(offsetHours).toDate();
        
        console.log('Current time for query:', currentTime);
        console.log('Current time ISO string:', currentTime.toISOString());
        console.log('Offset hours:', offsetHours);
        
        // Build query for active coupons - check for both boolean and string values
        let query = { 
            $or: [
                { isActive: true },
                { isActive: "true" }
            ],
            isCustomerSpecific: { $ne: true }
        };
        
        if (!includeExpired) {
            // Only include coupons that are currently valid (not expired)
            query = {
                ...query,
                start: { $lte: currentTime },
                end: { $gte: currentTime }
            };
        } else {
            // Include all active coupons regardless of date
            query = {
                ...query,
                end: { $gte: currentTime } // Only exclude fully expired coupons
            };
        }
        
                console.log('Final query:', JSON.stringify(query, null, 2));
        
        // Debug: Check all coupons and their dates
        const allActiveCoupons = await db.coupons.find({ 
            $or: [
                { isActive: true },
                { isActive: "true" }
            ]
        }).toArray();
        console.log('All active coupons count:', allActiveCoupons.length);
        
        // Debug: Check ALL coupons regardless of isActive status
        const allCoupons = await db.coupons.find({}).toArray();
        console.log('Total coupons in database:', allCoupons.length);
        
        if (allCoupons.length > 0) {
            console.log('All coupons in database:');
            allCoupons.forEach((coupon, index) => {
                console.log(`Coupon ${index + 1}:`, {
                    code: coupon.code,
                    isActive: coupon.isActive,
                    isActiveType: typeof coupon.isActive,
                    start: coupon.start,
                    end: coupon.end,
                    startType: typeof coupon.start,
                    endType: typeof coupon.end
                });
            });
        }
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        // Get coupons with pagination
        let coupons = await db.coupons.find(query)
            .skip(skip)
            .limit(parseInt(limit))
            .sort({ createdAt: -1 })
            .toArray();

        // Filter coupons by store if storeAppName is provided
        if (storeAppName) {
            coupons = coupons.filter(coupon => {
                // If coupon has no store restrictions, it applies to all stores
                if (!coupon.applicableTo || !coupon.applicableTo.stores || coupon.applicableTo.stores.length === 0) {
                    return true;
                }
                // Check if the store is in the applicable stores list
                return coupon.applicableTo.stores.includes(storeAppName);
            });
        }

        console.log('Found coupons count:', coupons.length);
        if (coupons.length > 0) {
            console.log('Sample coupon dates:', {
                start: coupons[0].start,
                end: coupons[0].end,
                startType: typeof coupons[0].start,
                endType: typeof coupons[0].end
            });
        }

        // Get total count for pagination
        const total = await db.coupons.countDocuments(query);

        // Add usage statistics for each coupon
        const couponsWithUsage = await Promise.all(coupons.map(async (coupon) => {
            const usageCount = await db.couponUsages.countDocuments({ 
                couponCode: coupon.code 
            });
            
            return {
                ...coupon,
                usageCount: usageCount,
                isUsed: usageCount > 0
            };
        }));

        return res.status(200).json({
            coupons: couponsWithUsage,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / parseInt(limit)),
                totalItems: total,
                itemsPerPage: parseInt(limit)
            }
        });
    } catch (err) {
        console.error('Error fetching active coupons:', err);
        return res.status(500).json({
            message: 'Failed to fetch active coupons'
        });
    }
});

// Get available coupons (filtered by restrictions)
router.get('/api/coupons/available', async (req, res) => {
    const appName = req.headers['app-name'];
    const db = req.app.db[appName];
    const requestAppName = req.query.appName;
    const categoryIds = req.query.categoryIds ? req.query.categoryIds.split(',') : [];
    const productIds = req.query.productIds ? req.query.productIds.split(',') : [];
    const areaIds = req.query.areaIds ? req.query.areaIds.split(',') : [];

    try {
        const offsetHours = getUTCOffset();
        const currentTime = moment().utcOffset(offsetHours).toDate();
        const coupons = await db.coupons.find({
            isActive: true,
            start: { $lte: currentTime },
            end: { $gte: currentTime }
        }).toArray();

        // Filter coupons based on applicableTo restrictions
        const filteredCoupons = coupons.filter(coupon => {
            if (!coupon.applicableTo) {
                return true; // No restrictions, apply to all
            }
            
            // Check stores restriction
            if (coupon.applicableTo.stores && coupon.applicableTo.stores.length > 0) {
                if (!storeId || !coupon.applicableTo.stores.includes(storeId)) {
                    return false;
                }
            }
            
            // Check categories restriction
            if (coupon.applicableTo.categories && coupon.applicableTo.categories.length > 0) {
                if (categoryIds.length === 0 || !categoryIds.some(catId => coupon.applicableTo.categories.includes(catId))) {
                    return false;
                }
            }
            
            // Check products restriction
            if (coupon.applicableTo.products && coupon.applicableTo.products.length > 0) {
                if (productIds.length === 0 || !productIds.some(prodId => coupon.applicableTo.products.includes(prodId))) {
                    return false;
                }
            }
            
            // Check supported areas restriction
            if (coupon.applicableTo.supportedAreas && coupon.applicableTo.supportedAreas.length > 0) {
                if (areaIds.length === 0 || !areaIds.some(areaId => coupon.applicableTo.supportedAreas.includes(areaId))) {
                    return false;
                }
            }
            
            return true;
        });

        return res.status(200).json(filteredCoupons);
    } catch (err) {
        return res.status(400).json({
            message: 'Failed to fetch available coupons'
        });
    }
});

// Get coupons available for a specific customer
router.get('/api/coupons/customer/:customerId/available', async (req, res) => {
    const appName = req.headers['app-name'];
    const db = req.app.db[appName];
    const customerId = req.params.customerId;
    const requestAppName = req.query.appName;
    const categoryIds = req.query.categoryIds ? req.query.categoryIds.split(',') : [];
    const productIds = req.query.productIds ? req.query.productIds.split(',') : [];
    const areaIds = req.query.areaIds ? req.query.areaIds.split(',') : [];

    try {
        const offsetHours = getUTCOffset();
        const currentTime = moment().utcOffset(offsetHours).toDate();
        const coupons = await db.coupons.find({
            isActive: true,
            start: { $lte: currentTime },
            end: { $gte: currentTime },
            $or: [
                { isCustomerSpecific: false }, // General coupons
                { 
                    isCustomerSpecific: true, 
                    customerId: customerId 
                } // Customer-specific coupons for this customer
            ]
        }).toArray();

        // Filter coupons based on applicableTo restrictions
        const filteredCoupons = coupons.filter(coupon => {
            if (!coupon.applicableTo) {
                return true; // No restrictions, apply to all
            }
            
            // Check stores restriction
            if (coupon.applicableTo.stores && coupon.applicableTo.stores.length > 0) {
                if (!requestAppName || !coupon.applicableTo.stores.includes(requestAppName)) {
                    return false;
                }
            }
            
            // Check categories restriction
            if (coupon.applicableTo.categories && coupon.applicableTo.categories.length > 0) {
                if (categoryIds.length === 0 || !categoryIds.some(catId => coupon.applicableTo.categories.includes(catId))) {
                    return false;
                }
            }
            
            // Check products restriction
            if (coupon.applicableTo.products && coupon.applicableTo.products.length > 0) {
                if (productIds.length === 0 || !productIds.some(prodId => coupon.applicableTo.products.includes(prodId))) {
                    return false;
                }
            }
            
            // Check supported areas restriction
            if (coupon.applicableTo.supportedAreas && coupon.applicableTo.supportedAreas.length > 0) {
                if (areaIds.length === 0 || !areaIds.some(areaId => coupon.applicableTo.supportedAreas.includes(areaId))) {
                    return false;
                }
            }
            
            return true;
        });

        return res.status(200).json(filteredCoupons);
    } catch (err) {
        return res.status(400).json({
            message: 'Failed to fetch customer coupons'
        });
    }
});

// Get user coupon history
router.get('/api/coupons/user/:userId/history', async (req, res) => {
    const appName = req.headers['app-name'];
    const db = req.app.db[appName];

    try {
        const history = await db.couponUsages.find({
            userId: req.params.userId
        }).sort({ usedAt: -1 }).toArray();

        return res.status(200).json(history);
    } catch (err) {
        return res.status(400).json({
            message: 'Failed to fetch coupon history'
        });
    }
});

// Get auto-apply coupons for a customer
router.get('/api/coupons/auto-apply/:customerId', async (req, res) => {
    const appName ='shoofi';
    const db = req.app.db[appName];
    const customerId = req.params.customerId;
    const requestAppName = req.query.storeId;
    const orderAmount = parseFloat(req.query.orderAmount) || 0;
    const categoryIds = req.query.categoryIds ? req.query.categoryIds.split(',') : [];
    const productIds = req.query.productIds ? req.query.productIds.split(',') : [];
    const areaIds = req.query.areaIds ? req.query.areaIds.split(',') : [];
    
    // Verify that the authenticated user is requesting their own auto-apply coupons


    try {
        const offsetHours = getUTCOffset();
        const currentTime = moment().utcOffset(offsetHours,true).toDate();
        
        console.log('Auto-apply query debug:');
        console.log('Current time (with offset):', currentTime);
        console.log('App name:', appName);
        console.log('Customer ID:', customerId);
        console.log('Store ID:', requestAppName);
        console.log('Order amount:', orderAmount, 'Type:', typeof orderAmount);
        console.log('Category IDs:', categoryIds);
        console.log('Product IDs:', productIds);
        console.log('Area IDs:', areaIds);
        
        const autoApplyCoupons = await db.coupons.find({
            isActive: true,
            isAutoApply: true,
            start: { $lte: currentTime },
            end: { $gte: currentTime },
            $or: [
                { isCustomerSpecific: false }, // General auto-apply coupons
                { 
                    isCustomerSpecific: true, 
                    customerId: customerId 
                } // Customer-specific auto-apply coupons for this customer
            ]
        }).toArray();

        console.log('=== FILTERING COUPONS ===');
        console.log('Total coupons before filtering:', autoApplyCoupons.length);
        
        const customerSpecificCoupon = autoApplyCoupons.find(coupon => 
            coupon.isCustomerSpecific && coupon.customerId === customerId && orderAmount >= coupon.minOrderAmount
        );
        
        if (customerSpecificCoupon) {
            // Check usage limits for customer-specific coupon
            const usageCount = await db.couponUsages.countDocuments({ 
                couponCode: customerSpecificCoupon.code 
            });
            
            const userUsageCount = await db.couponUsages.countDocuments({ 
                couponCode: customerSpecificCoupon.code,
                userId: customerId
            });
            
            // Check if coupon has reached its total usage limit
            if (customerSpecificCoupon.usageLimit && usageCount >= customerSpecificCoupon.usageLimit) {
                console.log('Customer-specific coupon reached total usage limit:', customerSpecificCoupon.code);
                // Continue to general coupons instead of returning empty
            } else if (customerSpecificCoupon.usagePerUser && userUsageCount >= customerSpecificCoupon.usagePerUser) {
                console.log('Customer-specific coupon reached per-user usage limit:', customerSpecificCoupon.code);
                // Continue to general coupons instead of returning empty
            } else {
                console.log('Found valid customer-specific coupon:', customerSpecificCoupon.code);
                return res.status(200).json([customerSpecificCoupon]);
            }
        }
        // Filter coupons based on applicableTo restrictions and minimum order amount
        const filteredCoupons = [];
        
        for (const coupon of autoApplyCoupons) {
            console.log(`\nChecking coupon ${coupon.code}:`);
            console.log(`  - Original minOrderAmount: ${coupon.minOrderAmount} (${typeof coupon.minOrderAmount})`);
        
            // Check minimum order amount first - ensure both are numbers
            const couponMinOrderAmount = parseFloat(coupon.minOrderAmount) || 0;
            console.log(`  - Parsed minOrderAmount: ${couponMinOrderAmount} (${typeof couponMinOrderAmount})`);
            console.log(`  - Order amount: ${orderAmount} (${typeof orderAmount})`);
            
            if (couponMinOrderAmount > 0 && orderAmount < couponMinOrderAmount) {
                console.log(`  ❌ FILTERED OUT: ${orderAmount} < ${couponMinOrderAmount}`);
                continue;
            }
            
            console.log(`  ✅ PASSED minOrderAmount check: ${orderAmount} >= ${couponMinOrderAmount || 'none'}`);
            
            // Check usage limits
            const usageCount = await db.couponUsages.countDocuments({ 
                couponCode: coupon.code 
            });
            
            const userUsageCount = await db.couponUsages.countDocuments({ 
                couponCode: coupon.code,
                userId: customerId
            });
            
            // Check if coupon has reached its total usage limit
            if (coupon.usageLimit && usageCount >= coupon.usageLimit) {
                console.log(`  ❌ FILTERED OUT: Reached total usage limit (${usageCount}/${coupon.usageLimit})`);
                continue;
            }
            
            // Check if user has reached their per-user usage limit
            if (coupon.usagePerUser && userUsageCount >= coupon.usagePerUser) {
                console.log(`  ❌ FILTERED OUT: Reached per-user usage limit (${userUsageCount}/${coupon.usagePerUser})`);
                continue;
            }
            
            if (!coupon.applicableTo) {
                filteredCoupons.push(coupon); // No restrictions, apply to all
                continue;
            }
            
            // Check stores restriction
            if (coupon.applicableTo.stores && coupon.applicableTo.stores.length > 0) {
                if (!requestAppName || !coupon.applicableTo.stores.includes(requestAppName)) {
                    console.log(`  ❌ FILTERED OUT: Store restriction (${requestAppName} not in ${coupon.applicableTo.stores})`);
                    continue;
                }
            }
            
            // Check categories restriction
            if (coupon.applicableTo.categories && coupon.applicableTo.categories.length > 0) {
                if (categoryIds.length === 0 || !categoryIds.some(catId => coupon.applicableTo.categories.includes(catId))) {
                    console.log(`  ❌ FILTERED OUT: Category restriction (${categoryIds} not matching ${coupon.applicableTo.categories})`);
                    continue;
                }
            }
            
            // Check products restriction
            if (coupon.applicableTo.products && coupon.applicableTo.products.length > 0) {
                if (productIds.length === 0 || !productIds.some(prodId => coupon.applicableTo.products.includes(prodId))) {
                    console.log(`  ❌ FILTERED OUT: Product restriction (${productIds} not matching ${coupon.applicableTo.products})`);
                    continue;
                }
            }
            
            // Check supported areas restriction
            if (coupon.applicableTo.supportedAreas && coupon.applicableTo.supportedAreas.length > 0) {
                if (areaIds.length === 0 || !areaIds.some(areaId => coupon.applicableTo.supportedAreas.includes(areaId))) {
                    console.log(`  ❌ FILTERED OUT: Area restriction (${areaIds} not matching ${coupon.applicableTo.supportedAreas})`);
                    continue;
                }
            }
            
            console.log(`  ✅ PASSED all checks, adding to filtered coupons`);
            filteredCoupons.push(coupon);
        }

        console.log(`\n=== FILTERING COMPLETE ===`);
        console.log(`Coupons after filtering: ${filteredCoupons.length}`);
        filteredCoupons.forEach(coupon => {
            console.log(`  - ${coupon.code}: minOrderAmount=${coupon.minOrderAmount}`);
        });

        // Check if there's a customer-specific coupon first
  
        
        // If no customer-specific coupon, score and select the best general coupon
        const scoredCoupons = filteredCoupons.map(coupon => {
            let score = 0;
            
            // Calculate discount amount for scoring
            let discountAmount = 0;
            switch (coupon.type) {
                case 'percentage':
                    discountAmount = (orderAmount * coupon.value) / 100;
                    if (coupon.maxDiscount) {
                        discountAmount = Math.min(discountAmount, coupon.maxDiscount);
                    }
                    break;
                case 'fixed_amount':
                    discountAmount = coupon.value;
                    break;
                case 'free_delivery':
                    discountAmount = req.query.deliveryFee ? parseFloat(req.query.deliveryFee) : 0;
                    break;
            }
            
            // Primary scoring: Higher minimum order amount (better deal when order qualifies)
            const couponMinOrderAmount = parseFloat(coupon.minOrderAmount) || 0;
            if (couponMinOrderAmount > 0) {
                // Higher min order amount gets higher score (better deal)
                score += couponMinOrderAmount * 1000;
            } else {
                // No minimum order amount gets base score
                score += 0;
            }
            
            // Secondary scoring: Higher discount amount
            score += discountAmount * 100;
            
            // Quaternary scoring: More specific restrictions (more targeted = better)
            let restrictionCount = 0;
            if (coupon.applicableTo) {
                if (coupon.applicableTo.stores && coupon.applicableTo.stores.length > 0) restrictionCount++;
                if (coupon.applicableTo.categories && coupon.applicableTo.categories.length > 0) restrictionCount++;
                if (coupon.applicableTo.products && coupon.applicableTo.products.length > 0) restrictionCount++;
                if (coupon.applicableTo.supportedAreas && coupon.applicableTo.supportedAreas.length > 0) restrictionCount++;
            }
            score += restrictionCount * 10;
            
            return {
                ...coupon,
                score: score,
                discountAmount: discountAmount
            };
        });
        
        // Sort by score (highest first) and return only the best match
        scoredCoupons.sort((a, b) => b.score - a.score);
        
        const bestCoupon = scoredCoupons.length > 0 ? scoredCoupons[0] : null;
        
        console.log('Found auto-apply coupons:', filteredCoupons.length);
        console.log('Scored coupons:', scoredCoupons.map(c => ({ code: c.code, score: c.score, discountAmount: c.discountAmount })));
        console.log('Best coupon:', bestCoupon ? { code: bestCoupon.code, score: bestCoupon.score, discountAmount: bestCoupon.discountAmount } : null);

        // Return only the best coupon (remove score and discountAmount from response)
        if (bestCoupon) {
            const { score, discountAmount, ...couponResponse } = bestCoupon;
            return res.status(200).json([couponResponse]);
        }
        
        return res.status(200).json([]);
    } catch (err) {
        console.error('Error fetching auto-apply coupons:', err);
        return res.status(400).json({
            message: 'Failed to fetch auto-apply coupons'
        });
    }
});

// Admin routes
router.get('/api/admin/coupons',  async (req, res) => {
    const appName = req.headers['app-name'];
    const db = req.app.db[appName];

    try {
        // Get all coupons
        const coupons = await db.coupons.find().toArray();
        
        // Get usage statistics for each coupon
        const couponsWithUsage = await Promise.all(coupons.map(async (coupon) => {
            const usageCount = await db.couponUsages.countDocuments({ 
                couponCode: coupon.code 
            });
            
            return {
                ...coupon,
                usageCount: usageCount,
                isUsed: usageCount > 0
            };
        }));
        
        return res.status(200).json(couponsWithUsage);
    } catch (error) {
        console.error('Error fetching coupons with usage:', error);
        return res.status(500).json({
            message: 'Failed to fetch coupons'
        });
    }
});

// Create coupon
router.post('/api/admin/coupon/create', upload.array("img"), async (req, res) => {
    const appName = req.headers['app-name'];
    const db = req.app.db[appName];
    
    // Debug: Log what's being received
    console.log('Create coupon request body:', req.body);
    console.log('Create coupon request files:', req.files);
    
    // Handle file upload if present
    let image = null;
    if (req.files && req.files.length > 0) {
        try {
            const images = await uploadFile(req.files, req, "coupons");
            image = images.length > 0 ? images[0] : null;
        } catch (uploadError) {
            console.error('File upload error:', uploadError);
            return res.status(400).json({
                message: 'Failed to upload image'
            });
        }
    }
    
    // Handle fields that might come as arrays due to FormData duplication
    const code = Array.isArray(req.body.code) ? req.body.code[0] : req.body.code;
    
    // Helper function to safely extract field values
    const getFieldValue = (fieldName) => {
        const value = req.body[fieldName];
        return Array.isArray(value) ? value[0] : value;
    };
    
    // Validate required fields
    const requiredFields = ['name', 'type', 'value', 'usageLimit', 'usagePerUser', 'start', 'end'];
    const missingFields = requiredFields.filter(field => !getFieldValue(field));
    
    // Check code separately
    if (!code) {
        return res.status(400).json({
            message: 'Missing required field: code'
        });
    }
    
    if (missingFields.length > 0) {
        return res.status(400).json({
            message: `Missing required fields: ${missingFields.join(', ')}`
        });
    }
    
    const exists = await db.coupons.findOne({ code: code.toUpperCase() });
    if(exists){
        return res.status(400).json({
            message: 'Coupon code already exists'
        });
    }
    
    // Parse boolean values from FormData
    const isCustomerSpecific = getFieldValue('isCustomerSpecific') === 'true' || getFieldValue('isCustomerSpecific') === true;
    const isAutoApply = getFieldValue('isAutoApply') === 'true' || getFieldValue('isAutoApply') === true;
    const isActive = getFieldValue('isActive') === 'true' || getFieldValue('isActive') === true;
    
    // Validate customer-specific coupon
    if (isCustomerSpecific && !getFieldValue('customerId')) {
        return res.status(400).json({
            message: 'Customer ID is required for customer-specific coupons'
        });
    }
    
    const offsetHours = getUTCOffset();
    
    // Parse arrays from JSON strings if they come from FormData
    const parseArrayField = (field) => {
        if (typeof field === 'string') {
            try {
                return JSON.parse(field);
            } catch (e) {
                return [];
            }
        }
        return field || [];
    };
    
    const couponDoc = {
        code: code.toUpperCase(),
        name: getFieldValue('name'),
        nameForStore: getFieldValue('nameForStore') || '',
        subNameForStore: getFieldValue('subNameForStore') || '',
        storeTagName: getFieldValue('storeTagName') || '',
        nameForCheckout: getFieldValue('nameForCheckout') || '',
        nameForPartner: getFieldValue('nameForPartner') || '',
        nameForShoofir: getFieldValue('nameForShoofir') || '',
        type: getFieldValue('type'),
        discountType: getFieldValue('discountType') || 'order_items',
        value: parseFloat(getFieldValue('value')),
        maxDiscount: getFieldValue('type') === 'free_delivery' ? null : (getFieldValue('maxDiscount') ? parseFloat(getFieldValue('maxDiscount')) : null),
        minOrderAmount: getFieldValue('type') === 'free_delivery' ? null : (getFieldValue('minOrderAmount') ? parseFloat(getFieldValue('minOrderAmount')) : null),
        usageLimit: parseInt(getFieldValue('usageLimit')),
        usagePerUser: parseInt(getFieldValue('usagePerUser')),
        start: moment.tz(getFieldValue('start'), 'Asia/Jerusalem').toDate(),
        end: moment.tz(getFieldValue('end'), 'Asia/Jerusalem').toDate(),
        applicableTo: {
            categories: parseArrayField(req.body.categories),
            products: parseArrayField(req.body.products),
            stores: parseArrayField(req.body.stores),
            supportedAreas: parseArrayField(req.body.supportedAreas)
        },
        isActive: isActive,
        isCustomerSpecific: isCustomerSpecific,
        customerId: isCustomerSpecific ? getFieldValue('customerId') : null,
        isAutoApply: isAutoApply,
        color: getFieldValue('color') || 'white',
        image: image
    };

    // Validate schema - only include customerId in validation if isCustomerSpecific is true
    const validationDoc = { ...couponDoc };
    if (!isCustomerSpecific) {
        delete validationDoc.customerId;
    }
    
    const schemaValidate = validateJson('newCoupon', validationDoc);
    if (!schemaValidate.result) {
        return res.status(400).json(schemaValidate.errors);
    }

    // Check if code exists
    const existingCoupon = await db.coupons.findOne({ code: couponDoc.code });
    if (existingCoupon) {
        return res.status(400).json({
            message: 'Coupon code already exists'
        });
    }
    // Validate dates
    if (moment(couponDoc.start).utcOffset(offsetHours).isBefore(moment().utcOffset(offsetHours))) {
        return res.status(400).json({
            message: 'Start date must be in the future'
        });
    }

    if (!moment(couponDoc.end).utcOffset(offsetHours).isAfter(moment(couponDoc.start).utcOffset(offsetHours))) {
        return res.status(400).json({
            message: 'End date must be after start date'
        });
    }

    try {
        const result = await db.coupons.insertOne(couponDoc);
        return res.status(200).json({
            message: 'Coupon created successfully',
            couponId: result.insertedId
        });
    } catch (err) {
        return res.status(400).json({
            message: 'Failed to create coupon'
        });
    }
});

// Update coupon
router.post('/api/admin/coupon/update', upload.array("img"), async (req, res) => {
    const appName = req.headers['app-name'];
    const db = req.app.db[appName];

    // Debug: Log what's being received
    console.log('Update coupon request body:', req.body);
    console.log('Update coupon request files:', req.files);

    // Handle file upload if present
    let image = null;
    if (req.files && req.files.length > 0) {
        try {
            const images = await uploadFile(req.files, req, "coupons");
            image = images.length > 0 ? images[0] : null;
        } catch (uploadError) {
            console.error('File upload error:', uploadError);
            return res.status(400).json({
                message: 'Failed to upload image'
            });
        }
    }

    // Handle fields that might come as arrays due to FormData duplication
    const couponId = Array.isArray(req.body.couponId) ? req.body.couponId[0] : req.body.couponId;
    const code = Array.isArray(req.body.code) ? req.body.code[0] : req.body.code;
    
    // Helper function to safely extract field values
    const getFieldValue = (fieldName) => {
        const value = req.body[fieldName];
        return Array.isArray(value) ? value[0] : value;
    };
    
    // Validate required fields
    const requiredFields = ['name', 'type', 'value', 'usageLimit', 'usagePerUser', 'start', 'end'];
    const missingFields = requiredFields.filter(field => !getFieldValue(field));
    
    // Check couponId and code separately
    if (!couponId) {
        return res.status(400).json({
            message: 'Missing required field: couponId'
        });
    }
    
    if (!code) {
        return res.status(400).json({
            message: 'Missing required field: code'
        });
    }
    
    if (missingFields.length > 0) {
        return res.status(400).json({
            message: `Missing required fields: ${missingFields.join(', ')}`
        });
    }
    
    // Parse boolean values from FormData
    const isCustomerSpecific = getFieldValue('isCustomerSpecific') === 'true' || getFieldValue('isCustomerSpecific') === true;
    const isAutoApply = getFieldValue('isAutoApply') === 'true' || getFieldValue('isAutoApply') === true;
    const isActive = getFieldValue('isActive') === 'true' || getFieldValue('isActive') === true;
    
    // Validate customer-specific coupon
    if (isCustomerSpecific && !getFieldValue('customerId')) {
        return res.status(400).json({
            message: 'Customer ID is required for customer-specific coupons'
        });
    }

    // Get existing coupon to handle image updates
    const currentCoupon = await db.coupons.findOne({ _id: getId(couponId) });
    if (!currentCoupon) {
        return res.status(404).json({
            message: 'Coupon not found'
        });
    }

    // Handle image update
    let finalImage = currentCoupon.image;
    
    // Check if user wants to remove the image
    const shouldRemoveImage = getFieldValue('removeImage') === 'true';
    
    if (shouldRemoveImage) {
        // User wants to remove the image
        finalImage = null;
        
        // Delete old image if it exists
        if (currentCoupon.image) {
            await deleteImages([currentCoupon.image], req);
        }
    } else if (req.files && req.files.length > 0) {
        // New image uploaded
        finalImage = image;
        
        // Delete old image if it exists
        if (currentCoupon.image) {
            await deleteImages([currentCoupon.image], req);
        }
    }
    
    // Debug: Log the final image structure
    console.log('Final image structure:', finalImage);

    const offsetHours = getUTCOffset();
    // Parse arrays from JSON strings if they come from FormData
    const parseArrayField = (field) => {
        if (typeof field === 'string') {
            try {
                return JSON.parse(field);
            } catch (e) {
                return [];
            }
        }
        return field || [];
    };

    const couponDoc = {
        couponId: couponId,
        code: code.toUpperCase(),
        name: getFieldValue('name'),
        nameForStore: getFieldValue('nameForStore') || '',
        subNameForStore: getFieldValue('subNameForStore') || '',
        storeTagName: getFieldValue('storeTagName') || '',
        nameForCheckout: getFieldValue('nameForCheckout') || '',
        nameForPartner: getFieldValue('nameForPartner') || '',
        nameForShoofir: getFieldValue('nameForShoofir') || '',
        type: getFieldValue('type'),
        discountType: getFieldValue('discountType') || 'order_items',
        value: parseFloat(getFieldValue('value')),
        maxDiscount: getFieldValue('type') === 'free_delivery' ? null : (getFieldValue('maxDiscount') ? parseFloat(getFieldValue('maxDiscount')) : null),
        minOrderAmount: getFieldValue('type') === 'free_delivery' ? null : (getFieldValue('minOrderAmount') ? parseFloat(getFieldValue('minOrderAmount')) : null),
        usageLimit: parseInt(getFieldValue('usageLimit')),
        usagePerUser: parseInt(getFieldValue('usagePerUser')),
        start: moment.tz(getFieldValue('start'), 'Asia/Jerusalem').toDate(),
        end: moment.tz(getFieldValue('end'), 'Asia/Jerusalem').toDate(),
        applicableTo: {
            categories: parseArrayField(req.body.categories),
            products: parseArrayField(req.body.products),
            stores: parseArrayField(req.body.stores),
            supportedAreas: parseArrayField(req.body.supportedAreas)
        },
        isActive: isActive,
        isCustomerSpecific: isCustomerSpecific,
        customerId: isCustomerSpecific ? getFieldValue('customerId') : null,
        isAutoApply: isAutoApply,
        color: getFieldValue('color') || 'white',
        image: finalImage
    };

    // Validate schema - only include customerId in validation if isCustomerSpecific is true
    const validationDoc = { ...couponDoc };
    if (!isCustomerSpecific) {
        delete validationDoc.customerId;
    }
    
    // Debug: Log the validation document
    console.log('Validation document:', JSON.stringify(validationDoc, null, 2));
    
    const schemaValidate = validateJson('editCoupon', validationDoc);
    if (!schemaValidate.result) {
        console.log('Schema validation errors:', schemaValidate.errors);
        return res.status(400).json(schemaValidate.errors);
    }

    // Check if code exists (excluding current coupon)
    const duplicateCoupon = await db.coupons.findOne({
        code: couponDoc.code,
        _id: { $ne: getId(couponDoc.couponId) }
    });
    if (duplicateCoupon) {
        return res.status(400).json({
            message: 'Coupon code already exists'
        });
    }

    // Validate dates
    if (!moment(couponDoc.end).utcOffset(offsetHours).isAfter(moment(couponDoc.start).utcOffset(offsetHours))) {
        return res.status(400).json({
            message: 'End date must be after start date'
        });
    }

    try {
        const { couponId, ...updateData } = couponDoc;
        await db.coupons.updateOne(
            { _id: getId(couponId) },
            { $set: updateData }
        );
        return res.status(200).json({
            message: 'Coupon updated successfully'
        });
    } catch (err) {
        return res.status(400).json({
            message: 'Failed to update coupon'
        });
    }
});

// Delete coupon
router.delete('/api/admin/coupon/delete',  async (req, res) => {
    const appName = req.headers['app-name'];
    const db = req.app.db[appName];

    try {
        await db.coupons.deleteOne({ _id: getId(req.body.couponId) });
        return res.status(200).json({
            message: 'Coupon deleted successfully'
        });
    } catch (err) {
        return res.status(400).json({
            message: 'Failed to delete coupon'
        });
    }
});

// Coupon usage analytics (admin)
router.get('/api/coupons/admin/usage', async (req, res) => {
    const appName = req.headers['app-name'] || 'shoofi';
    const db = req.app.db[appName];
    try {
        const usageStats = await db.couponUsages.aggregate([
            {
                $group: {
                    _id: "$couponCode",
                    totalUsage: { $sum: 1 },
                    totalDiscount: { $sum: "$discountAmount" }
                }
            },
            {
                $project: {
                    _id: 0,
                    couponCode: "$_id",
                    totalUsage: 1,
                    totalDiscount: 1
                }
            }
        ]).toArray();
        return res.status(200).json(usageStats);
    } catch (err) {
        return res.status(400).json({
            message: 'Failed to fetch coupon usage analytics'
        });
    }
});

// Helper to generate a unique coupon code
async function generateUniqueCouponCode(db, length = 8) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code, exists;
    do {
        code = Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
        exists = await db.coupons.findOne({ code });
    } while (exists);
    return code;
}

// API to generate a unique coupon code
router.get('/api/admin/coupon/generate-code', async (req, res) => {
    const appName = req.headers['app-name'] || 'shoofi';
    const db = req.app.db[appName];
    try {
        const code = await generateUniqueCouponCode(db);
        res.status(200).json({ code });
    } catch (err) {
        res.status(500).json({ message: 'Failed to generate coupon code' });
    }
});

module.exports = router; 