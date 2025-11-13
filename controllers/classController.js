// server/controllers/classController.js

exports.getClasses = async (req, res) => {
  res.json({ message: "List of classes" });
};

exports.getClassById = async (req, res) => {
  const { id } = req.params;
  res.json({ message: `Class details for id ${id}` });
};
