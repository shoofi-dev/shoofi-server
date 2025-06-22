const express = require("express");
const router = express.Router();

router.get("/api/getTranslations", async (req, res, next) => {
    const db = req.app.db['shoofi'];

  const dbTranslations = await db.translations
    .find()
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
});

router.post("/api/translations/update", async (req, res, next) => {
  const appName = req.headers['app-name'];
    const db = req.app.db[appName];
  const doc = req.body;

  await db.translations.updateOne(
    { key: doc.key },
    {
      $set: {
        ar: doc.ar,
        he: doc.he,
      },
    },
    { multi: false }
  );

  const dbTranslations = await db.translations
    .find()
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
});

router.post("/api/translations/add", async (req, res, next) => {
  const appName = req.headers['app-name'];
    const db = req.app.db[appName];
  const doc = req.body;

  await db.translations.insertOne(doc);

  const dbTranslations = await db.translations
    .find()
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
});

router.post("/api/translations/delete", async (req, res, next) => {
  const appName = req.headers['app-name'];
    const db = req.app.db[appName];
  const doc = req.body;
  await db.translations.deleteOne({ key: doc.key });

  const dbTranslations = await db.translations
    .find()
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
});

module.exports = router;
