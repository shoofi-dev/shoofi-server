const express = require('express');
const router = express.Router();
const _ = require('lodash');

const {
    paginateData
} = require('../lib/paginate');

router.get("/api/menu", async (req, res, next) => {
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
    const products = await paginateData(
        false,
        req,
        pageNum,
        "products",
        {},
        { order: -1 }
      );
      const productsImagesList = [];
     const grouped =  _.groupBy(products.data, 'categoryId');

      const orderedCategories =  _.orderBy(categories.data, 'order');
      const finalCategories = orderedCategories.filter((category)=> !category.isHidden)
      const menu = finalCategories.map((category)=>{
          let tempCat = {
              ...category,
              products: products.data.filter((product)=> product.categoryId == category.categoryId)
          }
          tempCat.products = _.orderBy(tempCat.products, ["order"], ["asc"])
          return tempCat;
      })
    res.status(200).json({menu:menu, productsImagesList: productsImagesList, categoryImages: grouped});
});

module.exports = router;