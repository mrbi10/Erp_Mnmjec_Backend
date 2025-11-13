const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const { getStudent, updateStudent } = require('../controllers/studentController'); 


// Get all students
router.get('/students', authenticateToken, async (req, res) => {
  try {
    let query = '';
    let params = [];

    switch (req.user.role) {
      case 'CA':
        query = `SELECT s.* FROM students s WHERE s.class_id = ?`;
        params = [req.user.assigned_class_id];
        break;
      case 'Staff':
        query = `SELECT DISTINCT s.* FROM students s
                 JOIN subjects sub ON s.class_id = sub.class_id
                 WHERE sub.staff_id = ?`;
        params = [req.user.user_id];
        break;
      case 'HOD':
        query = `SELECT s.* FROM students s
                 JOIN classes c ON s.class_id = c.class_id
                 WHERE c.dept_id = ?`;
        params = [req.user.dept_id];
        break;
      default:
        query = 'SELECT * FROM students';
    }

    const [rows] = await pool.query(query, params);
    res.json(rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error while fetching students' });
  }
});

// Get single student by roll no
router.get('/attendance/student/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query(
      `SELECT a.*, s.roll_no, s.name AS student_name, sub.subject_name
       FROM attendance a
       JOIN students s ON a.student_id = s.student_id
       JOIN subjects sub ON a.subject_id = sub.subject_id
       WHERE s.roll_no = ?
       ORDER BY a.date ASC, a.period ASC`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
