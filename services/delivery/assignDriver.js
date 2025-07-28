const { getId } = require("../../lib/common");

const ACTIVE_ORDER_STATUSES = ["1", "2", "3"];

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
        "driver._id": driver._id,
        status: { $in: ACTIVE_ORDER_STATUSES }
      });
      return { ...driver, activeOrderCount: count };
    })
  );

  // Filter out drivers that have reached their maxOrdersByAdmin limit
  const availableDrivers = driverOrderCounts?.filter(driver => {
    const maxOrders = driver?.maxOrdersByAdmin !== undefined ? driver?.maxOrdersByAdmin : 10000; // Default to Infinity if not set
    return driver?.activeOrderCount < maxOrders;
  });
  
  if(!availableDrivers.length){
    driverOrderCounts.sort((a, b) => a.activeOrderCount - b.activeOrderCount);
    console.log("driverOrderCounts", driverOrderCounts);
    return driverOrderCounts
  };   

  availableDrivers.sort((a, b) => a.activeOrderCount - b.activeOrderCount);
  console.log("availableDrivers", availableDrivers);
  return availableDrivers;
}

async function assignBestDeliveryDriver({ appDb, location }) {
  try {
  const allDrivers = await findAllMatchingDrivers({ appDb, location });
  
  if (!allDrivers.length) {
    return { success: false, reason: "No drivers found for this location." };
  }

  // Check if all drivers have the same activeOrderCount
  const firstDriverCount = allDrivers[0].activeOrderCount;
  const allSameCount = allDrivers.every(driver => driver.activeOrderCount === firstDriverCount);
  
  let best;
  if (allSameCount && allDrivers.length > 1) {
    // Randomly select a driver when all have the same count
    const randomIndex = Math.floor(Math.random() * allDrivers.length);
    best = allDrivers[randomIndex];
  } else {
    // Use the first driver (already sorted by activeOrderCount)
    best = allDrivers[0];
  }
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
  } catch (error) {
    console.error('Error assigning best delivery driver:', error);
    return { success: false, reason: "Error assigning best delivery driver." };
  }
}

module.exports = { assignBestDeliveryDriver, findAllMatchingDrivers }; 