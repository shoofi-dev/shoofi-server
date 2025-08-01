const moment = require("moment");
const momentTZ = require("moment-timezone");
const APP_CONSTS = require("../consts/consts");
const {
  findBestDeliveryCompany,
} = require("../services/delivery/book-delivery");

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

const checkIsStoreOpenDay = (targetDayString, targetTimeString) => {
  const offsetHours = getUTCOffset();

  // Get the current time
  const now = moment().utcOffset(offsetHours);
  console.log("now", now.format());

  // Parse the target time string
  const [targetHour, targetMinute] = targetTimeString.split(":").map(Number);

  // Convert the target day string to a number (0 = Sunday, 6 = Saturday)
  const daysOfWeek = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  };

  const targetDay = daysOfWeek[targetDayString];

  // Check if today is the target day and after the specified time
  const isTargetDay = now.day() === targetDay;
  console.log("isTargetDay", isTargetDay);

  const targetTime = moment()
    .utcOffset(offsetHours)
    .startOf("day")
    .add(targetHour, "hours")
    .add(targetMinute, "minutes");
  console.log("targetTime", targetTime.format());

  const isAfterTargetTime = now.isAfter(targetTime);
  console.log("isAfterTargetTime", isAfterTargetTime);

  if (isTargetDay && isAfterTargetTime) {
    console.log(`It's ${targetDayString} and after ${targetTimeString}.`);
    return false;
  } else {
    console.log(
      `It's not ${targetDayString} and/or not after ${targetTimeString}.`
    );
    return true;
  }
};

const checkIsStoreOpenHours = (startTimeStr, endTimeStr) => {
  const offsetHours = getUTCOffset();
  console.log("startTime1", startTime);
  console.log("endTime1", endTime);
  // Parse the start and end times
  // Parse the start and end times
  var startTime = moment(startTimeStr, "HH:mm").utcOffset(offsetHours, true);
  var endTime = moment(endTimeStr, "HH:mm").utcOffset(offsetHours, true);
  console.log("startTime", startTime.format());
  console.log("endTime", endTime.format());

  // Get the current time
  var currentTime = moment().utcOffset(offsetHours);
  console.log("currentTime", currentTime.format());

  // Check if the time range crosses midnight
  if (endTime.isBefore(startTime)) {
    // Case where the time range crosses midnight

    // Check if the current time is between the start time and midnight (23:59)
    var endOfDay = moment("23:59", "HH:mm").utcOffset(offsetHours, true);
    console.log("endOfDay", endOfDay.format());

    var isBetweenSameDay = currentTime.isBetween(
      startTime,
      endOfDay,
      undefined,
      "[]"
    );

    // Check if the current time is between midnight (00:00) and the end time on the next day
    var startOfDay = moment("00:00", "HH:mm").utcOffset(offsetHours, true);
    console.log("startOfDay", startOfDay.format());

    var isBetweenNextDay = currentTime.isBetween(
      startOfDay,
      endTime,
      undefined,
      "[]"
    );
    console.log(
      "isBetweenSameDay-isBetweenNextDay",
      isBetweenSameDay,
      isBetweenNextDay
    );

    if (isBetweenSameDay || isBetweenNextDay) {
      return true;
    } else {
      return false;
    }
  } else {
    // Case where the time range does not cross midnight
    if (currentTime.isBetween(startTime, endTime, undefined, "[]")) {
      console.log("currentTime.isBetween", true);

      return true;
    } else {
      console.log("currentTime.isBetween", false);

      return false;
    }
  }
};

const isDeliveryCompanyOpen = async (req) => {
  const appName = req.headers["app-name"];
  const deliveryCompanyDB = req.app.db["delivery-company"];
  let deliveryCompanystore = null;

  if (!APP_CONSTS.SARI_APPS_DB_LIST.includes(appName)) {
      const appDB = req.app.db[appName];

    const store = await appDB.store.findOne({ id: 1 });

    if (
      appName &&
      !APP_CONSTS.SARI_APPS_DB_LIST.includes(appName) &&
      store &&
      store.location &&
      store.coverageRadius
    ) {
      const bestCompany = await findBestDeliveryCompany({
        storeLocation: store.location,
        appDb: req.app.db,
      });
      // If no company covers the store, it's not open for delivery
      if (!bestCompany) {
        return false;
      }
      deliveryCompanystore = bestCompany;
    }
  } else {
    deliveryCompanystore = await deliveryCompanyDB.store.findOne({ id: 1 });
  }
  const isOpenHours = storeService.checkIsStoreOpenHours(
    deliveryCompanystore.start,
    deliveryCompanystore.end
  );
  const isOpenDays = true;
  // TODO: check if the store is open all days
    // storeService.checkIsStoreOpenDay("Sunday", deliveryCompanystore.end) ||
    deliveryCompanystore?.isOpendAllDays;
  let isStoreOpen =
    (isOpenHours && isOpenDays && !deliveryCompanystore.isStoreClose) ||
    (deliveryCompanystore.isAlwaysOpen && !deliveryCompanystore.isStoreClose);
  return isStoreOpen;
};

/**
 * Checks if the store is open right now based on the new openHours object structure.
 * openHours: {
 *   sunday: { isOpen, start, end }, ...
 * }
 * Returns: { isOpen: boolean, workingHours: { start: string, end: string } }
 */
function isStoreOpenNow(openHours) {
  const offsetHours = getUTCOffset();

  if (!openHours) return { isOpen: false, workingHours: null };
  const now = moment().utcOffset(offsetHours);
  const days = [
    "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"
  ];
  const todayIdx = now.day();
  const today = days[todayIdx];
  const todayHours = openHours[today];

  // Helper to parse time
  function parseTime(str, baseDate) {
    const [h, m] = str.split(":").map(Number);
    const d = moment(baseDate).utcOffset(offsetHours);
    d.hours(h).minutes(m).seconds(0).milliseconds(0);
    return d;
  }

  // Helper to convert time string to minutes for comparison
  function timeToMinutes(timeStr) {
    const [h, m] = timeStr.split(":").map(Number);
    return h * 60 + m;
  }

  // Helper to get current time in minutes
  function getCurrentTimeMinutes() {
    const now = moment().utcOffset(offsetHours);
    return now.hours() * 60 + now.minutes();
  }

  // Get the previous day
  const yesterdayIdx = (todayIdx + 6) % 7;
  const yesterday = days[yesterdayIdx];
  const yesterdayHours = openHours[yesterday];

  // Check if yesterday had overnight hours and we're still within that business day
  if (yesterdayHours && yesterdayHours.isOpen && timeToMinutes(yesterdayHours.end) < timeToMinutes(yesterdayHours.start)) {
    const currentTimeMinutes = getCurrentTimeMinutes();
    const yesterdayEndMinutes = timeToMinutes(yesterdayHours.end);
    
    // If current time is before yesterday's end time (overnight), we're still within yesterday's business day
    if (currentTimeMinutes < yesterdayEndMinutes) {
      return { 
        isOpen: true, 
        workingHours: { 
          start: yesterdayHours.start, 
          end: yesterdayHours.end 
        } 
      };
    }
  }

  // Check today's hours
  if (todayHours && todayHours.isOpen) {
    const start = parseTime(todayHours.start, now);
    const end = parseTime(todayHours.end, now);

    if (timeToMinutes(todayHours.end) < timeToMinutes(todayHours.start)) {
      // Overnight hours (e.g., 17:00-03:00)
      // Business day starts today and ends tomorrow
      end.add(1, 'day');
      if (now >= start && now <= end) {
        return { 
          isOpen: true, 
          workingHours: { 
            start: todayHours.start, 
            end: todayHours.end 
          } 
        };
      }
    } else {
      // Normal same-day hours
      if (now >= start && now <= end) {
        return { 
          isOpen: true, 
          workingHours: { 
            start: todayHours.start, 
            end: todayHours.end 
          } 
        };
      }
    }
  }

  return { isOpen: false, workingHours: { 
    start: todayHours.start, 
    end: todayHours.end 
  }  };
}

const storeService = {
  checkIsStoreOpenDay: checkIsStoreOpenDay,
  checkIsStoreOpenHours: checkIsStoreOpenHours,
  isDeliveryCompanyOpen: isDeliveryCompanyOpen,
  isStoreOpenNow: isStoreOpenNow,
};
module.exports = storeService;
