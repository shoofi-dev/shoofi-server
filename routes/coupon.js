const express = require('express');
const router = express.Router();
const moment = require('moment');
const momentTZ = require('moment-timezone');
const { validateJson } = require('../lib/schema');
const { getId } = require('../lib/common');

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

// Get available coupons
router.get('/api/coupons/available', async (req, res) => {
    const appName = req.headers['app-name'];
    const db = req.app.db[appName];

    try {
        const offsetHours = getUTCOffset();
        const currentTime = moment().utcOffset(offsetHours).toDate();
        const coupons = await db.coupons.find({
            isActive: true,
            start: { $lte: currentTime },
            end: { $gte: currentTime }
        }).toArray();

        return res.status(200).json(coupons);
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

        return res.status(200).json(coupons);
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

    try {
        const offsetHours = getUTCOffset();
        const currentTime = moment().utcOffset(offsetHours,true).toDate();
        
        console.log('Auto-apply query debug:');
        console.log('Current time (with offset):', currentTime);
        console.log('App name:', appName);
        console.log('Customer ID:', customerId);
        
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

        console.log('Found auto-apply coupons:', autoApplyCoupons.length);
        console.log('Coupons:', autoApplyCoupons);

        return res.status(200).json(autoApplyCoupons);
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
router.post('/api/admin/coupon/create',  async (req, res) => {
    const appName = req.headers['app-name'];
    const db = req.app.db[appName];
    const exists = await db.coupons.findOne({ code: req.body.code.toUpperCase() });
    if(exists){
        return res.status(400).json({
            message: 'Coupon code already exists'
        });
    }
    
    // Validate customer-specific coupon
    if (req.body.isCustomerSpecific && !req.body.customerId) {
        return res.status(400).json({
            message: 'Customer ID is required for customer-specific coupons'
        });
    }
    
    const offsetHours = getUTCOffset();
    const couponDoc = {
        code: req.body.code.toUpperCase(),
        type: req.body.type,
        value: req.body.type === 'free_delivery' ? 0 : parseFloat(req.body.value),
        maxDiscount: req.body.type === 'free_delivery' ? null : (req.body.maxDiscount ? parseFloat(req.body.maxDiscount) : null),
        minOrderAmount: req.body.type === 'free_delivery' ? null : (req.body.minOrderAmount ? parseFloat(req.body.minOrderAmount) : null),
        usageLimit: parseInt(req.body.usageLimit),
        usagePerUser: parseInt(req.body.usagePerUser),
        start: moment.tz(req.body.start, 'Asia/Jerusalem').toDate(),
        end: moment.tz(req.body.end, 'Asia/Jerusalem').toDate(),
        applicableTo: {
            categories: req.body.categories || [],
            products: req.body.products || [],
            stores: req.body.stores || []
        },
        isActive: true,
        isCustomerSpecific: req.body.isCustomerSpecific || false,
        customerId: req.body.isCustomerSpecific ? req.body.customerId : null,
        isAutoApply: req.body.isAutoApply || false
    };

    // Validate schema - only include customerId in validation if isCustomerSpecific is true
    const validationDoc = { ...couponDoc };
    if (!req.body.isCustomerSpecific) {
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
router.post('/api/admin/coupon/update',  async (req, res) => {
    const appName = req.headers['app-name'];
    const db = req.app.db[appName];

    // Validate customer-specific coupon
    if (req.body.isCustomerSpecific && !req.body.customerId) {
        return res.status(400).json({
            message: 'Customer ID is required for customer-specific coupons'
        });
    }

    const offsetHours = getUTCOffset();
    const couponDoc = {
        couponId: req.body.couponId,
        code: req.body.code.toUpperCase(),
        type: req.body.type,
        value: req.body.type === 'free_delivery' ? 0 : parseFloat(req.body.value),
        maxDiscount: req.body.type === 'free_delivery' ? null : (req.body.maxDiscount ? parseFloat(req.body.maxDiscount) : null),
        minOrderAmount: req.body.type === 'free_delivery' ? null : (req.body.minOrderAmount ? parseFloat(req.body.minOrderAmount) : null),
        usageLimit: parseInt(req.body.usageLimit),
        usagePerUser: parseInt(req.body.usagePerUser),
        start: moment.tz(req.body.start, 'Asia/Jerusalem').toDate(),
        end: moment.tz(req.body.end, 'Asia/Jerusalem').toDate(),
        applicableTo: {
            categories: req.body.categories || [],
            products: req.body.products || [],
            stores: req.body.stores || []
        },
        isActive: req.body.isActive,
        isCustomerSpecific: req.body.isCustomerSpecific || false,
        customerId: req.body.isCustomerSpecific ? req.body.customerId : null,
        isAutoApply: req.body.isAutoApply || false
    };

    // Validate schema - only include customerId in validation if isCustomerSpecific is true
    const validationDoc = { ...couponDoc };
    if (!req.body.isCustomerSpecific) {
        delete validationDoc.customerId;
    }
    
    const schemaValidate = validateJson('editCoupon', validationDoc);
    if (!schemaValidate.result) {
        return res.status(400).json(schemaValidate.errors);
    }

    // Check if code exists (excluding current coupon)
    const existingCoupon = await db.coupons.findOne({
        code: couponDoc.code,
        _id: { $ne: getId(couponDoc.couponId) }
    });
    if (existingCoupon) {
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