const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const { getStaff, addStaff } = require('../controllers/staffController'); 


router.get('/api/staff/classes', authenticateToken, async (req, res) => {
    const userId = req.user.id;

    if (!["Staff", "CA"].includes(req.user.role)) {
        return res.status(403).json({ message: "Forbidden" });
    }

    try {
        const [rows] = await pool.query(
            `SELECT DISTINCT c.class_id, c.year
             FROM classes c
             JOIN staff_class_access sca ON c.class_id = sca.class_id
             WHERE sca.user_id = ?`,
            [userId]
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server error" });
    }
});


module.exports = router;
