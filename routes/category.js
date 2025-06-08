const express = require('express');
const router = express.Router();
const {
    paginateData
} = require('../lib/paginate');
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });
const { uploadFile, deleteImages } = require("./product");
const { getId } = require("../lib/common");

router.get("/api/admin/categories/:page?", async (req, res, next) => {
    let pageNum = 1;
    
    if (req.params.page) {
      pageNum = req.params.page;
    }
  
    const categories = await paginateData(
      false,
      req,
      pageNum,
      "categories",
      {},
      {}
    );
    res.status(200).json(categories.data);
});


// Get all store categories
router.get("/api/category/general/all", async (req, res) => {
  const db = req.app.db['shoofi'];
  const categories = await db.generalCategories.find().toArray();
  res.status(200).json(categories);
});

// Add store category
router.post("/api/category/general/add", upload.array("img"), async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const { nameAR, nameHE } = req.body;
  let images = [];
  const newCategoryId = getId();
  if (req.files && req.files.length > 0) {
    images = await uploadFile(req.files, req, `general-categories/${newCategoryId}/logo`);
  }
  const newCategory = {
    _id: newCategoryId,
    nameAR,
    nameHE,
    img: images,
  };
  await db.generalCategories.insertOne(newCategory);
  res.status(201).json(newCategory);
});

// Update store category
router.post("/api/category/general/update/:id", upload.array("img"), async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const { id } = req.params;
  const { nameAR, nameHE } = req.body;
  const category = await db.generalCategories.findOne({ _id: getId(id) });
  let images = category.img;
  if (req.files && req.files.length > 0) {
    images = await uploadFile(req.files, req, `general-categories/${id}/logo`);
    if (category.img && category.img.length > 0) {
      await deleteImages(category.img, req);
    }
  }
  const updatedCategory = {
    ...category,
    nameAR,
    nameHE,
    img: images,
  };
  await db.generalCategories.updateOne({ _id: getId(id) }, { $set: updatedCategory });
  res.status(200).json(updatedCategory);
});

// Delete store category
router.delete("/api/category/general/:id", async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const { id } = req.params;
  const category = await db.generalCategories.findOne({ _id: getId(id) });
  if (category.img && category.img.length > 0) {
    await deleteImages(category.img, req);
  }
  await db.generalCategories.deleteOne({ _id: getId(id) });
  res.status(200).json({ message: "Category deleted" });
});

// Get store categories by general category
router.get("/api/category/by-general/:generalCategoryId", async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const { generalCategoryId } = req.params;

  try {
    const categories = await db.categories.find({
      supportedGeneralCategoryIds: { $in: [getId(generalCategoryId)] }
    }).toArray();
    res.status(200).json(categories);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch store categories', error: err.message });
  }
});

module.exports = router;