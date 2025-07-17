const express = require('express');
const router = express.Router();
const { validateJson } = require('../lib/schema');
const { getId } = require('../lib/common');
const { getCustomerAppName } = require('../utils/app-name-helper');
const auth = require('./auth');

// Get customer's credit cards
router.get('/api/credit-cards', auth.required, async (req, res) => {
  const appName = 'shoofi'
  const customerDB = req.app.db[appName];
  const customerId = req.auth.id;

  try {
    const creditCards = await customerDB.creditCards.find({
      customerId: getId(customerId),
      isActive: true
    }).sort({ isDefault: -1, created: -1 }).toArray();

    res.status(200).json(creditCards);
  } catch (error) {
    console.error('Error fetching credit cards:', error);
    res.status(500).json({ message: 'Failed to fetch credit cards' });
  }
});

// Add new credit card
router.post('/api/credit-cards', auth.required, async (req, res) => {
  const appName = 'shoofi'
  const customerDB = req.app.db[appName];
  const customerId = req.auth.id;

  try {
    const creditCardData = {
      customerId: getId(customerId),
      ccToken: req.body.ccToken,
      last4Digits: req.body.last4Digits,
      ccType: req.body.ccType,
      cvv: req.body.cvv,
      holderName: req.body.holderName,
      isDefault: req.body.isDefault || false,
      isActive: true,
      created: new Date(),
      updated: new Date()
    };

    // Validate schema
    const schemaValidate = validateJson('creditCard', creditCardData);
    if (!schemaValidate.result) {
      return res.status(400).json(schemaValidate.errors);
    }

    // If this is set as default, unset other default cards
    if (creditCardData.isDefault) {
      await customerDB.creditCards.updateMany(
        { customerId: getId(customerId), isActive: true },
        { $set: { isDefault: false } }
      );
    }

    const result = await customerDB.creditCards.insertOne(creditCardData);
    
    res.status(201).json({
      message: 'Credit card added successfully',
      creditCardId: result.insertedId
    });
  } catch (error) {
    console.error('Error adding credit card:', error);
    res.status(500).json({ message: 'Failed to add credit card' });
  }
});

// Update credit card
router.put('/api/credit-cards/:cardId', auth.required, async (req, res) => {
  const appName = 'shoofi'
  const customerDB = req.app.db[appName];
  const customerId = req.auth.id;
  const cardId = req.params.cardId;

  try {
    const updateData = {
      holderName: req.body.holderName,
      isDefault: req.body.isDefault,
      updated: new Date()
    };

    // If this is set as default, unset other default cards
    if (updateData.isDefault) {
      await customerDB.creditCards.updateMany(
        { customerId: getId(customerId), isActive: true, _id: { $ne: getId(cardId) } },
        { $set: { isDefault: false } }
      );
    }

    const result = await customerDB.creditCards.updateOne(
      { _id: getId(cardId), customerId: getId(customerId) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Credit card not found' });
    }

    res.status(200).json({ message: 'Credit card updated successfully' });
  } catch (error) {
    console.error('Error updating credit card:', error);
    res.status(500).json({ message: 'Failed to update credit card' });
  }
});

// Delete credit card (soft delete)
router.delete('/api/credit-cards/:cardId', auth.required, async (req, res) => {
  const appName = 'shoofi'
  const customerDB = req.app.db[appName];
  const customerId = req.auth.id;
  const cardId = req.params.cardId;

  try {
    const result = await customerDB.creditCards.updateOne(
      { _id: getId(cardId), customerId: getId(customerId) },
      { $set: { isActive: false, updated: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Credit card not found' });
    }

    // If this was the default card, set another card as default
    const deletedCard = await customerDB.creditCards.findOne({ _id: getId(cardId) });
    if (deletedCard && deletedCard.isDefault) {
      const newDefault = await customerDB.creditCards.findOne({
        customerId: getId(customerId),
        isActive: true,
        _id: { $ne: getId(cardId) }
      });
      
      if (newDefault) {
        await customerDB.creditCards.updateOne(
          { _id: newDefault._id },
          { $set: { isDefault: true } }
        );
      }
    }

    res.status(200).json({ message: 'Credit card deleted successfully' });
  } catch (error) {
    console.error('Error deleting credit card:', error);
    res.status(500).json({ message: 'Failed to delete credit card' });
  }
});

// Set default credit card
router.patch('/api/credit-cards/:cardId/default', auth.required, async (req, res) => {
  const appName = 'shoofi'
  const customerDB = req.app.db[appName];
  const customerId = req.auth.id;
  const cardId = req.params.cardId;

  try {
    // Unset all default cards
    await customerDB.creditCards.updateMany(
      { customerId: getId(customerId), isActive: true },
      { $set: { isDefault: false } }
    );

    // Set this card as default
    const result = await customerDB.creditCards.updateOne(
      { _id: getId(cardId), customerId: getId(customerId), isActive: true },
      { $set: { isDefault: true, updated: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: 'Credit card not found' });
    }

    res.status(200).json({ message: 'Default credit card updated successfully' });
  } catch (error) {
    console.error('Error setting default credit card:', error);
    res.status(500).json({ message: 'Failed to set default credit card' });
  }
});

module.exports = router; 