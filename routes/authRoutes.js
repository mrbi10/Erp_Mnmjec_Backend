const express = require('express');
const router = express.Router();
const { login, signup } = require('../controllers/authController'); 
const pool = require('../db'); 
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();



// Signup
router.post('/signup', async (req, res) => {
  const { name, email, password, role, dept_id } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO users (name, email, password, role, dept_id) VALUES (?, ?, ?, ?, ?)',
      [name, email, hashedPassword, role, dept_id]
    );
    res.json({ success: true, userId: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const [rows] = await pool.query(`
      SELECT u.*, s.roll_no 
      FROM users u
      LEFT JOIN students s ON u.email = s.email
      WHERE u.email = ?`, [email]);

    if (rows.length === 0) return res.status(400).json({ message: 'User not found' });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: 'Incorrect password' });

    const token = jwt.sign({
      id: user.user_id,
      role: user.role,
      name: user.name,
      dept_id: user.dept_id,
      assigned_class_id: user.assigned_class_id || null,
      roll_no: user.roll_no || null
    }, process.env.JWT_SECRET, { expiresIn: '8h' });

    delete user.password;
    res.json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
