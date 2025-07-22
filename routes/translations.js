const express = require("express");
const router = express.Router();

router.get("/api/getTranslations", async (req, res, next) => {
  try {
    const appName = req.headers['shoofi'] || 'shoofi';
    const db = req.app.db[appName];

    const dbTranslations = await db.translations
      .find()
      .sort({ createdAt: -1, _id: 1 })
      .toArray();
    const arTranslations = {};
    const heTranslations = {};

    dbTranslations.forEach((element) => {
      arTranslations[element.key] = element.ar || element.key;
      heTranslations[element.key] = element.he || element.key;
    });

    const translations = {
      arTranslations,
      heTranslations,
    };

    res.status(200).json(translations);
  } catch (error) {
    console.error('Error fetching translations:', error);
    res.status(500).json({ error: 'Failed to fetch translations' });
  }
});

router.post("/api/translations/update", async (req, res, next) => {
  try {
    const appName = req.headers['app-name'] || 'shoofi';
    const db = req.app.db[appName];
    const doc = req.body;

    await db.translations.updateOne(
      { key: doc.key },
      {
        $set: {
          ar: doc.ar,
          he: doc.he,
          updatedAt: new Date(),
        },
      },
      { multi: false }
    );

    const dbTranslations = await db.translations
      .find()
      .sort({ createdAt: -1, _id: 1 })
      .toArray();

    const arTranslations = {};
    const heTranslations = {};

    dbTranslations.forEach((element) => {
      arTranslations[element.key] = element.ar || element.key;
      heTranslations[element.key] = element.he || element.key;
    });

    const translations = {
      arTranslations,
      heTranslations,
    };

    res.status(200).json(translations);
  } catch (error) {
    console.error('Error updating translation:', error);
    res.status(500).json({ error: 'Failed to update translation' });
  }
});

router.post("/api/translations/add", async (req, res, next) => {
  try {
    const appName = req.headers['app-name'] || 'shoofi';
    const db = req.app.db[appName];
    const doc = req.body;

    await db.translations.insertOne({
      ...doc,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const dbTranslations = await db.translations
      .find()
      .sort({ createdAt: -1, _id: 1 })
      .toArray();

    const arTranslations = {};
    const heTranslations = {};

    dbTranslations.forEach((element) => {
      arTranslations[element.key] = element.ar || element.key;
      heTranslations[element.key] = element.he || element.key;
    });

    const translations = {
      arTranslations,
      heTranslations,
    };

    res.status(200).json(translations);
  } catch (error) {
    console.error('Error adding translation:', error);
    res.status(500).json({ error: 'Failed to add translation' });
  }
});

router.post("/api/translations/delete", async (req, res, next) => {
  try {
    const appName = req.headers['app-name'] || 'shoofi';
    const db = req.app.db[appName];
    const doc = req.body;
    await db.translations.deleteOne({ key: doc.key });

    const dbTranslations = await db.translations
      .find()
      .sort({ createdAt: -1, _id: 1 })
      .toArray();

    const arTranslations = {};
    const heTranslations = {};

    dbTranslations.forEach((element) => {
      arTranslations[element.key] = element.ar || element.key;
      heTranslations[element.key] = element.he || element.key;
    });

    const translations = {
      arTranslations,
      heTranslations,
    };

    res.status(200).json(translations);
  } catch (error) {
    console.error('Error deleting translation:', error);
    res.status(500).json({ error: 'Failed to delete translation' });
  }
});

module.exports = router;
