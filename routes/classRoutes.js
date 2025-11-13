const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const { getClasses } = require('../controllers/classController'); 



router.get('/api/classes', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT class_id, year, section, dept_id FROM classes ORDER BY year, section'
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});


// --- Get Students by Class ---
router.get('/api/classes/:classId/students', authenticateToken, async (req, res) => {
    const { classId } = req.params;
    try {
        const [rows] = await pool.query(
            'SELECT * FROM students WHERE class_id = ?',
            [classId]
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// --- Get Subjects by Class or Staff ---
router.get('/api/subjects', authenticateToken, async (req, res) => {
    try {
        let query = '';
        let params = [];

        switch (req.user.role) {
            case 'Staff':
                // Only subjects assigned to the logged-in staff
                query = 'SELECT * FROM subjects WHERE staff_id = ?';
                params = [req.user.id];
                break;

            case 'CA':
                // Show all subjects (since classes table has no advisor_id)
                query = 'SELECT * FROM subjects';
                params = [];
                break;

            case 'HOD':
                // Subjects belonging to classes in the same department
                query = `
          SELECT s.* 
          FROM subjects s
          JOIN classes c ON s.class_id = c.class_id
          WHERE c.dept_id = ?
        `;
                params = [req.user.dept_id];
                break;

            default: // Principal or any other role
                query = 'SELECT * FROM subjects';
                params = [];
                break;
        }

        const [rows] = await pool.query(query, params);
        res.json(Array.isArray(rows) ? rows : []);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});

module.exports = router;
