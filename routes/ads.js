const express = require("express");
const router = express.Router();
const { getId } = require("../lib/common");
const { uploadFile, deleteImages } = require("./product");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

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
    const { titleAR, titleHE, descriptionAR, descriptionHE, startDate, endDate } = req.body;
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
      createdAt: now,
      updatedAt: now
    };
    await dbAdmin.ads.insertOne(newAd);
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
    const { titleAR, titleHE, descriptionAR, descriptionHE, startDate, endDate } = req.body;
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
      updatedAt: new Date()
    };
    await dbAdmin.ads.updateOne({ _id: getId(id) }, { $set: updatedAd });
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