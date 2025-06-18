const express = require('express');
const router = express.Router();
const { getId } = require('../lib/common');

// POST /api/global-search
router.post('/api/global-search', async (req, res) => {
  try {
    const db = req.app.db['shoofi'];
    const { query } = req.body;
    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ message: 'Query is required' });
    }
    const regex = new RegExp(query, 'i');
    // Search stores (restaurants and stores)
    const stores = await db.stores.find({
      $or: [
        { nameAR: regex },
        { nameHE: regex },
        { name: regex }
      ]
    }).limit(10).toArray();
    // Search products
    // const products = await db.products.find({
    //   $or: [
    //     { nameAR: regex },
    //     { nameHE: regex },
    //     { name: regex }
    //   ]
    // }).limit(10).toArray();
    res.json({
      stores,
    //   products
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to perform global search', error: err.message });
  }
});

module.exports = router; 