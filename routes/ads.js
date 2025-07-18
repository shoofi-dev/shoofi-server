const express = require("express");
const router = express.Router();
const { getId } = require("../lib/common");
const { uploadFile, deleteImages } = require("./product");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });
const websocketService = require("../services/websocket/websocket-service");

// Helper function to check if ad is currently valid
const isAdCurrentlyValid = (ad) => {
  const now = new Date();
  const startDate = new Date(ad.startDate);
  const endDate = new Date(ad.endDate);
  return startDate <= now && endDate >= now;
};

// Helper function to send WebSocket notification to customers
const notifyCustomersAboutAd = async (action, ad) => {
  try {
    // Only notify if the ad is currently valid or will be valid in the future
    const now = new Date();
    const startDate = new Date(ad.startDate);
    const endDate = new Date(ad.endDate);
    
    // Check if ad is currently valid or will be valid in the future
    if (endDate >= now) {
      await websocketService.sendToAppCustomers('shoofi-shopping', {
        type: 'ads_updated',
        data: {
          action: action, // 'added', 'updated', or 'deleted'
          adId: ad._id,
          title: ad.titleHE || ad.titleAR,
          appName: ad.appName,
          startDate: ad.startDate,
          endDate: ad.endDate,
          isCurrentlyValid: isAdCurrentlyValid(ad),
          timestamp: new Date().toISOString()
        }
      });
    }
  } catch (error) {
    console.error('Failed to send WebSocket notification for ad:', error);
  }
};

// List all ads
router.get("/list", async (req, res) => {
  try {
    const dbAdmin = req.app.db['shoofi'];
    const ads = await dbAdmin.ads.find().toArray();
    res.status(200).json(ads);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch ads', error: err.message });
  }
});

// Get valid ads for customers (based on current time)
router.get("/valid", async (req, res) => {
  try {
    const dbAdmin = req.app.db['shoofi'];
    const now = new Date();
    
    // Find ads where current time is between startDate and endDate
    const validAds = await dbAdmin.ads.find({
      startDate: { $lte: now.toISOString() },
      endDate: { $gte: now.toISOString() }
    }).toArray();
    
    res.status(200).json(validAds);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch valid ads', error: err.message });
  }
});

// Get ads by date range (for admin)
router.get("/by-date-range", async (req, res) => {
  try {
    const dbAdmin = req.app.db['shoofi'];
    const { startDate, endDate, page = 1, limit = 10 } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'startDate and endDate are required' });
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build query for date range
    const dateQuery = {
      $or: [
        // Ads that start within the range
        {
          startDate: { 
            $gte: new Date(startDate).toISOString(),
            $lte: new Date(endDate).toISOString()
          }
        },
        // Ads that end within the range
        {
          endDate: { 
            $gte: new Date(startDate).toISOString(),
            $lte: new Date(endDate).toISOString()
          }
        },
        // Ads that span the entire range
        {
          startDate: { $lte: new Date(startDate).toISOString() },
          endDate: { $gte: new Date(endDate).toISOString() }
        }
      ]
    };
    
    // Get ads with pagination
    const ads = await dbAdmin.ads.find(dateQuery)
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ startDate: -1 })
      .toArray();
    
    // Get total count for pagination
    const total = await dbAdmin.ads.countDocuments(dateQuery);
    
    res.status(200).json({
      ads,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch ads by date range', error: err.message });
  }
});

// Get ad by id
router.get("/:id", async (req, res) => {
  try {
    const dbAdmin = req.app.db['shoofi'];
    const { id } = req.params;
    const ad = await dbAdmin.ads.findOne({ _id: getId(id) });
    if (!ad) {
      return res.status(404).json({ message: 'Ad not found' });
    }
    res.status(200).json(ad);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch ad', error: err.message });
  }
});

// Add new ad
router.post("/add", upload.array("img"), async (req, res) => {
  try {
    const dbAdmin = req.app.db['shoofi'];
    const { titleAR, titleHE, descriptionAR, descriptionHE, startDate, endDate, appName } = req.body;
    if (!titleAR || !titleHE || !descriptionAR || !descriptionHE || !startDate || !endDate) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    let images = [];
    if (req.files && req.files.length > 0) {
      images = await uploadFile(req.files, req, "ads");
    }
    const now = new Date();
    const newAd = {
      _id: getId(),
      titleAR,
      titleHE,
      descriptionAR,
      descriptionHE,
      image: images.length > 0 ? images[0] : '',
      startDate,
      endDate,
      appName: appName || null, // Store appName if provided
      createdAt: now,
      updatedAt: now
    };
    await dbAdmin.ads.insertOne(newAd);
    
    // Send WebSocket notification to customers
    await notifyCustomersAboutAd('added', newAd);
    
    res.status(201).json(newAd);
  } catch (err) {
    res.status(500).json({ message: 'Failed to add ad', error: err.message });
  }
});

// Update ad
router.post("/update/:id", upload.array("img"), async (req, res) => {
  try {
    const dbAdmin = req.app.db['shoofi'];
    const { id } = req.params;
    const { titleAR, titleHE, descriptionAR, descriptionHE, startDate, endDate, appName } = req.body;
    if (!titleAR || !titleHE || !descriptionAR || !descriptionHE || !startDate || !endDate) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    const ad = await dbAdmin.ads.findOne({ _id: getId(id) });
    if (!ad) {
      return res.status(404).json({ message: 'Ad not found' });
    }
    let image = ad.image;
    if (req.files && req.files.length > 0) {
      image = (await uploadFile(req.files, req, "ads"))[0];
      if (ad.image) {
        await deleteImages([ad.image], req);
      }
    }
    const updatedAd = {
      ...ad,
      titleAR,
      titleHE,
      descriptionAR,
      descriptionHE,
      image,
      startDate,
      endDate,
      appName: appName || null, // Update appName if provided
      updatedAt: new Date()
    };
    await dbAdmin.ads.updateOne({ _id: getId(id) }, { $set: updatedAd });
    
    // Send WebSocket notification to customers
    await notifyCustomersAboutAd('updated', updatedAd);
    
    res.status(200).json(updatedAd);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update ad', error: err.message });
  }
});

// Delete ad
router.delete("/:id", async (req, res) => {
  try {
    const dbAdmin = req.app.db['shoofi'];
    const { id } = req.params;
    const ad = await dbAdmin.ads.findOne({ _id: getId(id) });
    if (!ad) {
      return res.status(404).json({ message: 'Ad not found' });
    }
    
    // Send WebSocket notification to customers before deleting
    await notifyCustomersAboutAd('deleted', ad);
    
    if (ad.image) {
      await deleteImages([ad.image], req);
    }
    await dbAdmin.ads.deleteOne({ _id: getId(id) });
    res.status(200).json({ message: 'Ad deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete ad', error: err.message });
  }
});

module.exports = router; 