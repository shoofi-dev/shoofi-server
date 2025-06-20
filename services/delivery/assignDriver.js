const { getId } = require("../../lib/common");

const ACTIVE_ORDER_STATUSES = ["0", "1", "2"];

async function findAllMatchingDrivers({ appDb, location }) {
  const deliveryDB = appDb['delivery-company'];

  const area = await deliveryDB.areas.findOne({
    geometry: {
      $geoIntersects: {
        $geometry: { type: "Point", coordinates: [location.lng, location.lat] }
      }
    }
  });
  if (!area) return [];

  const companies = await deliveryDB.store.find({
    supportedAreas: { $elemMatch: { areaId: area._id } }
  }).toArray();
  if (!companies.length) return [];

  let allDrivers = [];
  for (const company of companies) {
    const drivers = await deliveryDB.customers.find({
      role: { $in: ["driver", "admin"] },
      isActive: true,
      companyId: company._id.toString()
    }).toArray();
    allDrivers = allDrivers.concat(drivers.map(driver => ({ ...driver, company })));
  }
  if (!allDrivers.length) return [];

  const driverOrderCounts = await Promise.all(
    allDrivers.map(async (driver) => {
      const count = await deliveryDB.bookDelivery.countDocuments({
        "driver._id": driver._id.toString(),
        status: { $in: ACTIVE_ORDER_STATUSES }
      });
      return { ...driver, activeOrderCount: count };
    })
  );

  driverOrderCounts.sort((a, b) => a.activeOrderCount - b.activeOrderCount);

  return driverOrderCounts;
}

async function assignBestDeliveryDriver({ appDb, location }) {
  const allDrivers = await findAllMatchingDrivers({ appDb, location });
  
  if (!allDrivers.length) {
    return { success: false, reason: "No drivers found for this location." };
  }

  const best = allDrivers[0];
  const area = await appDb['delivery-company'].areas.findOne({
    geometry: {
      $geoIntersects: {
        $geometry: { type: "Point", coordinates: [location.lng, location.lat] }
      }
    }
  });

  return {
    success: true,
    driver: best,
    company: best.company,
    area,
    activeOrderCount: best.activeOrderCount
  };
}

module.exports = { assignBestDeliveryDriver, findAllMatchingDrivers }; 