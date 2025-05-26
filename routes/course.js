const express = require("express");
const router = express.Router();
const websockets = require("../utils/websockets");
const utcTimeService = require("../utils/utc-time");
const moment = require("moment");
const auth = require("./auth");
const colors = require("colors");
const { getId, clearCustomer, sanitize } = require("../lib/common");
const { v4: uuidv4 } = require("uuid");

// Helper function to generate all class dates for a given day in the range of startDate to endDate
async function generateClassDates(startDate, endDate, dayOfWeek, db) {
  const classDates = [];
  const dayIndexMap = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  };
  const offsetHours = utcTimeService.getUTCOffset();
  let current = moment(startDate).utcOffset(offsetHours);

  // Get holiday dates from store
  const store = await db.store.findOne({ id: 1 });
  const holidayDates = store?.holidayDates || [];

  // Move to the first occurrence of the specified day
  while (current.day() !== Number(dayOfWeek)) {
    current.add(1, "days");
  }

  // Continue adding dates until we pass the endDate
  while (current <= moment(endDate).utcOffset(offsetHours)) {
    let classDate = moment(current).utcOffset(offsetHours);
    let dateStr = classDate.format('YYYY-MM-DD');
    
    // If date is a holiday, find the next available date
    while (holidayDates.includes(dateStr)) {
      classDate.add(1, "days");
      dateStr = classDate.format('YYYY-MM-DD');
    }
    
    classDates.push(classDate.format());
    current.add(7, "days"); // Move to the next week
  }

  return classDates;
}

router.post("/api/admin/course/create", async (req, res, next) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  const {
    branchId,
    name,
    price,
    startDate,
    endDate,
    schedule,
    teacherData,
    courseType,
  } = req.body;

  try {
    const classes = [];
    for (const { day, time } of schedule) {
      const classDates = await generateClassDates(startDate, endDate, day, db);
      classDates.forEach((classDate) => {
        classes.push({
          id: uuidv4(),
          day,
          time,
          date: classDate,
          students: [],
          isActive: true,
          teacherData,
        });
      });
    }
    
    const sortedClasses = classes.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const newCourse = {
      branchId,
      name,
      teacherData,
      price,
      startDate,
      endDate,
      schedule,
      classes: sortedClasses,
      courseType,
    };

    await db.courses.insertOne(newCourse);
    res.status(200).json({ message: "Successfully created course" });
  } catch (error) {
    console.error("Error creating course:", error);
    res.status(400).json({ message: "Failed to create course" });
  }
});

router.post("/api/admin/course/get-list", async (req, res, next) => {
  const appName = req.headers["app-name"];
  const db = req.app.db[appName];
  let filter = req.body || {};
  const offsetHours = utcTimeService.getUTCOffset();
  const currentDate = moment().utcOffset(offsetHours).format();

  const endDateFilter = { endDate: { $gt: currentDate } };
  filter = {
    ...filter,
    ...endDateFilter,
  };
  const coursesList = await db.courses.find(filter).toArray();
  // websockets.fireWebscoketEvent();
  res.status(200).json(coursesList);
});

router.post(
  "/api/admin/course/class/join",
  auth.required,
  async (req, res, next) => {
    // const customerId = req.auth.id;
    const { classId, courseId, customerId } = req.body || {};

    const appName = req.headers["app-name"];
    const db = req.app.db[appName];
    try {
      const customer = await db.customers.findOne({
        _id: getId(customerId),
      });
      if (!customer) {
        res.status(400).json({
          message: "Customer not found",
        });
        return;
      }

      // await db.customers.updateOne(
      //   { _id: getId(customerId) }, // Match the specific customer by their _id
      //   { $inc: { "coursePackage.attendanceCount": 1 } } // Increment attendanceCount by 1
      // );
      await db.customers.updateOne(
        {
          _id: getId(customerId),
          "coursesList.courseId": courseId, // If you know the courseId you want to update
        },
        {
          $inc: { "coursesList.$.attendanceCount": 1 },
        }
      );

      let courseData = null;
      if (courseId) {
        courseData = await db.courses.findOne({
          _id: getId(courseId),
        });
      }
      const offsetHours = utcTimeService.getUTCOffset();

      courseData?.classes.map((item) => {
        if (item.id === classId) {
          item.students.push({
            customerId,
            status: "1",
            createdAt: moment().utcOffset(offsetHours),
          });
        }
      });

      await db.courses.updateOne(
        {
          _id: getId(courseId),
        },
        {
          $set: {
            classes: courseData.classes,
          },
        },
        { multi: false }
      );

      res.status(200).json({
        message: "Customer updated",
        data: {
          courseData,
        },
      });
    } catch (ex) {
      console.error(colors.red(`Failed to join course: ${ex}`));
      res.status(400).json({ message: "Failed to join course" });
    }
  }
);

router.post(
  "/api/admin/course/class/leave",
  auth.required,
  async (req, res, next) => {
    // const customerId = req.auth.id;
    const { classId, courseId, customerId } = req.body || {};

    const appName = req.headers["app-name"];
    const db = req.app.db[appName];
    try {
      const customer = await db.customers.findOne({
        _id: getId(customerId),
      });
      if (!customer) {
        res.status(400).json({
          message: "Customer not found",
        });
        return;
      }

      await db.customers.updateOne(
        { _id: getId(customerId),"coursesList.courseId": courseId, }, // Match the specific customer by their _id
        { $inc: { "coursesList.$.attendanceCount": -1 } } // Increment attendanceCount by 1
      );

      let courseData = null;
      if (courseId) {
        courseData = await db.courses.findOne({
          _id: getId(courseId),
        });
      }

      courseData?.classes.map((item) => {
        if (item.id === classId) {
          item.students = item.students.filter((student)=> student.customerId != customerId)
        }
      });

      await db.courses.updateOne(
        {
          _id: getId(courseId),
        },
        {
          $set: {
            classes: courseData.classes,
          },
        },
        { multi: false }
      );

      res.status(200).json({
        message: "Customer updated",
        data: {
          courseData,
        },
      });
    } catch (ex) {
      console.error(colors.red(`Failed to join course: ${ex}`));
      res.status(400).json({ message: "Failed to join course" });
    }
  }
);

router.post(
  "/api/admin/course/class/today",
  auth.required,
  async (req, res, next) => {
    try {
      const { classId, courseId } = req.body || {};

      const appName = req.headers["app-name"];
      const db = req.app.db[appName];

      // Query courses with classes scheduled today
      const courses = await db.courses
        .find({
          classes: {
            $elemMatch: {
              date: {
                $gte: todayStart,
                $lte: todayEnd,
              },
            },
          },
        })
        .toArray();

      console.log("Courses with classes today:", courses);
      return courses;
    } catch (error) {
      console.error("Error fetching courses:", error);
    } finally {
      await client.close();
    }
  }
);

router.post(
  "/api/admin/course/class/update-status",
  auth.required,
  async (req, res, next) => {
    const { classId, courseId, isActive } = req.body || {};
    const appName = req.headers["app-name"];
    const db = req.app.db[appName];

    try {
      let courseData = await db.courses.findOne({
        _id: getId(courseId),
      });

      if (!courseData) {
        res.status(400).json({ message: "Course not found" });
        return;
      }

      courseData.classes = courseData.classes.map(item => {
        if (item.id === classId) {
          return { ...item, isActive };
        }
        return item;
      });

      await db.courses.updateOne(
        { _id: getId(courseId) },
        {
          $set: {
            classes: courseData.classes,
          },
        },
        { multi: false }
      );

      res.status(200).json({
        message: "Class status updated",
        data: { courseData },
      });
    } catch (ex) {
      console.error(colors.red(`Failed to update class status: ${ex}`));
      res.status(400).json({ message: "Failed to update class status" });
    }
  }
);

module.exports = router;
