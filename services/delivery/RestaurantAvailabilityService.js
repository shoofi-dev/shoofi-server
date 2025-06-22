const turf = require('@turf/turf');
const { getId } = require("../../lib/common");

/**
 * Find cities that are within a specified distance from a point
 */
class RestaurantAvailabilityService {
  static findCitiesNearPoint(lat, lng, cities, maxDistanceKm = 5) {
    const customerPoint = turf.point([lng, lat]);

    return cities.filter(city => {
      const cityPolygon = turf.polygon(city.geometry.coordinates);
      const distance = turf.pointToPolygonDistance(customerPoint, cityPolygon, { units: 'kilometers' });
      return distance <= maxDistanceKm;
    });
  }

  /**
   * Detect if a point is inside any delivery area
   */
  static detectDeliveryArea(lat, lng, areas) {
    const customerPoint = turf.point([lng, lat]);

    for (const area of areas) {
      const areaPolygon = turf.polygon(area.geometry.coordinates);
      if (turf.booleanPointInPolygon(customerPoint, areaPolygon)) {
        return area;
      }
    }

    return null;
  }

  /**
   * Get available stores and their delivery companies based on customer location
   */
  static async getAvailableStores(db, shoofiDB,generalDB, customerLat, customerLng, maxCityDistanceKm = 5) {
    // Find nearby cities using MongoDB's $near with 2dsphere index
    const nearbyCities = await db.cities.find({
      geometry: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [customerLng, customerLat]
          },
          $maxDistance: maxCityDistanceKm * 1000 // Convert km to meters
        }
      }
    }).toArray();

    const nearbyCityIds = nearbyCities.map(city => city._id);

    // Find areas in nearby cities that contain the customer's point
    const customerArea = await db.areas.findOne({
      cityId: { $in: nearbyCities.map(city => city._id.toString()) },
      geometry: {
        $geoIntersects: {
          $geometry: {
            type: "Point",
            coordinates: [customerLng, customerLat]
          }
        }
      }
    });

    // Find stores in nearby cities
    const availableStores = await shoofiDB.stores.find({
      supportedCities: { $in: nearbyCityIds }
    }).toArray();

    console.log(`Found ${availableStores.length} stores in nearby cities`);

    // Verify each store's database and filter out invalid ones
    const verifiedStores = await Promise.all(
      availableStores.map(async store => {
        console.log(`Verifying database for store: ${store.name} (${store.appName})`);
        const isValid = await verifyStoreDatabase(store.appName, generalDB);
        if (!isValid) {
          console.log(`Store ${store.name} (${store.appName}) database verification failed`);
        }
        return isValid ? store : null;
      })
    );

    // Filter out null values (invalid stores)
    const validStores = verifiedStores.filter(store => store !== null);
    console.log(`After database verification: ${validStores.length} valid stores out of ${availableStores.length} total`);

    // For each valid store, find delivery companies that can deliver to the customer
    const results = await Promise.all(validStores.map(async store => {
      // Find delivery companies that support the store's cities
      const supportedCitiesIdObj = store.supportedCities.map(city => getId(city));
      const deliveryCompanies = await db.store.find({
        supportedCities: { $in: getId(supportedCitiesIdObj) }
      }).toArray();

      // Filter companies that support the customer's area
      const availableDeliveryCompanies = deliveryCompanies
        .filter(company => {
          if (!customerArea) return false;
          return company.supportedAreas.some(
            supportedArea => supportedArea.areaId.equals(customerArea._id)
          );
        })
        .map(company => {
          const areaInfo = company.supportedAreas.find(
            supportedArea => supportedArea.areaId.equals(customerArea?._id)
          );

          return {
            company,
            price: areaInfo?.price || 0,
            eta: areaInfo?.eta || 0
          };
        });

      return {
        store,
        deliveryCompanies: availableDeliveryCompanies
      };
    }));

    return results;
  }
}

const verifyStoreDatabase = async (appName, client) => {
  try {
    // Check if database exists by trying to access it
    if (!client[appName]) {
      console.log(`Database ${appName} does not exist`);
      return false;
    }

    const db = client[appName];
    
    // Check if we can list collections (this will fail if database doesn't exist)
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(col => col.name);

    // Check required collections
    const hasCategories = collectionNames.includes('categories');
    const hasProducts = collectionNames.includes('products');
    
    if (hasCategories && hasProducts) {
      const categoryCount = await db.collection('categories').countDocuments();
      const productCount = await db.collection('products').countDocuments();
      
      if (categoryCount > 0 && productCount > 0) {
        console.log(`Database ${appName} is valid with ${categoryCount} categories and ${productCount} products`);
        return true;
      } else {
        console.log(`Database ${appName} exists but has no data: ${categoryCount} categories, ${productCount} products`);
        return false;
      }
    } else {
      console.log(`Database ${appName} missing required collections. Found:`, collectionNames);
      return false;
    }

  } catch (error) {
    console.error(`Error verifying store database ${appName}:`, error.message);
    return false;
  }
};

module.exports = {
  getAvailableStores: RestaurantAvailabilityService.getAvailableStores,
  verifyStoreDatabase
}; 