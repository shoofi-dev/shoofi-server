const { getId } = require("../../lib/common");

const ACTIVE_ORDER_STATUSES = ["0", "1", "2"];

async function assignBestDeliveryDriver({ appDb, location }) {
  const deliveryDB = appDb['delivery-company'];
  const shoofiDB = appDb['shoofi'];

  // 1. Find the area containing the location
  const area = await deliveryDB.areas.findOne({
    geometry: {
      $geoIntersects: {
        $geometry: {
          type: "Point",
          coordinates: [location.lng, location.lat]
        }
      }
    }
  });
  if (!area) return { success: false, reason: "No delivery area found for this location." };

  // 2. Find all companies supporting this area
  const companies = await deliveryDB.store.find({
    supportedAreas: { $elemMatch: { areaId: area._id } }
  }).toArray();
  if (!companies.length) return { success: false, reason: "No delivery companies support this area." };

  // 3. For each company, find all active drivers
  let allDrivers = [];
  for (const company of companies) {
    const drivers = await deliveryDB.customers.find({
      role: { $in: ["driver", "admin"] },
      isActive: true,
      companyId: company._id.toString()
    }).toArray();
    allDrivers = allDrivers.concat(drivers.map(driver => ({ ...driver, company })));
  }
  if (!allDrivers.length) return { success: false, reason: "No active drivers found." };

  // 4. For all drivers, count their active orders
  const driverOrderCounts = await Promise.all(
    allDrivers.map(async (driver) => {
      const count = await deliveryDB.bookDelivery.countDocuments({
        assignee: driver._id.toString(),
        status: { $in: ACTIVE_ORDER_STATUSES }
      });
      return { driver, count };
    })
  );

  // 5. Get the driver with the lowest count
  driverOrderCounts.sort((a, b) => a.count - b.count);
  const best = driverOrderCounts[0];

  return {
    success: true,
    driver: best.driver,
    company: best.driver.company,
    area,
    activeOrderCount: best.count
  };
}

module.exports = { assignBestDeliveryDriver }; 