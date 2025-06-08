const express = require("express");
const { restrict, checkAccess } = require("../lib/auth");
const { getId, cleanHtml } = require("../lib/common");
var multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });
const websockets = require("../utils/websockets");

var {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");

const { indexProducts } = require("../lib/indexing");
const { validateJson } = require("../lib/schema");
const { paginateData } = require("../lib/paginate");
const colors = require("colors");
const rimraf = require("rimraf");
const fs = require("fs");
const path = require("path");
const router = express.Router();
const BUCKET_NAME = "shoofi-spaces";
const uploadFile = async (files, req, folderName) => {
  const appName = req.headers["app-name"];
  const db = req.app.db['shoofi'];
  const amazonConfig = await db.amazonconfigs.findOne({ app: "amazon" });
  let locationslist = [];
  let counter = 0;

  return new Promise(async (resolve, reject) => {
    const s3Client = new S3Client({
      endpoint: "https://fra1.digitaloceanspaces.com", // Find your endpoint in the control panel, under Settings. Prepend "https://".
      //forcePathStyle: false, // Configures to use subdomain/virtual calling format.
      region: "FRA1", // Must be "us-east-1" when creating new Spaces. Otherwise, use the region in your endpoint (e.g. nyc3).
      credentials: {
        accessKeyId: amazonConfig["ID_KEY"], // Access key pair. You can create access key pairs using the control panel or API.
        secretAccessKey: amazonConfig["SECRET_KEY"], // Secret access key defined through an environment variable.
      },
    });
    files = files.filter((file) => file.originalname !== "existingImage");
    if (files.length > 0) {
      for (const file of files) {
        const fileName = `${new Date().getTime()}` + file.originalname;
        const folder = folderName || "products";
        const params = {
          Bucket: BUCKET_NAME, // The path to the directory you want to upload the object to, starting with your Space name.
          Key: `${appName}/${folder}/${fileName}`, // Object key, referenced whenever you want to access this file later.
          Body: file.buffer, // The object's contents. This variable is an object, not a string.
          ACL: "public-read",
        };

        try {
          const data = await s3Client.send(new PutObjectCommand(params));
          locationslist.push({ uri: params.Key });
          counter++;

          if (counter === files.length) {
            resolve(locationslist);
          }
        } catch (err) {
          console.log("Error", err);
        }
      }
    } else {
      resolve(locationslist);
    }
  });
};

const deleteImages = async (images, req) => {
  const appName = req.headers["app-name"];
  const db = req.app.db['shoofi'];
  const amazonConfig = await db.amazonconfigs.findOne({ app: "amazon" });
  return new Promise((resolve, reject) => {
    const s3Client = new S3Client({
      endpoint: "https://fra1.digitaloceanspaces.com", // Find your endpoint in the control panel, under Settings. Prepend "https://".
      region: "FRA1", // Must be "us-east-1" when creating new Spaces. Otherwise, use the region in your endpoint (e.g. nyc3).
      credentials: {
        accessKeyId: amazonConfig["ID_KEY"], // Access key pair. You can create access key pairs using the control panel or API.
        secretAccessKey: amazonConfig["SECRET_KEY"], // Secret access key defined through an environment variable.
      },
    });

    images?.forEach(async (img) => {
      const bucketParams = { Bucket: BUCKET_NAME, Key: img.uri };
      try {
        const data = await s3Client.send(new DeleteObjectCommand(bucketParams));
        console.log("Success. Object deleted.", data);
      } catch (err) {
        console.log("Error", err);
      }
    });
    resolve(true);
  });
};

const addProductByImage = async (image, db) => {
  const countDocuments = await db.products.countDocuments({
    categoryId: "5",
    subCategoryId: "2",
  });

  let req = {};
  req.body = {
    nameAR: "كعكة",
    nameHE: "עוגות",
    categoryId: "6",
    descriptionAR: "شرح",
    descriptionHE: "הסבר",
    mediumPrice: "180",
    mediumCount: "20",
    isInStore: "true",
    isUploadImage: "false",
  };
  const orderDoc = { ...req.body };
  let doc = {
    nameAR: req.body.nameAR,
    nameHE: req.body.nameHE,
    categoryId: req.body.categoryId,
    descriptionAR: cleanHtml(req.body.descriptionAR),
    descriptionHE: cleanHtml(req.body.descriptionHE),
    notInStoreDescriptionAR: cleanHtml(req.body.notInStoreDescriptionAR),
    notInStoreDescriptionHE: cleanHtml(req.body.notInStoreDescriptionHE),
    // mediumPrice: Number(req.body.mediumPrice),
    // largePrice: Number(req.body.largePrice),
    // mediumCount: Number(req.body.mediumCount),
    // largeCount: Number(req.body.largeCount),
    isInStore: req.body.isInStore === "false" ? false : true,
    isUploadImage: req.body.isUploadImage === "false" ? false : true,
    createdAt: new Date(),
    order: countDocuments,
  };

  if (req.body.subCategoryId) {
    doc.subCategoryId = req.body.subCategoryId;
  }
  doc.extras = {
    ...doc.extras,
    counter: {
      type: "COUNTER",
      value: 1,
    },
  };

  doc.extras = {
    ...doc.extras,
    size: {
      options: {
        medium: {
          price: Number(req.body.mediumPrice),
          count: Number(req.body.mediumCount),
        },
        large: {
          price: Number(req.body.largePrice),
          count: Number(req.body.largeCount),
        },
      },
      type: "oneChoice",
      value: "medium",
    },
  };

  if (
    (req.body.categoryId == "5" || req.body.categoryId == "6") &&
    req.body.subCategoryId != "1" &&
    req.body.cakeLevels
  ) {
    let levels = {};
    for (let i = 0; i < Number(req.body.cakeLevels); i++) {
      levels[i + 1] = null;
    }
    doc.extras = {
      ...doc.extras,
      taste: {
        type: "dropDown",
        value: {},
        options: levels,
      },
    };
  }

  if (doc.isUploadImage) {
    doc.extras = {
      ...doc.extras,
      image: {
        type: "uploadImage",
        value: null,
      },
    };
  }
  doc.img = [image];

  return doc;
};

router.post(
  "/api/admin/images/upload",
  upload.array("img"),
  async (req, res, next) => {
    const appName = req.headers["app-name"];
    const db = req.app.db[appName];
    const body = { ...req.body };

    let imagesList = [];
    if (req.files && req.files.length > 0) {
      imagesList = await uploadFile(req.files, req, "birthday");
    }

    if (imagesList?.length > 0) {
      for (const image of imagesList) {
        // const doc = await addProductByImage(image, db)
        // const newDoc = await db.products.insertOne(doc);

        const doc = {
          data: image,
          type: "birthday",
          subType: body.subType,
        };
        await db.images.insertOne(doc);
      }

      res.status(200).json({
        message: "New product successfully created",
      });
    } else {
      console.log(colors.red(`Error inserting images`));
      res.status(400).json({ message: "Error inserting images" });
    }
  }
);

router.post(
  "/api/admin/product/insert",
  upload.array("img"),
  async (req, res, next) => {
    const appName = req.headers["app-name"];
    const db = req.app.db[appName];
    const orderDoc = { ...req.body };
    let doc = {
      nameAR: req.body.nameAR,
      nameHE: req.body.nameHE,
      supportedCategoryIds: req.body.supportedCategoryIds ? JSON.parse(req.body.supportedCategoryIds) : [],
      descriptionAR: cleanHtml(req.body.descriptionAR),
      descriptionHE: cleanHtml(req.body.descriptionHE),
      notInStoreDescriptionAR: cleanHtml(req.body.notInStoreDescriptionAR),
      notInStoreDescriptionHE: cleanHtml(req.body.notInStoreDescriptionHE),
      isInStore: req.body.isInStore === "false" ? false : true,
      createdAt: new Date(),
      extras: req.body?.extras && JSON.parse(req.body?.extras),
      others: req.body?.others && JSON.parse(req.body?.others),
      price: req.body.price ? Number(JSON.parse(req.body.price)) : 0,
      hasDiscount: req.body.hasDiscount === "true",
      discountQuantity: req.body.hasDiscount === "true" ? Number(req.body.discountQuantity) : 0,
      discountPrice: req.body.hasDiscount === "true" ? Number(req.body.discountPrice) : 0,
    };

    if (!doc.supportedCategoryIds || doc.supportedCategoryIds.length === 0) {
      return res.status(400).json({ message: "At least one category is required" });
    }

    // Calculate order based on supportedCategoryIds


    if (req.files && req.files.length > 1) {
      doc.img = req.body.img.concat(await uploadFile(req.files, req, `stores/${appName}/products`));
    } else {
      doc.img = await uploadFile(req.files, req, `stores/${appName}/products`);
    }
    try {
      const newDoc = await db.products.insertOne(doc);
      const newId = newDoc.insertedId;
      websockets.fireWebscoketEvent({ appName });
      indexProducts(req).then(() => {
        res.status(200).json({
          message: "New product successfully created",
          productId: newId,
        });
      });
    } catch (ex) {
      console.log(colors.red(`Error inserting document: ${ex}`));
      res.status(400).json({ message: "Error inserting document" });
    }
  }
);

router.post(
  "/api/admin/product/update",
  upload.array("img"),
  async (req, res) => {
    const appName = req.headers["app-name"];
    const db = req.app.db[appName];

    const product = await db.products.findOne({
      _id: getId(req.body.productId),
    });

    if (!product) {
      res.status(400).json({ message: "Failed to update product" });
      return;
    }
    let productDoc = {
      ...product,
      nameAR: req.body.nameAR,
      nameHE: req.body.nameHE,
      supportedCategoryIds: req.body.supportedCategoryIds ? JSON.parse(req.body.supportedCategoryIds) : product.supportedCategoryIds,
      descriptionAR: cleanHtml(req.body.descriptionAR),
      descriptionHE: cleanHtml(req.body.descriptionHE),
      notInStoreDescriptionAR: cleanHtml(req.body.notInStoreDescriptionAR),
      notInStoreDescriptionHE: cleanHtml(req.body.notInStoreDescriptionHE),
      isInStore: req.body.isInStore === "false" ? false : true,
      extras: req.body.extras ? JSON.parse(req.body.extras) : [],
      others: req.body.others ? JSON.parse(req.body.others) : [],
      price: Number(JSON.parse(req.body.price)),
      hasDiscount: req.body.hasDiscount === "true",
      discountQuantity: req.body.hasDiscount === "true" ? Number(req.body.discountQuantity) : 0,
      discountPrice: req.body.hasDiscount === "true" ? Number(req.body.discountPrice) : 0,
      updatedAt: new Date(),
    };

    if (!productDoc.supportedCategoryIds || productDoc.supportedCategoryIds.length === 0) {
      return res.status(400).json({ message: "At least one category is required" });
    }

    if (req.files) {
      if (req.files.length > 0) {
        productDoc.img = await uploadFile(req.files, req, `stores/${appName}/products`);
        await deleteImages(product.img, req);
      }
    }

    try {
      await db.products.updateOne(
        { _id: getId(req.body.productId) },
        { $set: productDoc },
        {}
      );
      websockets.fireWebscoketEvent({ appName });

      // Update the index
      indexProducts(req).then(() => {
        res
          .status(200)
          .json({ message: "Successfully saved", product: productDoc });
      });
    } catch (ex) {
      res.status(400).json({ message: "Failed to save. Please try again" });
    }
  }
);

router.post(
  "/api/admin/product/update/activeTastes",
  upload.array("img"),
  async (req, res) => {
    const appName = req.headers["app-name"];
    const db = req.app.db[appName];

    await db.products.updateOne(
      { _id: getId(req.body.id) },
      { $set: { activeTastes: req.body.activeTastes } },
      { multi: false }
    );
    websockets.fireWebscoketEvent({ type: "update active tastes", appName });

    res.status(200).json({ message: "Product successfully updated", appName });
  }
);

router.post("/api/admin/product/update/order", async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const categoryId = req.body.categoryId;
  const subCategoryId = req.body.subCategoryId;
  const productsList = req.body.productsList;
  let countDocuments = null;
  if (subCategoryId) {
    countDocuments = await db.products.countDocuments({
      categoryId: categoryId.toString(),
      subCategoryId: subCategoryId.toString(),
    });
  } else {
    countDocuments = await db.products.countDocuments({
      categoryId: categoryId.toString(),
    });
  }

  try {
    for (i = 1; i <= productsList.length; i++) {
      await db.products.updateOne(
        { _id: getId(productsList[i - 1]._id) },
        { $set: { order: countDocuments - i } },
        { multi: false }
      );
    }

    indexProducts(req).then(() => {
      res.status(200).json({ message: "Product successfully ordered" });
    });
  } catch (e) {
    console.log(e);
    res.status(200).json({ message: e });
  }
});

router.post("/api/admin/product/delete", async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  try {
    const objectIdsList = req.body.productsIdsList.map((id) => {
      return getId(id);
    });

    const results = await db.products
      .find({ _id: { $in: objectIdsList } })
      .toArray();

    await results.forEach(async (product) => {
      await deleteImages(product.img, req);
    });
    await db.products.deleteMany({ _id: { $in: objectIdsList } }, {});
    websockets.fireWebscoketEvent({ appName });
    indexProducts(req).then(() => {
      res
        .status(200)
        .json({ message: "Product successfully deleted", appName });
    });
  } catch (e) {
    console.log(e);
    res.status(200).json({ message: e });
  }
});

// get images by type
router.post("/api/images", async (req, res, next) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];

  try {
    const results = await db.images.find({ type: req.body.type }).toArray();
    res.status(200).json(results);
  } catch (e) {
    console.log(colors.red(`Error getting images`, e));

    res.status(400).json({ message: "Error getting images" });
  }
});

router.post("/api/admin/product/update/isInStore", async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];

  try {
    await db.products.updateOne(
      { _id: getId(req.body.productId) },
      { $set: { isInStore: req.body.isInStore } },
      { multi: false }
    );
    websockets.fireWebscoketEvent({ type: "product updated", appName });

    res.status(200).json({ message: "isInStore state updated" });
  } catch (ex) {
    console.error(colors.red(`Failed to update the isInStore state: ${ex}`));
    res.status(400).json({ message: "isInStore state not updated" });
  }
});

router.post(
  "/api/admin/product/update/isInStore/byCategory",
  async (req, res) => {
    const appName = req.headers["app-name"];
    const db = req.app.db[appName];
    try {
      await db.products.updateMany(
        {
          categoryId: req.body.categoryId?.toString(),
          subCategoryId: req.body.subCategoryId?.toString(),
        },
        { $set: { isInStore: req.body.isInStore } }
      );
      websockets.fireWebscoketEvent({ type: "product updated", appName });

      res.status(200).json({ message: "isInStore state updated byCategory" });
    } catch (ex) {
      console.error(
        colors.red(`Failed to update the isInStore state: ${ex} byCategory`)
      );
      res
        .status(400)
        .json({ message: "isInStore state not updated byCategory" });
    }
  }
);

router.get("/api/admin/product/extras", async (req, res) => {
  const appName = req.headers['app-name'];
    const db = req.app.db[appName];
  let extrasList = await paginateData(false, req, 1, "extras", {});
  res.status(200).json(extrasList);

});

// Get product by _id and app-name
router.get("/api/admin/product/:id", async (req, res) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const productId = req.params.id;
  try {
    const product = await db.products.findOne({ _id: getId(productId) });
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.status(200).json(product);
  } catch (e) {
    res.status(400).json({ message: "Error fetching product", error: e.toString() });
  }
});

module.exports = {
  router,
  uploadFile,
  deleteImages
};
