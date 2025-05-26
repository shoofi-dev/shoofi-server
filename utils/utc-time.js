const moment = require("moment");
const momentTZ = require("moment-timezone");

const getUTCOffset = () => {
    const israelTimezone = "Asia/Jerusalem";
  
    // Get the current time in UTC
    const utcTime = moment.utc();
  
    // Get the current time in Israel timezone
    const israelTime = momentTZ.tz(israelTimezone);
  
    // Get the UTC offset in minutes for Israel
    const israelOffsetMinutes = israelTime.utcOffset();
  
    // Convert the offset to hours
    return israelOffsetMinutes;
  };

const utcTimeService = {
    getUTCOffset: getUTCOffset,
  };
  module.exports = utcTimeService;