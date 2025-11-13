const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');
const studentRoutes = require('./routes/studentRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const marksRoutes = require('./routes/marksRoutes');
const classRoutes = require('./routes/classRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const forgotPasswordRoutes = require('./routes/forgotPasswordRoutes');
const staffRoutes = require('./routes/staffRoutes');

const app = express();
app.use(cors());
app.use(express.json());

// Use all routes
app.use('/api', authRoutes);
app.use('/api', studentRoutes);
app.use('/api', attendanceRoutes);
// app.use('/api', marksRoutes);
app.use('/api', classRoutes);
app.use('/api', dashboardRoutes);
app.use('/api', forgotPasswordRoutes);
app.use('/api', staffRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`ERP backend running on port ${PORT}`));
