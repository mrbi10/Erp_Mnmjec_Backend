exports.getStaff = async (req, res) => {
  res.json({ message: "List of staff" });
};

exports.getStaffById = async (req, res) => {
  const { id } = req.params;
  res.json({ message: `Details for staff ${id}` });
};
