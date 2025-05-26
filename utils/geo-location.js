const { paginateData } = require("../lib/paginate");

isWithinCoordinates = function (point, polygon) {
    console.log("point",point)

    const lat = point.lat;
    const lng = point.lng;

    var isInside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const iLat = polygon[i][0];
        const iLng = polygon[i][1];

        const jLat = polygon[j][0];
        const jLng = polygon[j][1];

        const isIntersecting =
            iLng > lng != jLng > lng &&
            lat < ((jLat - iLat) * (lng - iLng)) / (jLng - iLng) + iLat;

        if (isIntersecting) isInside = !isInside;
    }
    return isInside;
};

isWithinPolygons = async function (point, req) {
    let pageNum = 1;
    // if (req.params.page) {
    //   pageNum = req.params.page;
    // }
    const polygons = await paginateData(
        false,
        req,
        pageNum,
        "locationPolygon",
        {},
        { productAddedDate: -1 }
    );
        console.log("polygons",polygons)
    let isInPolygon = false;
    polygons.data.forEach(item => {
        isInPolygon = isWithinCoordinates(point, item.polygon)
    });
    console.log("isInPolygon",isInPolygon)
    return isInPolygon;
}

const geoLocationService = {
    isWithinPolygons: isWithinPolygons,
};
module.exports = geoLocationService;
