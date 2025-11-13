// server/controllers/attendanceController.js

exports.markAttendance = async (req, res) => {
  res.json({ message: "Attendance marked successfully" });
};

exports.getAttendance = async (req, res) => {
  res.json({ message: "Attendance data" });
};
