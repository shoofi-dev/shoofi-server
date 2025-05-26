const express = require("express");
const router = express.Router();
const geoLocationService = require("../utils/geo-location");

router.post("/api/geo/isValidGeo", async (req, res) => {
  const geoLocationData = {
    lat: req.body.latitude,
    lng: req.body.longitude,
  };

  try {
    const isValidLocation = await geoLocationService.isWithinPolygons(
      geoLocationData,
      req
    );

    return res
      .status(200)
      .json({ message: "valid location", data: isValidLocation });
  } catch (ex) {
    console.info("Error validating calander", ex);
  }
});

module.exports = router;
