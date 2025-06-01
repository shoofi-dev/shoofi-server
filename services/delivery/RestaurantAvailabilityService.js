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
  static async getAvailableStores(db, shoofiDB, customerLat, customerLng, maxCityDistanceKm = 5) {
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

    const nearbyCityIds = nearbyCities.map(city => city._id.toString());

    // Find areas in nearby cities that contain the customer's point
    const customerArea = await db.areas.findOne({
      cityId: { $in: nearbyCityIds },
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

    // For each store, find delivery companies that can deliver to the customer
    const results = await Promise.all(availableStores.map(async store => {
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

module.exports = RestaurantAvailabilityService; 