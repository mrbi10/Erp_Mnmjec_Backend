// studentController.js
exports.getStudents = async (req, res) => {
  res.json({ message: "List of students" });
};

exports.getStudentById = async (req, res) => {
  res.json({ message: `Details of student ${req.params.id}` });
};

// add more controller functions as needed
