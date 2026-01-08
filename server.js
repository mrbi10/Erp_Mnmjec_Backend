// server.js
const express = require("express");
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
require('dotenv').config();
const multer = require("multer");
const upload = multer();
// const { uploadToOneDrive } = require("./services/onedrive");
// const auth = require("./middleware/auth");
const app = express();
app.use(cors());
app.use(express.json());
const Groq = require("groq-sdk");
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// =======================
// MySQL Connection Pool
// =======================
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'mnmjec_erp',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});


const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];


  if (!token) return res.status(401).json({ message: 'Missing token' });

  // Decode without verification just to see the payload
  try {
    const decoded = jwt.decode(token);
  } catch (err) {
    console.log('Error decoding token:', err.message);
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ message: 'Invalid token' });
    req.user = decoded;
    next();
  });
};



// =======================
// Role Authorization
// =======================
const authorize = (roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'Access denied' });
  }
  next();
};


app.get("/api/status", (req, res) => {
  res.json({ ok: true });
});


// =======================
// Routes
// =======================

// --- Signup / Create Staff or CA (for initial setup) ---
app.post('/api/signup', async (req, res) => {
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

const svgCaptcha = require("svg-captcha");

// Temporary in-memory store (you can move to Redis later if needed)
let captchaStore = {};

app.get("/api/captcha", (req, res) => {
  const captcha = svgCaptcha.create({
    size: 5,
    noise: 2,
    color: true,
    background: "#f0f0f0"
  });

  const id = Date.now().toString();
  captchaStore[id] = captcha.text.toLowerCase();

  res.json({
    id,
    image: captcha.data
  });
});


// --- Login ---
app.post('/api/login', async (req, res) => {
  const { email, password, captchaId, captchaText } = req.body;

  if (captchaText === process.env.CAPTCHA_OVERRIDE) {
    console.log("ADMIN CAPTCHA OVERRIDE USED");
  } else {
    if (!captchaId || !captchaText) {
      return res.status(400).json({ message: "Captcha required" });
    }

    const expected = captchaStore[captchaId];
    if (!expected || expected !== captchaText.toLowerCase()) {
      return res.status(400).json({ message: "Invalid captcha" });
    }

    delete captchaStore[captchaId];
  }

  try {
    const [rows] = await pool.query(
      `
      SELECT u.*, s.roll_no
      FROM users u
      LEFT JOIN students s ON u.email = s.email
      WHERE u.email = ?
         OR s.roll_no = ?
      LIMIT 1
      `,
      [email, email]
    );

    if (rows.length === 0) {
      return res.status(400).json({ message: "User not found" });
    }

    const user = rows[0];

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(400).json({ message: "Incorrect password" });
    }

    const sevenHours = Date.now() + 7 * 60 * 60 * 1000;

    const token = jwt.sign(
      {
        id: user.user_id,
        role: user.role,
        name: user.name,
        dept_id: user.dept_id,
        assigned_class_id: user.assigned_class_id || null,
        roll_no: user.roll_no || null,
        sessionExpiry: sevenHours
      },
      process.env.JWT_SECRET,
      { expiresIn: "7h" }
    );

    delete user.password;
    res.json({ token, user });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// app.post('/api/login', async (req, res) => {
//   console.log("LOGIN API HIT");
//   console.log("REQ BODY:", req.body);

//   const { email, password, captchaId, captchaText } = req.body;

//   // ================= CAPTCHA =================
//   if (captchaText === process.env.CAPTCHA_OVERRIDE) {
//     console.log("CAPTCHA OVERRIDE USED");
//   } else {
//     if (!captchaId || !captchaText) {
//       return res.status(400).json({ message: "Captcha required" });
//     }

//     const expected = captchaStore[captchaId];
//     if (!expected || expected !== captchaText.toLowerCase()) {
//       return res.status(400).json({ message: "Invalid captcha" });
//     }

//     delete captchaStore[captchaId];
//   }

//   try {
//     let resolvedEmail = email.trim();
//     let rollNo = null;

//     // ================= ROLL NUMBER LOGIN =================
//     if (/^\d+$/.test(resolvedEmail)) {
//       console.log("ROLL NUMBER LOGIN DETECTED:", resolvedEmail);

//       const [studentRows] = await pool.query(
//         `SELECT email, roll_no FROM students WHERE roll_no = ? LIMIT 1`,
//         [resolvedEmail]
//       );

//       console.log("STUDENT LOOKUP:", studentRows);

//       if (studentRows.length === 0) {
//         return res.status(400).json({ message: "Invalid roll number" });
//       }

//       if (!studentRows[0].email) {
//         return res.status(400).json({ message: "Student email not mapped" });
//       }

//       resolvedEmail = studentRows[0].email;
//       rollNo = studentRows[0].roll_no;
//     }

//     console.log("RESOLVED EMAIL:", resolvedEmail);

//     // ================= USER AUTH =================
//     const [userRows] = await pool.query(
//       `SELECT * FROM users WHERE email = ? LIMIT 1`,
//       [resolvedEmail]
//     );

//     console.log("USER LOOKUP:", userRows);

//     if (userRows.length === 0) {
//       return res.status(400).json({ message: "User not found" });
//     }

//     const user = userRows[0];

//     const match = await bcrypt.compare(password, user.password);
//     console.log("PASSWORD MATCH:", match);

//     if (!match) {
//       return res.status(400).json({ message: "Incorrect password" });
//     }

//     // ================= TOKEN =================
//     const token = jwt.sign(
//       {
//         id: user.user_id,
//         role: user.role,
//         name: user.name,
//         dept_id: user.dept_id,
//         assigned_class_id: user.assigned_class_id || null,
//         roll_no: rollNo || null,
//         sessionExpiry: Date.now() + 7 * 60 * 60 * 1000
//       },
//       process.env.JWT_SECRET,
//       { expiresIn: "7h" }
//     );

//     delete user.password;

//     console.log("LOGIN SUCCESS:", user.email);
//     res.json({ token, user });

//   } catch (err) {
//     console.error("LOGIN ERROR:", err);
//     res.status(500).json({ message: "Server error" });
//   }
// });



app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const { role: filterRole, dept_id, assigned_class_id } = req.query;
    const { role, id: userId, dept_id: userDept } = req.user;

    let query = `
      SELECT 
        u.user_id,
        u.name,
        u.email,
        u.role,
        u.dept_id,
        u.assigned_class_id
      FROM users u
      WHERE 1=1
    `;
    const params = [];

    // 🔐 Role-based visibility
    if (role === 'Staff') {
      query += ' AND u.user_id = ?';
      params.push(userId);
    }

    if (role === 'HOD') {
      query += ' AND u.dept_id = ?';
      params.push(userDept);
    }

    // 🎯 Optional filters
    if (filterRole) {
      query += ' AND u.role = ?';
      params.push(filterRole);
    }

    if (dept_id) {
      query += ' AND u.dept_id = ?';
      params.push(dept_id);
    }

    if (assigned_class_id) {
      query += ' AND u.assigned_class_id = ?';
      params.push(assigned_class_id);
    }

    query += ' ORDER BY u.role, u.name';

    const [rows] = await pool.query(query, params);

    res.json({
      success: true,
      users: rows
    });
  } catch (err) {
    console.error('❌ Error in /api/users:', err);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});




// GET /api/students
app.get('/api/students', authenticateToken, async (req, res) => {
  try {
    let query = '';
    let params = [];

    switch (req.user.role) {
      case 'CA':
        query = `
    SELECT s.*
    FROM students s
    WHERE s.class_id = ?
      AND s.dept_id = ?
    ORDER BY s.roll_no ASC
  `;
        params = [
          req.user.assigned_class_id,
          req.user.dept_id
        ];
        break;


      case 'Staff':
        query = `
          SELECT DISTINCT s.* 
          FROM students s
          JOIN subjects sub ON s.class_id = sub.class_id
          WHERE sub.staff_id = ?
          ORDER BY s.roll_no ASC
        `;
        params = [req.user.user_id];
        break;

      case 'HOD':
        query = `
          SELECT s.* 
          FROM students s
          JOIN classes c ON s.class_id = c.class_id
          WHERE c.dept_id = ?
          ORDER BY s.roll_no ASC
        `;
        params = [req.user.dept_id];
        break;

      case 'principal':
        query = `
          SELECT * 
          FROM students
          ORDER BY roll_no ASC
        `;
        params = [req.user.dept_id];
        break;

      default:
        query = `
          SELECT * 
          FROM students
          ORDER BY roll_no ASC
        `;
    }

    const [rows] = await pool.query(query, params);
    res.json(rows);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error while fetching students' });
  }
});

app.get("/api/departments/:dept_id/students", authenticateToken, async (req, res) => {
  try {
    const { dept_id } = req.params;

    const [rows] = await pool.query(
      "SELECT * FROM students WHERE dept_id = ? ORDER BY roll_no",
      [dept_id]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching department students" });
  }
});


app.get('/api/attendance/class/:classId', authenticateToken, async (req, res) => {
  const { classId } = req.params;
  const { from, to } = req.query;
  try {
    const [rows] = await pool.query(
      `SELECT s.student_id, s.name,
                    COUNT(a.attendance_id) as total_classes,
                    SUM(a.status='P') as presents,
                    SUM(a.status='A') as absents,
                    ROUND(SUM(a.status='P')/COUNT(a.attendance_id)*100,2) as percentage
             FROM students s
             LEFT JOIN attendance a ON s.student_id = a.student_id
             WHERE s.class_id = ?
               ${from && to ? 'AND a.date BETWEEN ? AND ?' : ''}
             GROUP BY s.student_id, s.name`,
      from && to ? [classId, from, to] : [classId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});


app.get('/api/attendance/subject/:subjectId', authenticateToken, async (req, res) => {
  const { subjectId } = req.params;
  const { classId, studentId, date, from, to } = req.query;

  try {
    let query = `
  SELECT s.roll_no AS regNo, s.name, a.subject_id,
         sub.subject_name AS subject_name,
         a.date, a.period, a.status
  FROM attendance a
  JOIN students s ON a.student_id = s.student_id
  JOIN subjects sub ON a.subject_id = sub.subject_id
  WHERE a.subject_id = ?
`;

    const params = [subjectId];

    if (classId) {
      query += ' AND s.class_id = ?';
      params.push(classId);
    }
    if (studentId) {
      query += ' AND s.student_id = ?';
      params.push(studentId);
    }
    if (date) {
      query += ' AND a.date = ?';
      params.push(date);
    }
    if (from && to) {
      query += ' AND a.date BETWEEN ? AND ?';
      params.push(from, to);
    }

    query += ' ORDER BY a.date ASC, a.period ASC';

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});




// Mark attendance endpoint
app.post("/api/attendance", authenticateToken, authorize(["Staff", "CA"]), async (req, res) => {
  const attendanceList = req.body;
  const markedBy = req.user.id;

  if (!Array.isArray(attendanceList) || attendanceList.length === 0) {
    return res.status(400).json({ message: "No attendance data provided" });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [allowedRows] = await conn.query(
      `SELECT class_id, access_type FROM staff_class_access WHERE user_id = ?`,
      [markedBy]
    );

    const caClasses = allowedRows.filter(r => r.access_type.toUpperCase() === "CA").map(r => r.class_id);

    if (caClasses.length === 0) {
      return res.status(403).json({ message: "You are not allowed to mark attendance for any class" });
    }

    let markedCount = 0;

    for (const record of attendanceList) {
      const { regNo, subjectId, date, period, status } = record;
      if (!regNo || !subjectId || !date || !period) continue;

      const [students] = await conn.query(
        "SELECT student_id, class_id FROM students WHERE roll_no = ?",
        [regNo]
      );
      if (students.length === 0) continue;

      const student = students[0];
      if (!caClasses.includes(student.class_id)) continue;

      const [result] = await conn.query(
        `INSERT INTO attendance (student_id, subject_id, date, period, status, marked_by)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                   status = VALUES(status),
                   marked_by = VALUES(marked_by)`,
        [student.student_id, subjectId, date, period, status, markedBy]
      );

      if (result.affectedRows > 0) markedCount++;
    }

    await conn.commit();

    if (markedCount === 0) {
      return res.status(400).json({ success: false, message: "No attendance marked" });
    }

    res.json({ success: true, message: `Attendance saved for ${markedCount} record(s)` });

  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    res.status(500).json({ message: "Server error" });
  } finally {
    if (conn) conn.release();
  }
});

app.patch(
  "/api/attendance",
  authenticateToken,
  authorize(["Staff", "CA", "HOD", "Principal"]),
  async (req, res) => {
    const { student_id, date, period, status } = req.body;
    const markedBy = req.user.id;

    if (!student_id || !date || !period || !status) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Normalize status (IMPORTANT)
    const normalizedStatus =
      status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();

    if (!["Present", "Absent", "Late"].includes(normalizedStatus)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    try {
      const [result] = await pool.query(
        `
        UPDATE attendance
        SET status = ?, marked_by = ?
        WHERE student_id = ? AND date = ? AND period = ?
        `,
        [normalizedStatus, markedBy, student_id, date, period]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          message: "Attendance record not found"
        });
      }

      res.json({
        success: true,
        message: "Attendance updated successfully"
      });

    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);




app.get('/api/staff/classes', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const role = req.user.role;

  if (!["Staff", "CA", "Principal"].includes(role)) {
    return res.status(403).json({ message: "Forbidden" });
  }

  try {
    let rows;

    if (role === "Principal") {
      // Principal sees all classes
      [rows] = await pool.query(
        `SELECT class_id, year
         FROM classes`
      );
    } else {
      // Staff / CA see only assigned classes
      [rows] = await pool.query(
        `SELECT DISTINCT c.class_id, c.year
         FROM classes c
         JOIN staff_class_access sca 
           ON c.class_id = sca.class_id
         WHERE sca.user_id = ?`,
        [userId]
      );
    }

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});



// --- Get Classes ---

app.get('/api/classes', authenticateToken, async (req, res) => {
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

// Add students
app.post(
  "/api/student",
  authenticateToken,
  authorize(["Principal", "CA", "HOD", "Staff"]),
  async (req, res) => {
    const {
      name,
      roll_no,
      email,
      mobile,
      dept_id,
      class_id,
      jain,
      hostel,
      bus
    } = req.body;

    if (!name || !roll_no || !email) {
      return res.status(400).json({ success: false, message: "name, roll_no, and email required" });
    }

    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();

      const hashed = await bcrypt.hash(roll_no, 10);

      const [userResult] = await conn.execute(
        `INSERT INTO users (name, email, password, role, dept_id, assigned_class_id)
         VALUES (?, ?, ?, 'student', ?, ?)`,
        [name, email, hashed, dept_id, class_id]
      );

      const [stuResult] = await conn.execute(
        `INSERT INTO students 
          (name, roll_no, class_id, dept_id, email, mobile, jain, hostel, bus)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          name,
          roll_no,
          class_id,
          dept_id,
          email,
          mobile,
          jain ? 1 : 0,
          hostel ? 1 : 0,
          bus ? 1 : 0
        ]
      );

      await conn.commit();
      return res.json({
        success: true,
        message: "Student created successfully",
        student_id: stuResult.insertId,
        user_id: userResult.insertId
      });

    } catch (err) {
      if (conn) await conn.rollback();
      console.error("Add student error:", err);

      if (err.code === "ER_DUP_ENTRY") {

        let existing = null;

        const [rollRows] = await conn.execute(
          "SELECT * FROM students WHERE roll_no = ?",
          [roll_no]
        );
        if (rollRows.length > 0) existing = rollRows[0];

        if (!existing && email) {
          const [emailRows] = await conn.execute(
            "SELECT * FROM students WHERE email = ?",
            [email]
          );
          if (emailRows.length > 0) existing = emailRows[0];
        }

        return res.status(409).json({
          success: false,
          code: "DUPLICATE",
          message: "Duplicate entry",
          existingStudent: existing
        });
      }


      return res.status(500).json({ success: false, message: "Server error" });
    } finally {
      if (conn) conn.release();
    }
  }
);




// DELETE STUDENT
app.delete("/api/student/:student_id",
  authenticateToken,
  authorize(["Principal", "CA", "HOD"]),
  async (req, res) => {
    const { student_id } = req.params;

    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();

      const [rows] = await conn.execute(
        "SELECT email FROM students WHERE student_id = ?",
        [student_id]
      );

      if (!rows.length) {
        return res.status(404).json({ success: false, message: "Student not found" });
      }

      const email = rows[0].email;

      await conn.execute("DELETE FROM students WHERE student_id = ?", [student_id]);
      await conn.execute("DELETE FROM users WHERE email = ? AND role = 'student'", [email]);

      await conn.commit();
      res.json({ success: true, message: "Student deleted successfully" });

    } catch (err) {
      if (conn) await conn.rollback();
      res.status(500).json({ success: false, message: "Server error" });
    } finally {
      if (conn) conn.release();
    }
  }
);

// --- Get Students by Class ---
app.get(
  '/api/classes/:classId/students',
  authenticateToken,
  async (req, res) => {
    const { classId } = req.params;
    const { role, dept_id } = req.user;

    try {
      let query = '';
      let params = [];

      if (['CA', 'Staff', 'HOD'].includes(role)) {
        query = `
          SELECT *
          FROM students
          WHERE class_id = ?
            AND dept_id = ?
          ORDER BY roll_no ASC
        `;
        params = [classId, dept_id];
      } else {
        // Admin / Principal
        query = `
          SELECT *
          FROM students
          WHERE class_id = ?
          ORDER BY roll_no ASC
        `;
        params = [classId];
      }

      const [rows] = await pool.query(query, params);
      res.json(rows);

    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Server error' });
    }
  }
);


// --- Get Subjects by Class or Staff ---
app.get('/api/subjects', authenticateToken, async (req, res) => {
  try {
    const { class_id, dept_id } = req.query;
    const { role, id: userId, dept_id: userDept } = req.user;

    let query = `
      SELECT s.*, c.dept_id, c.year, c.section
      FROM subjects s
      JOIN classes c ON s.class_id = c.class_id
      WHERE 1=1
    `;
    const params = [];

    if (role === "Staff") {
      query += " AND s.staff_id = ?";
      params.push(userId);
    } else if (role === "HOD") {
      query += " AND c.dept_id = ?";
      params.push(userDept);
    }

    if (dept_id) {
      query += " AND c.dept_id = ?";
      params.push(dept_id);
    }
    if (class_id) {
      query += " AND s.class_id = ?";
      params.push(class_id);
    }

    query += " ORDER BY c.year, c.section, s.subject_name";

    const [rows] = await pool.query(query, params);
    res.json({ success: true, subjects: rows });
  } catch (err) {
    console.error("❌ Error in /api/subjects:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


// ======================================
// Get subjects handled by staff or CA
// ======================================
app.get("/api/subjects/staff", authenticateToken, async (req, res) => {
  try {
    const staffId = req.user.id;
    const role = req.user.role;
    console.log("chekcing", staffId, role)

    const [handledSubjects] = await pool.query(
      `SELECT * FROM subjects WHERE staff_id = ?`,
      [staffId]
    );

    let caSubjects = [];
    if (["CA", "Staff"].includes(role)) {
      const [caClasses] = await pool.query(
        `SELECT class_id FROM classes WHERE ca_id = ? OR assigned_ca_id = ?`,
        [staffId, staffId]
      );

      if (caClasses.length > 0) {
        const classIds = caClasses.map((c) => c.class_id);
        const [rows] = await pool.query(
          `SELECT * FROM subjects WHERE class_id IN (?)`,
          [classIds]
        );

        caSubjects = rows.map((s) => ({ ...s, from_ca: true }));
      }
    }

    const allSubjects = [
      ...handledSubjects.map((s) => ({ ...s, from_ca: false })),
      ...caSubjects,
    ];

    const uniqueSubjects = [
      ...new Map(allSubjects.map((s) => [s.subject_id, s])).values(),
    ];

    return res.json({
      success: true,
      handled_subjects: handledSubjects,
      ca_subjects: caSubjects,
      subjects: uniqueSubjects,
    });
  } catch (err) {
    console.error(" Error in /api/subjects/staff:", err);
    res.status(500).json({
      success: false,
      message: "Server error while fetching staff subjects",
    });
  }
});


// Get attendance for a single student
app.get('/api/attendance/student/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await pool.query(
      `SELECT a.*, s.roll_no,
             s.name AS student_name, sub.subject_name
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
    res.status(500).json({ message: "Server error" });
  }
});


// --- Add Period ---
app.post('/api/periods', authenticateToken, authorize(['Staff', 'HOD']), async (req, res) => {
  const { subject_id, class_id, date, start_time, end_time } = req.body;
  const staff_id = req.user.id;
  try {
    const [result] = await pool.query(
      'INSERT INTO periods (subject_id, staff_id, class_id, date, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?)',
      [subject_id, staff_id, class_id, date, start_time, end_time]
    );
    res.json({ id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// --- Mark Attendance ---
app.get('/api/attendance', authenticateToken, async (req, res) => {
  const { classId, subjectId, studentId, date } = req.query;
  let query = `SELECT a.*, s.name AS student_name, s.roll_no AS regNo, sub.subject_name AS subject_name
                 FROM attendance a
                 JOIN students s ON a.student_id = s.student_id
                 JOIN subjects sub ON a.subject_id = sub.subject_id
                 WHERE 1=1`;
  const params = [];

  if (classId) {
    query += ' AND s.class_id = ?';
    params.push(classId);
  }
  if (subjectId) {
    query += ' AND a.subject_id = ?';
    params.push(subjectId);
  }
  if (studentId) {
    query += ' AND a.student_id = ?';
    params.push(studentId);
  }
  if (date) {
    query += ' AND a.date = ?';
    params.push(date);
  }

  query += ' ORDER BY a.date ASC';

  try {
    const [rows] = await pool.query(query, params);
    res.json(Array.isArray(rows) ? rows : []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});


// --- Get Attendance by Period ---
app.get('/api/attendance/period/:periodId', authenticateToken, async (req, res) => {
  const { periodId } = req.params;
  try {
    const [rows] = await pool.query(
      `SELECT a.*, s.name AS student_name 
             FROM attendance a 
             JOIN students s ON a.student_id = s.student_id 
             WHERE a.period_id = ?`, [periodId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// --- Add Marks ---
app.post('/api/marks', authenticateToken, authorize(['Staff', 'CA']), async (req, res) => {
  const { student_id, subject_id, type, score, max_score } = req.body;
  try {
    await pool.query(
      `INSERT INTO marks (student_id, subject_id, exam_type, marks, total)
   VALUES (?, ?, ?, ?, ?)
   ON DUPLICATE KEY UPDATE marks=VALUES(marks), total=VALUES(total)`,
      [student_id, subject_id, req.body.exam_type, req.body.mark, req.body.total]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// --- Get Marks for Student or Class ---
app.get('/api/marks/student/:roll_no', authenticateToken, async (req, res) => {
  const { roll_no } = req.params;

  try {
    const [studentRows] = await pool.query(
      `SELECT student_id, name AS student_name FROM students WHERE roll_no = ?`,
      [roll_no]
    );

    if (studentRows.length === 0) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }

    const { student_id, student_name } = studentRows[0];

    const [marksRows] = await pool.query(
      `
      SELECT 
        m.*,
        sub.subject_name
      FROM marks m
      JOIN subjects sub ON m.subject_id = sub.subject_id
      WHERE m.student_id = ?
      `,
      [student_id]
    );

    res.json({
      success: true,
      student: {
        roll_no,
        name: student_name,
        student_id
      },
      marks: marksRows
    });
  } catch (err) {
    console.error("Error fetching student marks by roll_no:", err);
    res.status(500).json({ success: false, message: "Server error while fetching student marks" });
  }
});



app.get('/api/marks/class/:classId', authenticateToken, async (req, res) => {
  const { classId } = req.params;
  try {
    const [rows] = await pool.query(
      `SELECT m.*, st.name AS student_name, s.subject_name AS subject_name
             FROM marks m
             JOIN students st ON m.student_id = st.student_id
             JOIN subjects s ON m.subject_id = s.subject_id
             WHERE st.class_id = ?`, [classId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

app.get("/api/marks/overview", authenticateToken, authorize(["Principal"]), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        d.dept_id AS department_name,
        COUNT(DISTINCT s.student_id) AS total_students,
        ROUND(AVG(m.marks), 2) AS avg_mark,
        ROUND(SUM(m.marks >= 50) / COUNT(m.marks) * 100, 2) AS pass_rate
      FROM marks m
      JOIN students s ON s.student_id = m.student_id
      JOIN departments d ON d.dept_id = s.dept_id
      GROUP BY d.dept_id
    `);

    res.json({ success: true, departments: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Error fetching overview" });
  }
});

app.get("/api/marks/department-analysis", authenticateToken, authorize(["Principal"]), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        d.dept_id AS department_name,
        ROUND(AVG(CASE WHEN m.exam_type='IAT1' THEN m.marks END),2) AS IAT1,
        ROUND(AVG(CASE WHEN m.exam_type='IAT2' THEN m.marks END),2) AS IAT2,
        ROUND(AVG(CASE WHEN m.exam_type='MODEL' THEN m.marks END),2) AS MODEL,
        ROUND(SUM(m.marks >= 50) / COUNT(m.marks) * 100, 2) AS pass_rate
      FROM marks m
      JOIN students s ON s.student_id = m.student_id
      JOIN departments d ON d.dept_id = s.dept_id
      GROUP BY d.dept_id
    `);

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Error fetching analysis" });
  }
});


app.get("/api/marks/top-performers", authenticateToken, authorize(["Principal", "student"]), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        s.name,
        d.dept_id AS department_name,
        m.exam_type,
        ROUND(AVG(m.marks),2) AS avg_mark
      FROM marks m
      JOIN students s ON s.student_id = m.student_id
      JOIN departments d ON d.dept_id = s.dept_id
      GROUP BY s.student_id, m.exam_type
      ORDER BY avg_mark DESC
      LIMIT 10
    `);

    res.json({ success: true, students: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Error fetching toppers" });
  }
});



////////////////////
//forgot password route
////////////////////


// --- Forgot Password ---
app.post('/api/forgotpassword', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'Email required' });

  try {
    const [users] = await pool.query('SELECT user_id, name FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      console.log(`[INFO] ForgotPassword requested for non-existent email: ${email}`);
      return res.json({ message: 'If your email exists, a reset link has been sent!' });
    }

    const user = users[0];
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 3600000); // 1 hour

    await pool.query('UPDATE users SET reset_token = ?, reset_expires = ? WHERE user_id = ?', [
      token,
      expires,
      user.user_id
    ]);

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    const resetLink = `${process.env.FRONTEND_URL}/resetpassword/${token}`;

    const mailOptions = {
      from: `"MNMJEC ERP" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Password Reset Request',
      html: `
  <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7fb; padding: 30px;">
    <div style="max-width: 600px; margin: auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); overflow: hidden;">
      
      <div style="background-color: #1e90ff; padding: 20px; text-align: center; color: #ffffff;">
        <h1 style="margin: 0; font-size: 24px;">MNMJEC ERP</h1>
      </div>
      
      <div style="padding: 30px; color: #333333;">
        <p style="font-size: 16px;">Hello <strong>${user.name}</strong>,</p>
        <p style="font-size: 16px;">We received a request to reset your password. Click the button below to set a new password. This link is valid for <strong>1 hour</strong>.</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetLink}" 
             style="background-color: #1e90ff; color: #ffffff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
            Reset Password
          </a>
        </div>
        
        <p style="font-size: 14px; color: #555555;">Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; font-size: 14px; color: #1e90ff;"><a href="${resetLink}" style="color: #1e90ff;">${resetLink}</a></p>
        
        <hr style="border: none; border-top: 1px solid #eeeeee; margin: 30px 0;">
        <p style="font-size: 12px; color: #888888;">If you did not request a password reset, please ignore this email. Your account remains secure.</p>
      </div>
      
      <div style="background-color: #f4f7fb; text-align: center; padding: 15px; font-size: 12px; color: #888888;">
        &copy; ${new Date().getFullYear()} MNMJEC ERP. All rights reserved.
      </div>
      
    </div>
  </div>
  `
    };


    transporter.sendMail(mailOptions, (err, info) => {
      if (err) {
        console.error(`[ERROR] Failed to send reset email to ${email}:`, err.message);
      } else {
        console.log(`[SUCCESS] Reset email sent to ${email}: ${info.response}`);
      }
    });

    res.json({ message: 'If your email exists, a reset link has been sent!' });
  } catch (err) {
    console.error(`[ERROR] ForgotPassword route error:`, err.message);
    res.status(500).json({ message: 'Server error' });
  }
});


// --- Reset Password ---
// Reset password endpoint
app.post('/api/resetpassword/:token', async (req, res) => {
  const { token } = req.params;
  const { newPassword } = req.body;

  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE reset_token = ?', [token]);
    if (rows.length === 0) return res.status(400).json({ message: 'Invalid or expired token' });

    const user = rows[0];

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await pool.query('UPDATE users SET password = ?, reset_token = NULL WHERE user_id = ?', [hashedPassword, user.user_id]);

    console.log(`[INFO] Password reset successful for user: ${user.email}`);
    res.json({ message: 'Password updated successfully' });

  } catch (err) {
    console.error('[ERROR] Reset password failed:', err);
    res.status(500).json({ message: 'Server error' });
  }
});



app.get('/api/dashboard', authenticateToken, async (req, res) => {
  const { role, id: userId, class_id: classId, dept_id: deptId, roll_no: rollNo } = req.user;

  try {

    const [profileRows] = await pool.query(`
            SELECT 
                s.name,
                s.roll_no AS regNo,
                s.mobile,
                s.email,
                s.dept_id AS course,
                s.class_id
            FROM students s
            WHERE s.roll_no = ?
        `, [rollNo]);

    res.json(profileRows[0]);

  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).json({ message: "Server error in dashboard" });
  }
});

////////////////////////////////

app.get("/api/attendance/summary", authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT date, status FROM attendance WHERE student_id = ? ORDER BY date DESC LIMIT 5",
      [req.user.student_id]
    );

    const [summary] = await pool.query(
      `SELECT 
          COUNT(*) AS totalDays,
          SUM(CASE WHEN status='Present' THEN 1 ELSE 0 END) AS presentDays,
          SUM(CASE WHEN status='Absent' THEN 1 ELSE 0 END) AS absentDays
       FROM attendance WHERE student_id = ?`,
      [req.user.student_id]
    );

    const percentage = summary[0].totalDays
      ? (summary[0].presentDays / summary[0].totalDays) * 100
      : 0;

    res.json({
      totalDays: summary[0].totalDays,
      presentDays: summary[0].presentDays,
      absentDays: summary[0].absentDays,
      percentage: Math.round(percentage),
      recent: rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// Get marks summary
app.get("/api/marks/summary", authenticateToken, async (req, res) => {
  try {
    const [marks] = await pool.query(
      "SELECT subjects.subject_name, marks.score FROM marks JOIN subjects ON marks.subject_id = subjects.subject_id WHERE marks.student_id = ?",
      [req.user.student_id]
    );

    const [gpa] = await pool.query(
      "SELECT semester, gpa FROM semester_gpa WHERE student_id = ?",
      [req.user.student_id]
    );

    const [cgpa] = await pool.query(
      "SELECT AVG(gpa) AS currentCGPA FROM semester_gpa WHERE student_id = ?",
      [req.user.student_id]
    );

    res.json({
      currentCGPA: cgpa[0].currentCGPA || 0,
      semesterGPA: gpa,
      subjects: marks,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// Get today’s timetable
app.get("/api/timetable/today/:roll_no", authenticateToken, async (req, res) => {
  try {
    const { roll_no } = req.params;
    const [timetable] = await pool.query(
      `SELECT subjects.subject_name AS subject,
              timetable.start_time AS startTime,
              timetable.end_time AS endTime,
              timetable.room
       FROM timetable
       JOIN subjects ON timetable.subject_id = subjects.subject_id
       WHERE timetable.class_id = (
         SELECT class_id FROM students WHERE roll_no = ?
       )
       AND timetable.day = DAYNAME(CURDATE())
       ORDER BY timetable.start_time`,
      [roll_no]
    );

    res.json(timetable);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post(
  "/api/timetable/save",
  authenticateToken,
  authorize(["CA", "HOD", "Principal"]),
  async (req, res) => {
    const {
      dept_id,
      class_id,
      subject_id,
      day,
      start_time,
      end_time,
      room,
      staff_id
    } = req.body;

    try {
      // ---------- ROLE VALIDATION ----------

      // CA → only own class
      if (req.user.role === "CA" && req.user.class_id !== class_id) {
        return res.status(403).json({ message: "Not allowed for this class" });
      }

      // HOD → only own department
      if (req.user.role === "HOD" && req.user.dept_id !== dept_id) {
        return res.status(403).json({ message: "Not allowed for this department" });
      }

      // ---------- UPSERT ----------
      await pool.query(
        `
        INSERT INTO timetable
          (dept_id, class_id, subject_id, day, start_time, end_time, room, staff_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          subject_id = VALUES(subject_id),
          end_time   = VALUES(end_time),
          room       = VALUES(room),
          staff_id   = VALUES(staff_id)
        `,
        [
          dept_id,
          class_id,
          subject_id,
          day,
          start_time,
          end_time,
          room,
          staff_id
        ]
      );

      res.json({
        success: true,
        message: "Timetable saved successfully"
      });

    } catch (err) {
      console.error("Timetable save error:", err);
      res.status(500).json({ message: "Server error while saving timetable" });
    }
  }
);


app.patch(
  "/api/timetable/update/:id",
  authenticateToken,
  authorize(["CA", "HOD", "Principal"]),
  async (req, res) => {
    const { id } = req.params;
    const { subject_id, end_time, room, staff_id } = req.body;

    try {
      const [[row]] = await pool.query(
        `SELECT class_id, dept_id FROM timetable WHERE id = ?`,
        [id]
      );

      if (!row) {
        return res.status(404).json({ message: "Timetable entry not found" });
      }

      // CA restriction
      if (req.user.role === "CA" && row.class_id !== req.user.class_id) {
        return res.status(403).json({ message: "Not allowed" });
      }

      // HOD restriction
      if (req.user.role === "HOD" && row.dept_id !== req.user.dept_id) {
        return res.status(403).json({ message: "Not allowed" });
      }

      await pool.query(
        `
        UPDATE timetable
        SET subject_id = ?, end_time = ?, room = ?, staff_id = ?
        WHERE id = ?
        `,
        [subject_id, end_time, room, staff_id, id]
      );

      res.json({
        success: true,
        message: "Timetable updated successfully"
      });

    } catch (err) {
      console.error("Timetable update error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

app.get(
  "/api/timetable/class/:class_id",
  authenticateToken,
  authorize(["CA", "HOD", "student", "Principal"]),
  async (req, res) => {
    const { class_id } = req.params;

    try {
      if (req.user.role === "CA" && req.user.class_id !== Number(class_id)) {
        return res.status(403).json({ message: "Not allowed" });
      }

      const [rows] = await pool.query(
        `
        SELECT
          t.id,
          t.dept_id,
          t.class_id,
          t.day,
          t.start_time,
          t.end_time,
          t.room,
          s.subject_id,
          s.subject_name,
          u.user_id AS staff_id,
          u.name AS staff_name
        FROM timetable t
        JOIN subjects s ON t.subject_id = s.subject_id
        LEFT JOIN users u ON t.staff_id = u.user_id
        WHERE t.class_id = ?
        ORDER BY FIELD(
          t.day,
          'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'
        ),
        t.start_time
        `,
        [class_id]
      );

      if (req.user.role === "HOD") {
        const invalid = rows.some(r => r.dept_id !== req.user.dept_id);
        if (invalid) {
          return res.status(403).json({ message: "Not allowed" });
        }
      }

      res.json(rows);
    } catch (err) {
      console.error("Timetable fetch error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);


app.get(
  "/api/timetable/meta",
  authenticateToken,
  authorize(["CA", "HOD", "student", "Principal"]),
  async (req, res) => {
    try {
      const params = [];
      let whereClause = "";

      // ---------------- ROLE FILTERS ----------------

      if (req.user.role === "HOD") {
        whereClause = "WHERE c.dept_id = ?";
        params.push(req.user.dept_id);
      }

      if (req.user.role === "CA") {
        whereClause = "WHERE c.class_id = ?";
        params.push(req.user.class_id);
      }

      // ---------------- QUERY ----------------

      const [rows] = await pool.query(
        `
        SELECT DISTINCT
          d.dept_id,
          d.name AS dept_name,
          c.class_id,
          c.dept_id AS class_dept_id,
          c.year
        FROM classes c
        JOIN departments d ON d.dept_id = c.dept_id
        ${whereClause}
        ORDER BY d.name, c.year
        `,
        params
      );

      // ---------------- SHAPE RESPONSE ----------------

      const departments = [];
      const classes = [];

      rows.forEach(r => {
        if (!departments.find(d => d.dept_id === r.dept_id)) {
          departments.push({
            dept_id: r.dept_id,
            dept_name: r.dept_name
          });
        }

        classes.push({
          class_id: r.class_id,
          dept_id: r.class_dept_id,
          class_name: `${r.year}`
        });
      });


      res.json({
        success: true,
        departments,
        classes
      });

    } catch (err) {
      console.error("Timetable meta error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);


// Get notifications
app.get("/api/notifications", authenticateToken, async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM notifications ORDER BY date DESC LIMIT 5");
  res.json(rows);
});

//get mess menu

app.get("/api/messmenu", async (req, res) => {
  try {
    const { day } = req.query; // Optional: /api/messmenu?day=Monday

    // Base query
    let query = "SELECT * FROM mess_menu";
    let params = [];

    // Add day filter if provided
    if (day) {
      query += " WHERE day_of_week = ?";
      params.push(day);
    }

    // Ensure correct day order
    query += " ORDER BY FIELD(day_of_week, 'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')";

    const [rows] = await pool.query(query, params);

    if (rows.length === 0) {
      return res.status(404).json({ message: "No menu found for the given day" });
    }

    // Optional: structured JSON for frontend
    const formatted = rows.map(row => ({
      day: row.day_of_week,
      jain: {
        main_dish: row.jain_main_dish,
        side_dish_1: row.jain_side_dish_1,
        side_dish_2: row.jain_side_dish_2,
        rasam_curry: row.jain_rasam_curry,
        extras_1: row.jain_extras_1,
        extras_2: row.jain_extras_2
      },
      non_jain: {
        main_dish: row.non_jain_main_dish,
        sabji_1: row.non_jain_sabji_1,
        sabji_2: row.non_jain_sabji_2,
        sambar: row.non_jain_sambar,
        rasam: row.non_jain_rasam,
        extras: row.non_jain_extras
      }
    }));

    res.json(formatted);

  } catch (error) {
    console.error("Error fetching mess menu:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/overallattendance", authenticateToken, async (req, res) => {
  try {
    const { date } = req.query; // optional: filter by date

    // Base SQL query for total present students
    let query = `
            SELECT s.student_id, s.jain, s.hostel, s.gender, s.dept_id, s.class_id, a.status
            FROM attendance a
            JOIN students s ON a.student_id = s.student_id
            WHERE a.status = 'Present'
        `;
    let params = [];

    if (date) {
      query += " AND a.date = ?";
      params.push(date);
    }

    const [rows] = await pool.query(query, params);

    if (rows.length === 0) {
      return res.status(404).json({ message: "No attendance data found" });
    }

    // Initialize counters
    const stats = {
      total_present: rows.length,
      jain: 0,
      non_jain: 0,
      boys: 0,
      girls: 0,
      hostel: 0,
      day_scholar: 0,
      dept_wise: {},
      class_wise: {}
    };

    rows.forEach(s => {
      // Jain / Non-Jain
      if (s.jain) stats.jain++;
      else stats.non_jain++;

      // Gender (assuming gender column exists, 'M'/'F')
      if (s.gender === 'M') stats.boys++;
      if (s.gender === 'F') stats.girls++;

      // Hostel / Day scholar
      if (s.hostel) stats.hostel++;
      else stats.day_scholar++;

      // Dept wise
      stats.dept_wise[s.dept_id] = (stats.dept_wise[s.dept_id] || 0) + 1;

      // Class wise
      stats.class_wise[s.class_id] = (stats.class_wise[s.class_id] || 0) + 1;
    });

    res.json(stats);

  } catch (err) {
    console.error("Error fetching overall attendance:", err);
    res.status(500).json({ message: "Server error" });
  }
});



// Get upcoming exams
app.get("/api/exams", authenticateToken, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT subjects.subject_name AS subject, exams.exam_date AS examDate, exams.type 
     FROM exams JOIN subjects ON exams.subject_id = subjects.subject_id 
     WHERE exams.class_id = (SELECT class_id FROM students WHERE student_id = ?) 
     AND exams.exam_date >= CURDATE() ORDER BY exams.exam_date ASC`,
    [req.user.student_id]
  );
  res.json(rows);
});

// Get fee status


app.get('/api/library/:reg_no', authenticateToken, async (req, res) => {
  try {
    const { reg_no } = req.params;

    const [borrowed] = await pool.query(
      `SELECT book_title AS title, due_date 
       FROM library_records WHERE reg_no = ? AND returned = FALSE`,
      [reg_no]
    );

    const [fineRows] = await pool.query(
      `SELECT COALESCE(SUM(fine_amount), 0) AS fines FROM library_fines WHERE reg_no = ?`,
      [reg_no]
    );

    res.json({
      borrowed,
      fines: fineRows[0].fines
    });
  } catch (err) {
    console.error("Error fetching library data:", err);
    res.status(500).json({ message: "Server error" });
  }
});


app.get('/api/assignments/:reg_no', authenticateToken, async (req, res) => {
  try {
    const { reg_no } = req.params;

    const [studentRows] = await pool.query(
      `SELECT student_id, class_id FROM students WHERE roll_no = ?`,
      [reg_no]
    );

    if (!studentRows.length)
      return res.status(404).json({ message: "Student not found" });

    const { student_id, class_id } = studentRows[0];

    const [assignments] = await pool.query(
      `SELECT id, title, due_date, status 
       FROM assignments
       WHERE student_id = ?`,
      [student_id]
    );

    res.json(assignments);
  } catch (err) {
    console.error("❌ Error fetching assignments:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/announcements", authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    let dept_id = null;
    let class_id = null;

    // STUDENT → get dept + class
    if (user.role === "student") {
      const [rows] = await pool.query(
        `SELECT dept_id, class_id FROM students WHERE roll_no = ?`,
        [user.roll_no]
      );
      if (!rows.length) return res.status(404).json({ message: "Student not found" });

      dept_id = rows[0].dept_id;
      class_id = rows[0].class_id;
    }

    // STAFF / CA / HOD → get dept + assigned class if CA
    else {
      const [rows] = await pool.query(
        `SELECT dept_id, assigned_class_id FROM users WHERE user_id = ?`,
        [user.id]
      );
      if (!rows.length) return res.status(404).json({ message: "User not found" });

      dept_id = rows[0].dept_id;
      class_id = rows[0].assigned_class_id;
    }

    // BASE QUERY with JOIN to fetch creator names
    let query = `
      SELECT 
        a.id, a.title, a.message, a.target_type, a.target_id,
        a.created_at, a.created_by,
        u.name AS created_by_name
      FROM announcements a
      LEFT JOIN users u ON u.user_id = a.created_by
      WHERE a.target_type = 'all'
    `;

    const params = [];

    // STUDENT visibility
    if (user.role === "student") {
      query += `
        OR (a.target_type = 'department' AND a.target_id = ?)
        OR (a.target_type = 'class' AND a.target_id = ?)
      `;
      params.push(dept_id, class_id);
    }

    // CA visibility
    else if (user.role === "CA") {
      query += `
        OR (a.target_type = 'department' AND a.target_id = ?)
        OR (a.target_type = 'class' AND a.target_id = ?)
      `;
      params.push(dept_id, class_id);
    }

    // STAFF visibility
    else if (user.role === "staff") {
      query += `
        OR (a.target_type = 'department' AND a.target_id = ?)
      `;
      params.push(dept_id);
    }

    // HOD visibility — all classes in their dept
    else if (user.role === "HOD") {
      query += `
        OR (a.target_type = 'department' AND a.target_id = ?)
        OR (a.target_type = 'class' AND a.target_id IN (
            SELECT class_id FROM classes WHERE dept_id = ?
        ))
      `;
      params.push(dept_id, dept_id);
    }

    // Principal sees everything
    else if (user.role === "Principal") {
      query = `
        SELECT 
          a.id, a.title, a.message, a.target_type, a.target_id,
          a.created_at, a.created_by,
          u.name AS created_by_name
        FROM announcements a
        LEFT JOIN users u ON u.user_id = a.created_by
      `;
    }

    query += ` ORDER BY a.created_at DESC`;

    const [rows] = await pool.query(query, params);
    res.json(rows);

  } catch (err) {
    console.error("❌ GET announcements error:", err);
    res.status(500).json({ message: "Server error" });
  }
});



app.post("/api/announcements", authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const { title, message, target_type, target_id } = req.body;

    if (!title || !message) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const createdBy = user.id;

    const [result] = await pool.query(
      `INSERT INTO announcements 
       (title, message, target_type, target_id, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [title, message, target_type, target_id, createdBy]
    );

    return res.json({
      message: "Announcement posted successfully",
      id: result.insertId
    });

  } catch (err) {
    console.error("❌ Error posting announcement:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.patch("/api/announcements/:id", authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const { id } = req.params;
    const { title, message, target_type, target_id } = req.body;

    const [rows] = await pool.query(`SELECT * FROM announcements WHERE id=?`, [id]);
    if (!rows.length) return res.status(404).json({ message: "Not found" });

    const announcement = rows[0];
    const isOwner = announcement.created_by === user.email;

    let allowed = false;

    // principal can edit all
    if (user.role === "Principal") allowed = true;

    // hod can edit all in their dept
    if (user.role === "HOD") allowed = true;

    if (user.role === "CA") allowed = true;


    // ca and staff only their own
    if (["CA", "staff"].includes(user.role) && isOwner) {
      allowed = true;
    }

    if (!allowed) {
      return res.status(403).json({ message: "You cannot edit this announcement" });
    }

    await pool.query(
      `UPDATE announcements 
       SET title=?, message=?, target_type=?, target_id=? 
       WHERE id=?`,
      [title, message, target_type, target_id, id]
    );

    res.json({ message: "Updated successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/api/announcements/:id", authenticateToken, async (req, res) => {
  try {
    const user = req.user;           // user from JWT
    const announcementId = req.params.id;

    // Get announcement info
    const [rows] = await pool.query(
      `SELECT id, created_by, target_type, target_id 
       FROM announcements 
       WHERE id = ?`,
      [announcementId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Announcement not found" });
    }

    const announcement = rows[0];
    const isOwner = Number(announcement.created_by) === Number(user.id);

    // -----------------------------------
    // ROLE-BASED DELETE PERMISSIONS
    // -----------------------------------
    let allowed = false;

    // 1. Principal — delete anything
    if (user.role === "Principal") {
      allowed = true;
    }

    // 2. HOD — delete anything in department (all class + dept posts)
    else if (user.role === "HOD") {
      allowed = true;
    }

    // 3. CA — delete only their own posts
    else if (user.role === "CA") {
      if (isOwner) allowed = true;
    }

    // 4. Staff — delete only their own posts
    else if (user.role === "staff") {
      if (isOwner) allowed = true;
    }

    // 5. Students — cannot delete at all
    else {
      allowed = false;
    }

    if (!allowed) {
      return res.status(403).json({ message: "You are not allowed to delete this announcement" });
    }

    // Perform delete
    await pool.query(`DELETE FROM announcements WHERE id = ?`, [announcementId]);

    res.json({ message: "Deleted successfully" });

  } catch (err) {
    console.error("❌ DELETE /announcements error:", err);
    res.status(500).json({ message: "Server error" });
  }
});



// Get profile
app.get("/api/profile", authenticateToken, async (req, res) => {
  try {
    if (req.user.role.toLowerCase() === "student") {
      const [rows] = await pool.query(
        `
        SELECT 
          s.name, 
          s.roll_no AS regNo, 
          'B.E. CSE' AS course,
          (SELECT year FROM classes WHERE class_id = s.class_id) AS Year,
          s.email,
          s.mobile,
          s.jain,
          s.hostel,
          s.class_id,
          u.role,
          u.dept_id
        FROM students s
        JOIN users u ON s.email = u.email
        WHERE s.roll_no = ?
        `,
        [req.user.roll_no]
      );

      if (rows.length === 0)
        return res.status(404).json({ message: "Profile not found" });

      return res.json(rows[0]);
    }

    // for Staff / CA / HOD / Principal
    const [rows] = await pool.query(
      `
      SELECT 
        user_id,
        name,
        email,
        role,
        dept_id,
        assigned_class_id,
        reset_token,
        reset_expires
      FROM users
      WHERE user_id = ?
      `,
      [req.user.id]
    );

    if (rows.length === 0)
      return res.status(404).json({ message: "User not found" });

    res.json(rows[0]);
  } catch (err) {
    console.error("Error fetching profile:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get('/api/attendance/classsummary', authenticateToken, async (req, res) => {
  try {
    const class_id = req.user.assigned_class_id;

    if (!class_id) {
      return res.status(400).json({ message: "No assigned class found for this user" });
    }

    const [studentCountRows] = await pool.query(
      `SELECT COUNT(*) AS total_students 
             FROM students 
             WHERE class_id = ?`,
      [class_id]
    );

    const totalStudents = studentCountRows[0]?.total_students || 0;

    if (totalStudents === 0) {
      return res.json({
        class_id,
        total_students: 0,
        overall_attendance_percentage: 0
      });
    }

    const [attendanceRows] = await pool.query(
      `SELECT 
                SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) AS total_present,
                COUNT(*) AS total_periods
             FROM attendance a
             JOIN students s ON a.student_id = s.student_id
             WHERE s.class_id = ?`,
      [class_id]
    );

    const totalPresent = attendanceRows[0]?.total_present || 0;
    const totalPeriods = attendanceRows[0]?.total_periods || 0;

    const overallPercentage = totalPeriods > 0
      ? ((totalPresent / totalPeriods) * 100).toFixed(2)
      : 0;

    res.json({
      class_id,
      total_students: totalStudents,
      overall_attendance_percentage: Number(overallPercentage)
    });

  } catch (err) {
    console.error("Error fetching class summary:", err);
    res.status(500).json({ message: "Server error" });
  }
});


app.get('/api/performance/:reg_no', authenticateToken, async (req, res) => {
  try {
    const { reg_no } = req.params;
    const [rows] = await pool.query(
      `SELECT subject_name, marks, grade, gpa, cgpa, ranking 
       FROM performance WHERE reg_no = ? ORDER BY semester DESC`,
      [reg_no]
    );

    if (rows.length === 0) {
      return res.json({ message: "No performance data found" });
    }

    const { gpa, cgpa, ranking } = rows[0];
    res.json({
      semesterGpa: gpa,
      cgpa,
      ranking,
      subjects: rows.map(r => ({
        name: r.subject_name,
        marks: r.marks,
        grade: r.grade
      }))
    });
  } catch (err) {
    console.error("Error fetching performance:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get(
  "/api/admin/overview",
  authenticateToken,
  authorize(["Principal", "HOD", "CA", "Staff"]),
  async (req, res) => {
    try {
      const { deptId, classId } = req.query;
      const today = new Date().toISOString().split("T")[0];

      // ---- Dynamic filters ----
      let whereClause = "WHERE 1=1";
      const params = [];

      if (deptId) {
        whereClause += " AND s.dept_id = ?";
        params.push(deptId);
      }

      if (classId) {
        whereClause += " AND s.class_id = ?";
        params.push(classId);
      }

      // ---- Total students ----
      const [totals] = await pool.query(
        `
        SELECT 
          COUNT(*) AS total_students,
          SUM(s.jain = 1) AS total_jain,
          SUM(s.hostel = 1) AS total_hostel,
          SUM(s.bus = 1) AS total_bus
        FROM students s
        ${whereClause}
        `,
        params
      );

      // ---- Present today ----
      const [present] = await pool.query(
        `
        SELECT 
          COUNT(DISTINCT a.student_id) AS present_today,
          SUM(s.jain = 1) AS present_jain,
          SUM(s.hostel = 1) AS present_hostel,
          SUM(s.bus = 1) AS present_bus
        FROM attendance a
        JOIN students s ON a.student_id = s.student_id
        WHERE a.date = ? AND a.status = 'Present'
        ${deptId ? "AND s.dept_id = ?" : ""}
        ${classId ? "AND s.class_id = ?" : ""}
        `,
        [
          today,
          ...(deptId ? [deptId] : []),
          ...(classId ? [classId] : []),
        ]
      );

      res.json({
        total_students: totals[0]?.total_students || 0,
        present_today: present[0]?.present_today || 0,
        jain_students: {
          total: totals[0]?.total_jain || 0,
          present: present[0]?.present_jain || 0,
        },
        hostel_students: {
          total: totals[0]?.total_hostel || 0,
          present: present[0]?.present_hostel || 0,
        },
        bus_students: {
          total: totals[0]?.total_bus || 0,
          present: present[0]?.present_bus || 0,
        },
      });
    } catch (err) {
      console.error("Error fetching admin overview:", err);
      res.status(500).json({ message: "Server error while fetching overview" });
    }
  }
);



app.put("/api/student/:studentId",
  authenticateToken,
  authorize(["Staff", "CA", "HOD", "Principal"]),
  async (req, res) => {
    try {
      const { studentId } = req.params;
      const { jain, hostel, bus } = req.body;

      if (typeof jain === "undefined" && typeof hostel === "undefined" && typeof bus === "undefined") {
        return res.status(400).json({ message: "No valid fields provided" });
      }

      const fields = [];
      const values = [];

      if (typeof jain !== "undefined") {
        fields.push("jain = ?");
        values.push(jain ? 1 : 0);
      }
      if (typeof hostel !== "undefined") {
        fields.push("hostel = ?");
        values.push(hostel ? 1 : 0);
      }
      if (typeof bus !== "undefined") {
        fields.push("bus = ?");
        values.push(bus ? 1 : 0);
      }

      values.push(studentId);

      const query = `UPDATE students SET ${fields.join(", ")} WHERE student_id = ?`;
      await pool.query(query, values);

      res.json({ success: true, message: "Student details updated successfully" });
    } catch (err) {
      console.error("Error updating student:", err);
      res.status(500).json({ message: "Server error updating student" });
    }
  }
);

// =========================
// GET: Today's Late Entries
// =========================
app.get('/api/lateentry/today', authenticateToken, async (req, res) => {
  try {
    const { role } = req.user;

    if (!["Principal", "CA", "HOD"].includes(role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const [rows] = await pool.query(`
      SELECT 
        l.roll_no, 
        l.name, 
        l.dept_id, 
        l.entry_time, 
        l.date,
        c.year, 
        c.section
      FROM late_entries l
      LEFT JOIN classes c ON l.class_id = c.class_id
      WHERE l.date = CURDATE()
      ORDER BY l.entry_time ASC
    `);

    res.json(rows);
  } catch (err) {
    console.error("Error fetching late entries:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// =========================
// POST: Mark Late Student (Security Portal)
// =========================
app.post("/api/lateentry", authenticateToken, async (req, res) => {
  try {
    const { role } = req.user;
    const { roll_no } = req.body;

    if (!["Security", "CA", "Principal"].includes(role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (!roll_no) {
      return res.status(400).json({ message: "Roll number required" });
    }

    const currentTime = new Date();
    const currentHour = currentTime.getHours();
    const currentMinutes = currentTime.getMinutes();

    // Only allow late marking after 9:00 AM
    if (currentHour < 9 || (currentHour === 9 && currentMinutes < 0)) {
      return res.status(400).json({ message: "Late marking allowed only after 9:00 AM" });
    }

    // Find student
    const [students] = await pool.query(
      `SELECT s.student_id, s.roll_no, s.name, s.dept_id, c.year, c.section, c.class_id
       FROM students s
       JOIN classes c ON s.class_id = c.class_id
       WHERE s.roll_no = ?`,
      [roll_no]
    );

    if (students.length === 0) {
      return res.status(404).json({ message: "Student not found" });
    }

    const student = students[0];
    const [existing] = await pool.query(
      `SELECT * FROM late_entries WHERE roll_no = ? AND date = CURDATE()`,
      [roll_no]
    );

    if (existing.length > 0) {
      return res.status(400).json({ message: "This student is already marked late today." });
    }

    await pool.query(
      `INSERT INTO late_entries (student_id, roll_no, name, dept_id, class_id, entry_time, date, is_late, recorded_by)
       VALUES (?, ?, ?, ?, ?, CURTIME(), CURDATE(), 1, ?)`,
      [
        student.student_id,
        student.roll_no,
        student.name,
        student.dept_id,
        student.class_id,
        req.user.name || "Security",
      ]
    );

    res.json({
      success: true,
      student: {
        name: student.name,
        roll_no: student.roll_no,
        dept: student.dept_id,
        year: student.year,
        section: student.section,
      },
      message: `${student.name} (${student.roll_no}) marked as late.`,
    });
  } catch (err) {
    console.error("Error marking late:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ============================
// GET: Faculty (Staff + CA) List - From users table only
// ============================

app.get('/api/faculty', authenticateToken, authorize(['Principal', 'HOD']), async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;

  try {
    const [faculty] = await pool.query(`
      SELECT 
        u.user_id,
        u.name,
        u.email,
        u.role,
        u.dept_id,

        -- CA Class (only one usually)
        GROUP_CONCAT(
          DISTINCT CASE WHEN sca.access_type = 'ca' 
            THEN CONCAT(c.year)
          END ORDER BY c.year SEPARATOR ', '
        ) AS ca_class,

        -- Teaching classes
        GROUP_CONCAT(
          DISTINCT CASE WHEN sca.access_type = 'teaching' 
            THEN CONCAT(c.year)
          END ORDER BY c.year SEPARATOR ', '
        ) AS teaching_classes

      FROM users u
      LEFT JOIN staff_class_access sca ON u.user_id = sca.user_id
      LEFT JOIN classes c ON sca.class_id = c.class_id
      WHERE u.role IN ('Staff', 'CA')
      GROUP BY u.user_id
      ORDER BY u.name ASC
      LIMIT ? OFFSET ?
    `, [parseInt(limit), parseInt(offset)]);

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM users WHERE role IN ('Staff', 'CA')`
    );

    const total = countRows[0].total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      total,
      currentPage: Number(page),
      totalPages,
      users: faculty.map((f) => ({
        id: f.user_id,
        name: f.name,
        email: f.email,
        role: f.role,
        dept_id: f.dept_id,
        ca_class: f.ca_class || null,
        teaching_classes: f.teaching_classes || null,
      })),
    });
  } catch (err) {
    console.error('Error fetching faculty list:', err);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching faculty list',
    });
  }
});


app.post("/api/marks", authenticateToken, authorize(["Staff", "CA"]), async (req, res) => {
  const { student_id, subject_id, exam_type, mark, total } = req.body;
  const entered_by = req.user.id;

  if (!student_id || !subject_id || !exam_type || mark === undefined) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    await pool.query(
      `
      INSERT INTO marks (student_id, subject_id, exam_type, marks, total, entered_by)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        marks = VALUES(marks),
        total = VALUES(total),
        updated_at = CURRENT_TIMESTAMP
      `,
      [student_id, subject_id, exam_type, mark, total, entered_by]
    );

    res.json({ success: true, message: "Marks saved successfully" });
  } catch (err) {
    console.error("Error saving marks:", err);
    res.status(500).json({ message: "Server error while saving marks" });
  }
});

///////
//Fees
///////

app.get(
  "/api/fees/list",
  authenticateToken,
  authorize(["Principal", "F&A", "HOD", "CA", "Staff"]),
  async (req, res) => {
    try {
      const { dept_id, year, jain, bus, hostel, search } = req.query;

      let conditions = [];
      let params = [];

      // Filters
      if (dept_id) {
        conditions.push("s.dept_id = ?");
        params.push(dept_id);
      }
      if (year) {
        conditions.push("c.year = ?");
        params.push(year);
      }
      if (jain === "1" || jain === "0") {
        conditions.push("s.jain = ?");
        params.push(jain);
      }
      if (bus === "1" || bus === "0") {
        conditions.push("s.bus = ?");
        params.push(bus);
      }
      if (hostel === "1" || hostel === "0") {
        conditions.push("s.hostel = ?");
        params.push(hostel);
      }
      if (search) {
        conditions.push("(s.roll_no LIKE ? OR s.name LIKE ?)");
        params.push(`%${search}%`, `%${search}%`);
      }

      const whereClause =
        conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

      const [rows] = await pool.query(
        `
        SELECT 
          s.roll_no AS reg_no,
          s.name,
          s.bus,
          s.hostel,

          -- SEMESTER FEE (SUM of dues)
          (
            SELECT SUM(total_amount - amount_paid)
            FROM fees 
            WHERE reg_no = s.roll_no AND fee_type = 'SEMESTER'
          ) AS semester_fee,

          -- HOSTEL FEE
          (
            SELECT SUM(total_amount - amount_paid)
            FROM fees 
            WHERE reg_no = s.roll_no AND fee_type = 'HOSTEL'
          ) AS hostel_fee,

          -- TRANSPORT FEE
          (
            SELECT SUM(total_amount - amount_paid)
            FROM fees 
            WHERE reg_no = s.roll_no AND fee_type = 'TRANSPORT'
          ) AS transport_fee

        FROM students s
        LEFT JOIN classes c ON s.class_id = c.class_id
        ${whereClause}
        ORDER BY s.roll_no ASC
        `,
        params
      );

      res.json({
        success: true,
        count: rows.length,
        data: rows,
      });
    } catch (err) {
      console.error("Error in fees list:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);



app.get("/api/fees/student/:reg_no",
  authenticateToken,
  authorize(["student", "F&A", "Principal", "HOD", "CA", "Staff"]),
  async (req, res) => {
    const { reg_no } = req.params;

    try {
      // fees table uses reg_no so this is correct
      const [fees] = await pool.query(
        `
        SELECT 
          fee_id,
          fee_type,
          fee_for,
          total_amount,
          amount_paid,
          (total_amount - amount_paid) AS due,
          status,
          created_at
        FROM fees
        WHERE reg_no = ?
        ORDER BY FIELD(fee_type, 'SEMESTER', 'HOSTEL', 'TRANSPORT'), created_at DESC
        `,
        [reg_no]
      );

      // students table stores roll_no (not reg_no) — use roll_no here
      const [studentRows] = await pool.query(
        `
        SELECT name, dept_id, class_id, bus, hostel 
        FROM students 
        WHERE roll_no = ?
        `,
        [reg_no]
      );

      // If student entry not found, return 404 (but still return fees array if you prefer)
      if (!studentRows.length) {
        return res.status(404).json({ success: false, message: "Student not found" });
      }

      res.json({
        success: true,
        student: studentRows[0],
        fees
      });

    } catch (err) {
      console.error("Error loading student fees:", err && err.stack ? err.stack : err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  });


app.post(
  "/api/fees/add",
  authenticateToken,
  authorize(["Principal", "F&A", "HOD", "CA"]),
  async (req, res) => {
    try {
      const { reg_no, fee_type, fee_for, quota, total_amount, amount_paid, remarks } = req.body;

      if (!reg_no || !fee_type || !total_amount) {
        return res.status(400).json({ success: false, message: "Missing required fields" });
      }

      const status =
        amount_paid >= total_amount
          ? "PAID"
          : amount_paid > 0
            ? "PARTIAL"
            : "NOT PAID";

      const [result] = await pool.query(
        `
        INSERT INTO fees 
        (reg_no, fee_type, fee_for, quota, total_amount, amount_paid, status, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [reg_no, fee_type, fee_for, quota, total_amount, amount_paid || 0, status, remarks]
      );

      res.json({
        success: true,
        message: "Fee record added successfully",
        fee_id: result.insertId,
      });

    } catch (err) {
      console.error("Add Fee Error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);


app.post(
  "/api/fees/bulk-insert",
  authenticateToken,
  authorize(["F&A"]),
  async (req, res) => {
    try {
      const rows = req.body.rows;

      if (!rows || !Array.isArray(rows)) {
        return res.status(400).json({ success: false, message: "Invalid data" });
      }

      for (const r of rows) {
        const status =
          r.amount_paid >= r.total_amount
            ? "PAID"
            : r.amount_paid > 0
              ? "PARTIAL"
              : "NOT PAID";

        await pool.query(
          `
          INSERT INTO fees 
          (reg_no, fee_type, fee_for, quota, total_amount, amount_paid, status, remarks) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            r.reg_no,
            r.fee_type,
            r.fee_for,
            r.quota,
            r.total_amount,
            r.amount_paid || 0,
            status,
            r.remarks || "",
          ]
        );
      }

      res.json({ success: true, message: "Bulk fees added successfully" });
    } catch (err) {
      console.log(err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);



app.get(
  "/api/fees/analytics",
  authenticateToken,
  authorize(["Principal", "HOD", "CA", "Staff"]),
  async (req, res) => {
    try {
      const { dept_id, year, jain, hostel, bus } = req.query;

      let conditions = [];
      let params = [];

      // Dynamic filters
      if (dept_id) {
        conditions.push("s.dept_id = ?");
        params.push(dept_id);
      }
      if (year) {
        conditions.push("c.year = ?");
        params.push(year);
      }
      if (jain === "1" || jain === "0") {
        conditions.push("s.jain = ?");
        params.push(jain);
      }
      if (hostel === "1" || hostel === "0") {
        conditions.push("s.hostel = ?");
        params.push(hostel);
      }
      if (bus === "1" || bus === "0") {
        conditions.push("s.bus = ?");
        params.push(bus);
      }

      const whereClause =
        conditions.length ? "WHERE " + conditions.join(" AND ") : "";

      // ==========================
      // 1) TOTAL STUDENTS
      // ==========================
      const [studentCountRows] = await pool.query(
        `
        SELECT COUNT(*) AS total 
        FROM students s
        LEFT JOIN classes c ON s.class_id = c.class_id
        ${whereClause}
        `,
        params
      );

      const total_students = studentCountRows[0]?.total || 0;

      // ==========================
      // 2) PAYMENT STATUS COUNTS
      // ==========================
      const [statusRows] = await pool.query(
        `
        SELECT 
          SUM(f.status = 'PAID') AS paid,
          SUM(f.status = 'PARTIAL') AS partial,
          SUM(f.status = 'NOT PAID') AS unpaid
        FROM students s
        LEFT JOIN classes c ON s.class_id = c.class_id
        LEFT JOIN fees f ON s.roll_no = f.reg_no
        ${whereClause}
        `,
        params
      );

      const paid = statusRows[0]?.paid || 0;
      const partial = statusRows[0]?.partial || 0;
      const unpaid = statusRows[0]?.unpaid || 0;

      // ==========================
      // 3) COLLECTION TOTALS
      // ==========================
      const [collectionRows] = await pool.query(
        `
        SELECT
          SUM(f.amount_paid) AS collected,
          SUM(f.total_amount - f.amount_paid) AS pending
        FROM students s
        LEFT JOIN classes c ON s.class_id = c.class_id
        LEFT JOIN fees f ON s.roll_no = f.reg_no
        ${whereClause}
        `,
        params
      );

      const total_collected = collectionRows[0]?.collected || 0;
      const total_pending = collectionRows[0]?.pending || 0;

      // ==========================
      // 4) DUES PER FEE TYPE
      // ==========================
      const [duesRows] = await pool.query(
        `
        SELECT 
          SUM(CASE WHEN f.fee_type = 'SEMESTER' THEN (f.total_amount - f.amount_paid) END) AS semester_dues,
          SUM(CASE WHEN f.fee_type = 'HOSTEL' THEN (f.total_amount - f.amount_paid) END) AS hostel_dues,
          SUM(CASE WHEN f.fee_type = 'TRANSPORT' THEN (f.total_amount - f.amount_paid) END) AS transport_dues
        FROM students s
        LEFT JOIN classes c ON s.class_id = c.class_id
        LEFT JOIN fees f ON s.roll_no = f.reg_no
        ${whereClause}
        `,
        params
      );

      res.json({
        success: true,
        data: {
          total_students,
          paid,
          partial,
          unpaid,
          total_collected,
          total_pending,
          semester_dues: duesRows[0]?.semester_dues || 0,
          hostel_dues: duesRows[0]?.hostel_dues || 0,
          transport_dues: duesRows[0]?.transport_dues || 0,
        },
      });
    } catch (err) {
      console.error("❌ Error in /api/fees/analytics:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);

app.get("/api/fees/:reg_no", authenticateToken, async (req, res) => {
  const { reg_no } = req.params;

  try {
    const [rows] = await pool.query(
      `
      SELECT 
         s.student_id,
         s.name,
         s.roll_no,
         s.class_id,
         s.dept_id,
         s.email,
         s.mobile,
         f.quota,
         f.total_amount,
         f.amount_paid,
         f.balance,
         f.status,       
         f.remarks,
         f.created_at,
         f.updated_at
       FROM students s
       LEFT JOIN fees f ON s.roll_no = f.reg_no
       WHERE s.roll_no = ?
      `,
      [reg_no]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "No fee record found for this student" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Error fetching fee details:", err);
    res.status(500).json({ message: "Server error while fetching fee details" });
  }
});

//////////
//profile hub
//////////

// --------------------------------------
//  PROFILE HUB ROUTES (INLINE)
// --------------------------------------


// pool = your MySQL pool (already initialized above)

// ----------------------------
// Upload File → OneDrive
// ----------------------------
// app.post("/api/profile/upload", auth, upload.single("file"), async (req, res) => {
//   try {
//     if (!req.file)
//       return res.status(400).json({ message: "No file uploaded" });

//     // Mock mode when admin consent not given
//     if (!process.env.ONEDRIVE_ENABLED || process.env.ONEDRIVE_ENABLED === "false") {
//       return res.json({
//         mock: true,
//         message: "OneDrive upload disabled (mock mode)",
//         web_view_link: "https://example.com/test",
//         web_download_link: "https://example.com/test/download",
//         file_id: 0
//       });
//     }

//     const folderPath = process.env.ONEDRIVE_ROOT_FOLDER || "/ERP_Storage";

//     const result = await uploadToOneDrive(
//       req.file.buffer,
//       req.file.originalname,
//       folderPath
//     );

//     const [row] = await pool.query(
//       `INSERT INTO files 
//        (owner_user_id, owner_type, drive_item_id, web_view_link, web_download_link, file_name, mime_type, size_bytes)
//        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
//       [
//         req.user.id,
//         req.user.role.toLowerCase(),
//         result.id,
//         result.webUrl,
//         result.downloadUrl,
//         req.file.originalname,
//         req.file.mimetype,
//         req.file.size
//       ]
//     );

//     res.json({
//       success: true,
//       file_id: row.insertId,
//       web_view_link: result.webUrl,
//       web_download_link: result.downloadUrl
//     });

//   } catch (err) {
//     console.error("Upload error:", err);
//     res.status(500).json({ message: "Upload failed" });
//   }
// });


// ----------------------------
// Add profile hub item
// ----------------------------
// app.post("/api/profile/item", auth, async (req, res) => {
//   try {
//     const { type, title, description, date, extra, file_id } = req.body;

//     if (!type || !title)
//       return res.status(400).json({ message: "Type and title required" });

//     const [row] = await pool.query(
//       `INSERT INTO profile_items 
//         (owner_user_id, owner_type, type, title, description, event_date, extra, file_id)
//         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
//       [
//         req.user.id,
//         req.user.role.toLowerCase(),
//         type,
//         title,
//         description || null,
//         date || null,
//         extra ? JSON.stringify(extra) : null,
//         file_id || null
//       ]
//     );

//     res.json({ success: true, item_id: row.insertId });

//   } catch (err) {
//     console.error("Add item error:", err);
//     res.status(500).json({ message: "Server error" });
//   }
// });

// ----------------------------
// Get items of logged-in user
// ----------------------------
// GET /api/profile/items?scope=self|dept|all
// app.get("/api/profile/items", authenticateToken, async (req, res) => {
//   try {
//     const scope = req.query.scope || "self"; // 'self' default
//     const user = req.user; // has id, role, dept_id

//     // Principal -> can request all
//     // HOD -> can request dept (owner user's dept matches)
//     // Others -> only self

//     let sql = `
//       SELECT pi.*,
//              f.web_view_link AS file_view_link,
//              f.web_download_link AS file_download_link,
//              f.file_name,
//              u.name AS owner_name,
//              u.dept_id AS owner_dept_id
//       FROM profile_items pi
//       LEFT JOIN files f ON pi.file_id = f.file_id
//       LEFT JOIN users u ON pi.owner_user_id = u.user_id
//     `;
//     const params = [];

//     if (user.role === "Principal" && scope === "all") {
//       // no WHERE - return everything
//       sql += " ORDER BY pi.created_at DESC";
//     } else if (user.role === "HOD" && scope === "dept") {
//       sql += " WHERE u.dept_id = ? ORDER BY pi.created_at DESC";
//       params.push(user.dept_id);
//     } else {
//       // default: only own items
//       sql += " WHERE pi.owner_user_id = ? ORDER BY pi.created_at DESC";
//       params.push(user.id);
//     }

//     const [rows] = await pool.query(sql, params);

//     // parse extra JSON and normalize date field name
//     const items = rows.map((r) => ({
//       id: r.id,
//       owner_user_id: r.owner_user_id,
//       owner_type: r.owner_type,
//       owner_name: r.owner_name,
//       owner_dept_id: r.owner_dept_id,
//       type: r.type,
//       title: r.title,
//       description: r.description,
//       event_date: r.event_date,
//       extra: r.extra ? JSON.parse(r.extra) : null,
//       file_id: r.file_id,
//       file_view_link: r.file_view_link,
//       file_download_link: r.file_download_link,
//       file_name: r.file_name,
//       created_at: r.created_at,
//     }));

//     res.json(items);
//   } catch (err) {
//     console.error("Fetch items error:", err);
//     res.status(500).json({ message: "Server error" });
//   }
// });

app.post("/api/assistant", authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const { message } = req.body;

    if (!message || message.trim() === "") {
      return res.status(400).json({ message: "Message cannot be empty" });
    }

    // FETCH LAST 20 MESSAGES
    const [history] = await db.query(
      "SELECT role, message FROM assistant_chat WHERE user_id = ? ORDER BY id ASC LIMIT 20",
      [user.id]
    );

    // Convert history to Groq format
    const pastMessages = history.map(msg => ({
      role: msg.role,
      content: msg.message
    }));

    // Your static system message
    const systemMessage = {
      role: "system",
      content: `You are a friendly MNMJEC ERP assistant...`
    };

    // Build finalPrompt (as you already wrote)
    const finalPrompt = `User info... User says: "${message}"`;

    // Build final messages array
    const messages = [
      systemMessage,
      ...pastMessages,
      { role: "user", content: finalPrompt }
    ];

    // CALL GROQ
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages,
      max_tokens: 300,
      temperature: 0.6
    });

    const reply = completion.choices[0]?.message?.content || "No response";

    // SAVE USER MESSAGE + BOT RESPONSE
    await db.query(
      "INSERT INTO assistant_chat (user_id, role, message) VALUES (?, ?, ?)",
      [user.id, "user", message]
    );
    await db.query(
      "INSERT INTO assistant_chat (user_id, role, message) VALUES (?, ?, ?)",
      [user.id, "assistant", reply]
    );

    return res.json({ reply });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "AI request failed" });
  }
});





////////////////

app.get('/api/mess/auto-count', authenticateToken, authorize(['Principal', 'HOD', 'MessAdmin']), async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];

    const [rows] = await pool.query(`
      SELECT 
        s.mess_type,
        COUNT(*) AS count
      FROM attendance a
      INNER JOIN students s ON a.roll_no = s.roll_no
      WHERE a.date = ? AND a.status = 'Present'
      GROUP BY s.mess_type
    `, [today]);

    let jain_present = 0;
    let non_jain_present = 0;

    rows.forEach(r => {
      if (r.mess_type === 'jain') jain_present = r.count;
      if (r.mess_type === 'non_jain') non_jain_present = r.count;
    });

    res.json({
      success: true,
      date: today,
      jain_present,
      non_jain_present,
      total: jain_present + non_jain_present
    });

  } catch (err) {
    console.error("Error fetching mess auto count:", err);
    res.status(500).json({
      success: false,
      message: "Server error while calculating plate counts"
    });
  }
});

app.post(
  '/api/mess/save',
  authenticateToken,
  authorize(['Principal', 'HOD', 'MessAdmin']),
  async (req, res) => {
    const { date, jain_count, non_jain_count } = req.body;
    const created_by = req.user.name;

    try {
      await pool.query(`
        INSERT INTO mess_count (date, jain_count, non_jain_count, created_by)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
          jain_count = VALUES(jain_count),
          non_jain_count = VALUES(non_jain_count),
          created_by = VALUES(created_by)
      `, [date, jain_count, non_jain_count, created_by]);

      res.json({
        success: true,
        message: "Mess count saved successfully"
      });

    } catch (err) {
      console.error("Error saving mess count:", err);
      res.status(500).json({
        success: false,
        message: "Server error while saving mess count"
      });
    }
  }
);



app.post('/api/mess/payment', authenticateToken, authorize(['Principal', 'HOD', 'MessAdmin']), async (req, res) => {
  try {
    const { from_date, to_date, total_plates, price_per_plate } = req.body;
    const paid_by = req.user.name;

    const total_amount = total_plates * price_per_plate;

    await pool.query(`
      INSERT INTO mess_payments(from_date, to_date, total_plates, price_per_plate, total_amount, paid_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [from_date, to_date, total_plates, price_per_plate, total_amount, paid_by]);

    res.json({ success: true, message: "Payment recorded successfully" });

  } catch (err) {
    console.error("Payment save error:", err);
    res.status(500).json({ success: false, message: "Payment save failed" });
  }
});


app.get('/api/mess/payment/history', authenticateToken, authorize(['Principal', 'HOD', 'MessAdmin']), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        id,
        DATE_FORMAT(from_date,'%Y-%m-%d') AS from_date,
        DATE_FORMAT(to_date,'%Y-%m-%d') AS to_date,
        total_plates,
        price_per_plate,
        total_amount,
        paid_by,
        paid_on
      FROM mess_payments
      ORDER BY paid_on DESC
    `);

    res.json({ success: true, records: rows });

  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to load payment history" });
  }
});


app.get('/api/mess/payment/next-start', authenticateToken, authorize(['Principal', 'HOD', 'MessAdmin']), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT to_date FROM mess_payments ORDER BY to_date DESC LIMIT 1
    `);

    if (!rows.length) {
      return res.json({
        success: true,
        next_start: null // means college started fresh
      });
    }

    const lastPaid = new Date(rows[0].to_date);
    lastPaid.setDate(lastPaid.getDate() + 1);

    const next_start = lastPaid.toISOString().split("T")[0];

    res.json({ success: true, next_start });

  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to load next start date" });
  }
});



app.get('/api/mess/history', authenticateToken, authorize(['Principal', 'HOD', 'MessAdmin']), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        id,
        DATE_FORMAT(date, '%Y-%m-%d') AS date,
        jain_count,
        non_jain_count,
        (jain_count + non_jain_count) AS total,
        created_by,
        created_at
      FROM mess_count
      ORDER BY date DESC
    `);

    res.json({
      success: true,
      records: rows
    });

  } catch (err) {
    console.error("Error fetching mess history:", err);
    res.status(500).json({
      success: false,
      message: "Server error while fetching history"
    });
  }
});


app.get('/api/mess/range', authenticateToken, authorize(['Principal', 'HOD', 'MessAdmin']), async (req, res) => {
  const { from, to } = req.query;

  if (!from || !to) {
    return res.status(400).json({
      success: false,
      message: "From and To dates are required"
    });
  }

  try {
    const [rows] = await pool.query(`
      SELECT 
        SUM(jain_count) AS jain_total,
        SUM(non_jain_count) AS non_jain_total,
        SUM(jain_count + non_jain_count) AS total_plates
      FROM mess_count
      WHERE date BETWEEN ? AND ?
    `, [from, to]);

    res.json({
      success: true,
      from,
      to,
      jain_total: rows[0].jain_total || 0,
      non_jain_total: rows[0].non_jain_total || 0,
      total_plates: rows[0].total_plates || 0
    });

  } catch (err) {
    console.error("Error calculating mess range:", err);
    res.status(500).json({
      success: false,
      message: "Server error while calculating mess count"
    });
  }
});




// ----------------------------
// Delete item
// ----------------------------
// app.delete("/api/profile/item/:id", auth, async (req, res) => {
//   try {
//     const { id } = req.params;

//     await pool.query(
//       `DELETE FROM profile_items 
//        WHERE id = ? AND owner_user_id = ?`,
//       [id, req.user.id]
//     );

//     res.json({ success: true });

//   } catch (err) {
//     console.error("Delete error:", err);
//     res.status(500).json({ message: "Server error" });
//   }
// });
////////////////////placement////////////


app.get(
  "/api/placement-training/student/courses",
  authenticateToken,
  authorize(["student"]),
  async (req, res) => {
    try {
      const rollNo = req.user.roll_no;

      const [[student]] = await pool.query(
        "SELECT student_id, dept_id, class_id FROM students WHERE roll_no = ?",
        [rollNo]
      );

      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }

      const [rows] = await pool.query(
        `SELECT DISTINCT
  tc.course_id,
  tc.name,
  tc.description,
  tc.status
FROM training_courses tc
JOIN training_course_assignments ca
  ON ca.course_id = tc.course_id
WHERE
  ca.dept_id = ?
  AND ca.class_id = ?
ORDER BY tc.course_id DESC

        `,
        [student.dept_id, student.class_id]
      );

      res.json({
        success: true,
        courses: rows
      });

    } catch (err) {
      console.error("Student courses error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

app.get(
  "/api/placement-training/courses/:courseId/tests",
  authenticateToken,
  authorize(["Staff", "CA", "HOD", "trainer", "Principal"]),
  async (req, res) => {
    try {
      const { courseId } = req.params;

      const [rows] = await pool.query(
        `
        SELECT
          test_id,
          title,
          duration_minutes,
          total_marks,
          pass_mark,
          max_attempts,
          publish_start,
          publish_end,
          published,
          created_at
        FROM tests
        WHERE course_id = ?
        ORDER BY created_at DESC
        `,
        [courseId]
      );

      res.json({ success: true, tests: rows });

    } catch (err) {
      console.error("Fetch tests error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

app.patch(
  "/api/placement-training/questions/:questionId",
  authenticateToken,
  authorize(["Staff", "CA", "trainer", "HOD", "Principal"]),
  async (req, res) => {
    try {
      const { questionId } = req.params;

      const [[check]] = await pool.query(
        `
  SELECT t.published
  FROM tests t
  JOIN questions q ON q.test_id = t.test_id
  WHERE q.question_id = ?
  `,
        [questionId]
      );

      if (check?.published === 1) {
        return res.status(400).json({
          message: "Cannot edit questions after test is published"
        });
      }

      const {
        question,
        option_a,
        option_b,
        option_c,
        option_d,
        correct_option,
        marks
      } = req.body;

      await pool.query(
        `
        UPDATE questions
        SET
          question = ?,
          option_a = ?,
          option_b = ?,
          option_c = ?,
          option_d = ?,
          correct_option = ?,
          marks = ?
        WHERE question_id = ?
        `,
        [
          question,
          option_a,
          option_b,
          option_c,
          option_d,
          correct_option,
          marks,
          questionId
        ]
      );

      res.json({ success: true });

    } catch (err) {
      console.error("Update question error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);







app.get(
  "/api/placement-training/tests/:testId/questions",
  authenticateToken,
  authorize(["Staff", "CA", "trainer", "HOD", "Principal"]),
  async (req, res) => {
    try {
      const { testId } = req.params;

      const [rows] = await pool.query(
        `
        SELECT
          question_id,
          question,
          option_a,
          option_b,
          option_c,
          option_d,
          correct_option,
          marks
        FROM questions
        WHERE test_id = ?
        ORDER BY question_id
        `,
        [testId]
      );

      res.json({
        success: true,
        questions: rows
      });

    } catch (err) {
      console.error("Fetch questions error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);


app.post(
  "/api/placement-training/student/tests/:testId/start",
  authenticateToken,
  authorize(["student"]),
  async (req, res) => {
    try {
      const { testId } = req.params;
      const rollNo = req.user.roll_no;

      const [[student]] = await pool.query(
        "SELECT student_id, dept_id, class_id FROM students WHERE roll_no = ?",
        [rollNo]
      );


      const [[test]] = await pool.query(
        `
  SELECT t.max_attempts, t.duration_minutes
  FROM tests t
  JOIN training_courses tc ON t.course_id = tc.course_id
  JOIN training_course_assignments tca
    ON tca.course_id = tc.course_id
  WHERE
    t.test_id = ?
    AND t.published = 1
    AND NOW() BETWEEN t.publish_start AND t.publish_end
    AND tca.dept_id = ?
    AND tca.class_id = ?
  `,
        [testId, student.dept_id, student.class_id]
      );


      if (!test) {
        return res.status(404).json({ message: "Test not available" });
      }

      const [[attemptCount]] = await pool.query(
        `
        SELECT COUNT(*) AS total
        FROM test_attempts
        WHERE test_id = ? AND student_id = ?
        `,
        [testId, student.student_id]
      );

      if (attemptCount.total >= test.max_attempts) {
        return res.status(400).json({ message: "Max attempts reached" });
      }

      const [result] = await pool.query(
        `
        INSERT INTO test_attempts
          (test_id, student_id, attempt_no, started_at)
        VALUES (?, ?, ?, NOW())
        `,
        [testId, student.student_id, attemptCount.total + 1]
      );

      // Fetch questions (send without correct answers)
      const [questions] = await pool.query(
        `
        SELECT 
          question_id,
          question,
          option_a,
          option_b,
          option_c,
          option_d,
          marks
        FROM questions
        WHERE test_id = ?
        `,
        [testId]
      );

      res.json({
        success: true,
        test,
        attempt_id: result.insertId,
        questions
      });

    } catch (err) {
      console.error("Start test error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);


app.post(
  "/api/placement-training/student/tests/:testId/submit",
  authenticateToken,
  authorize(["student"]),
  async (req, res) => {
    const { testId } = req.params;
    const { attempt_id, answers } = req.body;

    if (!attempt_id || !Array.isArray(answers)) {
      return res.status(400).json({ message: "Invalid payload" });
    }

    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();

      let totalScore = 0;

      for (const ans of answers) {
        const { question_id, selected_option } = ans;

        const [[q]] = await conn.query(
          `
          SELECT correct_option, marks
          FROM questions
          WHERE question_id = ? AND test_id = ?
          `,
          [question_id, testId]
        );

        if (!q) continue;

        const isCorrect = q.correct_option === selected_option;
        if (isCorrect) totalScore += q.marks;

        await conn.query(
          `
          INSERT INTO student_answers
            (attempt_id, question_id, selected_option, is_correct)
          VALUES (?, ?, ?, ?)
          `,
          [attempt_id, question_id, selected_option, isCorrect ? 1 : 0]
        );
      }

      const [[test]] = await conn.query(
        "SELECT pass_mark, total_marks FROM tests WHERE test_id = ?",
        [testId]
      );

      const percentage = (totalScore / test.total_marks) * 100;
      const passStatus = totalScore >= test.pass_mark ? "pass" : "fail";

      await conn.query(
        `
        UPDATE test_attempts
        SET score = ?, percentage = ?, pass_status = ?, submitted_at = NOW(),status = 'SUBMITTED'
        WHERE attempt_id = ?
        `,
        [totalScore, percentage, passStatus, attempt_id]
      );

      await conn.commit();

      res.json({
        success: true,
        score: totalScore,
        percentage,
        pass_status: passStatus
      });

    } catch (err) {
      if (conn) await conn.rollback();
      console.error("Submit test error:", err);
      res.status(500).json({ message: "Server error" });
    } finally {
      if (conn) conn.release();
    }
  }
);

app.get(
  "/api/placement-training/analytics",
  authenticateToken,
  async (req, res) => {
    try {
      const { role, assigned_class_id, dept_id, user_id } = req.user;

      let filter = "WHERE a.status = 'SUBMITTED'";
      const params = [];

      if (role === "trainer") {
        filter += " AND c.trainer_id = ?";
        params.push(user_id);
      }

      else if (role === "CA") {
        filter += " AND s.class_id = ?";
        params.push(assigned_class_id);
      }

      else if (role === "HOD") {
        filter += " AND s.dept_id = ?";
        params.push(dept_id);
      }

      // ---------------- SUMMARY ----------------
      const [[summary]] = await pool.query(
        `
        SELECT
          COUNT(DISTINCT s.student_id) AS total_students,
          COUNT(DISTINCT t.test_id)    AS total_tests,
          COUNT(a.attempt_id)          AS total_attempts,
          ROUND(
            SUM(a.pass_status = 'pass') / COUNT(a.attempt_id) * 100,
            2
          ) AS pass_percentage
        FROM test_attempts a
        JOIN tests t ON t.test_id = a.test_id
        JOIN training_courses c ON c.course_id = t.course_id
        JOIN students s ON s.student_id = a.student_id
        ${filter}
        `,
        params
      );

      // ---------------- TEST WISE ----------------
      const [testWise] = await pool.query(
        `
        SELECT
          t.test_id,
          t.title,
          COUNT(a.attempt_id) AS attempts,
          ROUND(
            SUM(a.pass_status = 'pass') / COUNT(a.attempt_id) * 100,
            2
          ) AS pass_percentage
        FROM test_attempts a
        JOIN tests t ON t.test_id = a.test_id
        JOIN training_courses c ON c.course_id = t.course_id
        JOIN students s ON s.student_id = a.student_id
        ${filter}
        GROUP BY t.test_id
        ORDER BY attempts DESC
        `,
        params
      );

      // ---------------- DEPT WISE ----------------
      const [deptWise] = await pool.query(
        `
        SELECT
          s.dept_id,
          COUNT(a.attempt_id) AS attempts,
          ROUND(
            SUM(a.pass_status = 'pass') / COUNT(a.attempt_id) * 100,
            2
          ) AS pass_percentage
        FROM test_attempts a
        JOIN students s ON s.student_id = a.student_id
        ${filter}
        GROUP BY s.dept_id
        `,
        params
      );

      res.json({
        summary,
        test_wise: testWise,
        dept_wise: deptWise
      });

    } catch (err) {
      console.error("Analytics API error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

app.get(
  "/api/placement-training/results",
  authenticateToken,
  async (req, res) => {
    try {

      const { role, assigned_class_id, id } = req.user;

      let email = null;
      let studentId = null;
      let classId = null;
      let deptId = null;

      if (role === "student" ) {

        const [userRows] = await pool.query(
          `
          SELECT email
          FROM users
          WHERE user_id = ?
          `,
          [id]
        );


        if (userRows.length === 0) {
          console.log("❌ No user found for user_id:", id);
          return res.status(404).json({ message: "User not found" });
        }

        email = userRows[0].email;
      }


      if (role === "student" ) {

        const [studentRows] = await pool.query(
          `
          SELECT student_id, class_id, dept_id
          FROM students
          WHERE email = ?
          `,
          [email]
        );


        if (studentRows.length === 0) {
          return res
            .status(404)
            .json({ message: "Student record not found" });
        }

        studentId = studentRows[0].student_id;
        classId = studentRows[0].class_id;
        deptId = studentRows[0].dept_id;
      }

      let where = "WHERE a.status = 'SUBMITTED'";
      const params = [];

      if (role === "student") {
        where += " AND a.student_id = ?";
        params.push(studentId);
      }

      else if (role === "trainer") {
      }

      else if (role === "CA") {
        where += " AND s.class_id = ?";
        params.push(assigned_class_id);
      }

      else if (role === "HOD") {
        where += " AND s.dept_id = ?";
        params.push(deptId);
      }


      const finalQuery = `
        SELECT
          c.name AS course_name,
          t.title AS test_title,
          s.name AS student_name,
          s.roll_no,
          a.attempt_no,
          a.score,
          a.percentage,
          a.pass_status,
          a.submitted_at
        FROM test_attempts a
        JOIN tests t ON t.test_id = a.test_id
        JOIN training_courses c ON c.course_id = t.course_id
        JOIN students s ON s.student_id = a.student_id
        ${where}
        ORDER BY a.submitted_at DESC
      `;


      const [results] = await pool.query(finalQuery, params);



      res.json({ results });

    } catch (err) {
      res.status(500).json({ message: "Server error" });
    }
  }
);


app.get(
  "/api/placement-training/student/results",
  authenticateToken,
  authorize(["student"]),
  async (req, res) => {
    try {
      const rollNo = req.user.roll_no;

      const [[student]] = await pool.query(
        "SELECT student_id, dept_id, class_id FROM students WHERE roll_no = ?",
        [rollNo]
      );


      const [rows] = await pool.query(
        `
        SELECT 
          tc.name AS course_name,
          t.title AS test_title,
          ta.attempt_no,
          ta.score,
          ta.percentage,
          ta.pass_status,
          ta.submitted_at
        FROM test_attempts ta
        JOIN tests t ON ta.test_id = t.test_id
        JOIN training_courses tc ON t.course_id = tc.course_id
        WHERE ta.student_id = ?
        ORDER BY ta.submitted_at DESC
        `,
        [student.student_id]
      );

      res.json({
        success: true,
        results: rows
      });

    } catch (err) {
      console.error("Student results error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);


// ===== Placement Training – Trainer =====

app.post(
  "/api/placement-training/courses",
  authenticateToken,
  authorize(["Staff", "CA", "trainer", "HOD", "Principal"]),
  async (req, res) => {
    try {
      const { name, description, status } = req.body;

      if (!name) {
        return res.status(400).json({ message: "Course name required" });
      }

      const [result] = await pool.query(
        `
      INSERT INTO training_courses
  (name, description, trainer_id, status)
VALUES (?, ?, ?, ?)

        `,
        [
          name,
          description || null,
          req.user.id,
          status || "UPCOMING"
        ]
      );

      res.json({
        success: true,
        course_id: result.insertId
      });

    } catch (err) {
      console.error("Create course error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);



app.get(
  "/api/placement-training/courses",
  authenticateToken,
  authorize(["Staff", "CA", "trainer", "HOD", "Principal"]),
  async (req, res) => {
    try {
      const [rows] = await pool.query(
        `
        SELECT 
          course_id,
          name,
          description,          
          status
        FROM training_courses
        WHERE trainer_id = ?
        ORDER BY course_id DESC
        `,
        [req.user.id]
      );

      res.json({ success: true, courses: rows });

    } catch (err) {
      console.error("Fetch courses error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);



app.post(
  "/api/placement-training/tests",
  authenticateToken,
  authorize(["Staff", "CA", "trainer", "HOD", "Principal"]),
  async (req, res) => {
    try {
      const {
        course_id,
        title,
        duration_minutes,
        total_marks,
        pass_mark,
        max_attempts
      } = req.body;

      if (!course_id || !title || !duration_minutes) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      const [result] = await pool.query(
        `
        INSERT INTO tests
          (course_id, title, duration_minutes, total_marks, pass_mark, max_attempts)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          course_id,
          title,
          duration_minutes,
          total_marks || 100,
          pass_mark || 40,
          max_attempts || 1
        ]
      );

      res.json({
        success: true,
        test_id: result.insertId
      });

    } catch (err) {
      console.error("Create test error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);



app.post(
  "/api/placement-training/tests/:testId/questions",
  authenticateToken,
  authorize(["Staff", "CA", "HOD", "trainer", "Principal"]),
  async (req, res) => {
    try {
      const { testId } = req.params;
      const { questions } = req.body;

      if (!Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ message: "Questions required" });
      }

      for (const q of questions) {
        await pool.query(
          `
          INSERT INTO questions
            (test_id, question, option_a, option_b, option_c, option_d, correct_option, marks)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            testId,
            q.question,
            q.option_a,
            q.option_b,
            q.option_c,
            q.option_d,
            q.correct_option,
            q.marks || 1
          ]
        );
      }

      res.json({
        success: true,
        added: questions.length
      });

    } catch (err) {
      console.error("Add questions error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

app.post(
  "/api/placement-training/tests/:testId/assign",
  authenticateToken,
  authorize(["trainer"]),
  async (req, res) => {
    try {
      const { testId } = req.params;
      const { assignments, publish_start, publish_end, published } = req.body;

      if (!assignments || assignments.length === 0) {
        return res.status(400).json({ message: "Assignments required" });
      }

      if (!publish_start || !publish_end) {
        return res.status(400).json({
          message: "publish_start and publish_end are required"
        });
      }

      // 1️⃣ Clear existing assignments
      await pool.query(
        `DELETE FROM training_test_assignments WHERE test_id = ?`,
        [testId]
      );

      // 2️⃣ Insert new assignments
      const values = assignments.map(a => [
        testId,
        a.dept_id,
        a.class_id
      ]);

      await pool.query(
        `
        INSERT INTO training_test_assignments
        (test_id, dept_id, class_id)
        VALUES ?
        `,
        [values]
      );

      // ✅ 3️⃣ SAVE PUBLISH WINDOW INTO tests TABLE (THIS WAS MISSING)
      await pool.query(
        `
        UPDATE tests
        SET publish_start = ?, publish_end = ? , published = ?
        WHERE test_id = ?
        `,
        [publish_start, publish_end, published, testId]
      );

      res.json({
        success: true,
        message: "Test assigned successfully"
      });

    } catch (err) {
      console.error("Assign test error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);


app.patch(
  "/api/placement-training/courses/:courseId",
  authenticateToken,
  authorize(["trainer", "HOD", "Principal"]),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const { name, description } = req.body;

      if (!name) {
        return res.status(400).json({ message: "Course name required" });
      }

      await pool.query(
        `
        UPDATE training_courses
        SET name = ?, description = ?
        WHERE course_id = ?
        `,
        [name, description || null, courseId]
      );

      res.json({ success: true });
    } catch (err) {
      console.error("Update course error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);


app.delete(
  "/api/placement-training/courses/:courseId",
  authenticateToken,
  authorize(["trainer", "HOD", "Principal"]),
  async (req, res) => {
    try {
      const { courseId } = req.params;

      // order matters
      await pool.query(`DELETE FROM training_test_assignments WHERE test_id IN (
        SELECT test_id FROM tests WHERE course_id = ?
      )`, [courseId]);

      await pool.query(`DELETE FROM test_attempts WHERE test_id IN (
        SELECT test_id FROM tests WHERE course_id = ?
      )`, [courseId]);

      await pool.query(`DELETE FROM questions WHERE test_id IN (
        SELECT test_id FROM tests WHERE course_id = ?
      )`, [courseId]);

      await pool.query(`DELETE FROM tests WHERE course_id = ?`, [courseId]);
      await pool.query(`DELETE FROM training_course_assignments WHERE course_id = ?`, [courseId]);
      await pool.query(`DELETE FROM training_courses WHERE course_id = ?`, [courseId]);

      res.json({ success: true });
    } catch (err) {
      console.error("Delete course error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);


app.delete(
  "/api/placement-training/tests/:testId",
  authenticateToken,
  authorize(["trainer", "HOD", "Principal"]),
  async (req, res) => {
    try {
      const { testId } = req.params;

      // Order matters
      await pool.query(`DELETE FROM test_attempts WHERE test_id = ?`, [testId]);
      await pool.query(`DELETE FROM training_test_assignments WHERE test_id = ?`, [testId]);
      await pool.query(`DELETE FROM questions WHERE test_id = ?`, [testId]);
      await pool.query(`DELETE FROM tests WHERE test_id = ?`, [testId]);

      res.json({ success: true });
    } catch (err) {
      console.error("Delete test error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);


app.patch(
  "/api/placement-training/tests/:testId/details",
  authenticateToken,
  authorize(["trainer", "HOD", "Principal"]),
  async (req, res) => {
    try {
      const { testId } = req.params;
      const {
        title,
        duration_minutes,
        total_marks,
        pass_mark,
        max_attempts
      } = req.body;

      if (!title || !duration_minutes) {
        return res.status(400).json({ message: "Invalid data" });
      }

      await pool.query(
        `
        UPDATE tests
        SET title = ?, duration_minutes = ?, total_marks = ?, pass_mark = ?, max_attempts = ?
        WHERE test_id = ?
        `,
        [title, duration_minutes, total_marks, pass_mark, max_attempts, testId]
      );

      res.json({ success: true });
    } catch (err) {
      console.error("Update test error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);



app.get(
  "/api/placement-training/courses/:courseId/assignments",
  authenticateToken,
  authorize(["trainer", "HOD", "Principal"]),
  async (req, res) => {
    try {
      const { courseId } = req.params;

      const [rows] = await pool.query(
        `
        SELECT dept_id, class_id
        FROM training_course_assignments
        WHERE course_id = ?
        ORDER BY dept_id, class_id
        `,
        [courseId]
      );

      res.json({ assignments: rows });
    } catch (err) {
      console.error("Get course assignments error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);



app.patch(
  "/api/placement-training/tests/:testId",
  authenticateToken,
  authorize(["trainer", "HOD", "Principal"]),
  async (req, res) => {
    try {
      const { testId } = req.params;
      const { published, publish_start, publish_end } = req.body;

      const fields = [];
      const values = [];

      // published flag
      if (published !== undefined) {
        fields.push("published = ?");
        values.push(published);
      }

      // publish_start (DO NOT reformat or reparse)
      if (publish_start !== undefined) {
        fields.push("publish_start = ?");
        values.push(publish_start);
      }

      // publish_end (DO NOT reformat or reparse)
      if (publish_end !== undefined) {
        fields.push("publish_end = ?");
        values.push(publish_end);
      }

      if (!fields.length) {
        return res.status(400).json({ message: "No fields to update" });
      }

      values.push(testId);

      const [result] = await pool.query(
        `UPDATE tests SET ${fields.join(", ")} WHERE test_id = ?`,
        values
      );

      // IMPORTANT: check if update really happened
      if (result.affectedRows === 0) {
        return res
          .status(404)
          .json({ message: "Test not found or no changes applied" });
      }

      res.json({ success: true });
    } catch (err) {
      console.error("PATCH TEST ERROR:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);




app.get(
  "/api/placement-training/tests/:testId/assignments",
  authenticateToken,
  authorize(["trainer", "HOD", "Principal"]),
  async (req, res) => {
    try {
      const { testId } = req.params;

      const [rows] = await pool.query(
        `
        SELECT dept_id, class_id
        FROM training_test_assignments
        WHERE test_id = ?
        ORDER BY dept_id, class_id
        `,
        [testId]
      );

      res.json({ assignments: rows });
    } catch (err) {
      console.error("Get test assignments error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

app.patch(
  "/api/placement-training/tests/:testId/publish",
  authenticateToken,
  authorize(["trainer", "HOD", "Principal"]),
  async (req, res) => {
    const { testId } = req.params;

    // check assignment exists
    const [[assign]] = await pool.query(
      `SELECT COUNT(*) cnt FROM training_test_assignments WHERE test_id = ?`,
      [testId]
    );

    if (assign.cnt === 0) {
      return res.status(400).json({
        message: "Assign test before publishing"
      });
    }

    await pool.query(
      `
      UPDATE tests
      SET published = IF(published = 1, 0, 1)
      WHERE test_id = ?
      `,
      [testId]
    );

    res.json({ success: true });
  }
);



app.get(
  "/api/placement-training/tests/:testId/results",
  authenticateToken,
  authorize(["Staff", "CA", "HOD", "trainer", "Principal"]),
  async (req, res) => {
    try {
      const { testId } = req.params;

      const [rows] = await pool.query(
        `
        SELECT 
          s.roll_no,
          s.name,
          ta.attempt_no,
          ta.score,
          ta.percentage,
          ta.pass_status,
          ta.submitted_at
        FROM test_attempts ta
        JOIN students s ON ta.student_id = s.student_id
        WHERE ta.test_id = ?
        ORDER BY ta.submitted_at DESC
        `,
        [testId]
      );

      res.json({
        success: true,
        results: rows
      });

    } catch (err) {
      console.error("Fetch test results error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);


app.get(
  "/api/placement-training/courses/:courseId/analytics",
  authenticateToken,
  authorize(["Staff", "CA", "HOD", "trainer", "Principal"]),
  async (req, res) => {
    try {
      const { courseId } = req.params;

      const [[stats]] = await pool.query(
        `
                SELECT
          COUNT(DISTINCT s.student_id) AS eligible_students,
          COUNT(DISTINCT ta.student_id) AS attempted,
          SUM(ta.pass_status = 'pass') AS passed,
          SUM(ta.pass_status = 'fail') AS failed,
          ROUND(AVG(ta.percentage), 2) AS avg_percentage
        FROM training_course_assignments ca
        JOIN students s
          ON s.dept_id = ca.dept_id
        AND s.class_id = ca.class_id
        LEFT JOIN tests t
          ON t.course_id = ca.course_id
        LEFT JOIN test_attempts ta
          ON ta.test_id = t.test_id
        WHERE ca.course_id = ?

        `,
        [courseId]
      );

      res.json({
        success: true,
        analytics: stats
      });

    } catch (err) {
      console.error("Course analytics error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

app.post(
  "/api/placement-training/courses/:courseId/assign",
  authenticateToken,
  authorize(["trainer", "HOD", "Principal"]),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const { assignments } = req.body;

      if (!Array.isArray(assignments)) {
        return res.status(400).json({ message: "Invalid assignments data" });
      }

      // 1️⃣ Remove all existing assignments for this course
      await pool.query(
        `DELETE FROM training_course_assignments WHERE course_id = ?`,
        [courseId]
      );

      // 2️⃣ Insert new assignments (if any)
      if (assignments.length > 0) {
        const values = assignments.map(a => [
          courseId,
          a.dept_id,
          a.class_id
        ]);

        await pool.query(
          `
          INSERT INTO training_course_assignments
            (course_id, dept_id, class_id)
          VALUES ?
          `,
          [values]
        );
      }

      res.json({
        success: true,
        assigned_count: assignments.length
      });
    } catch (err) {
      console.error("Assign course error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);



app.get(
  "/api/placement-training/courses/:courseId/assignments",
  authenticateToken,
  authorize(["trainer", "HOD", "CA", "Principal"]),
  async (req, res) => {
    try {
      const { courseId } = req.params;

      const [rows] = await pool.query(
        `
        SELECT
          id,
          dept_id,
          class_id
        FROM training_course_assignments
        WHERE course_id = ?
        ORDER BY dept_id, class_id
        `,
        [courseId]
      );

      res.json({ success: true, assignments: rows });
    } catch (err) {
      console.error("Fetch course assignments error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);


app.delete(
  "/api/placement-training/course-assignments/:id",
  authenticateToken,
  authorize(["trainer", "HOD", "Principal"]),
  async (req, res) => {
    try {
      const { id } = req.params;

      await pool.query(
        `
        DELETE FROM training_course_assignments
        WHERE id = ?
        `,
        [id]
      );

      res.json({ success: true });
    } catch (err) {
      console.error("Delete course assignment error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);


app.put(
  "/api/placement-training/courses/:courseId/assignments",
  authenticateToken,
  authorize(["trainer", "HOD", "Principal"]),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const { assignments } = req.body;

      if (!Array.isArray(assignments)) {
        return res.status(400).json({ message: "Assignments array required" });
      }

      await pool.query(
        `DELETE FROM training_course_assignments WHERE course_id = ?`,
        [courseId]
      );

      for (const a of assignments) {
        await pool.query(
          `
          INSERT INTO training_course_assignments
            (course_id, dept_id, class_id)
          VALUES (?, ?, ?)
          `,
          [courseId, a.dept_id, a.class_id]
        );
      }

      res.json({ success: true });
    } catch (err) {
      console.error("Replace assignments error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);


const isStudentEligibleForCourse = async (student, courseId) => {
  const [[row]] = await pool.query(
    `
    SELECT 1
    FROM training_course_assignments
    WHERE course_id = ?
      AND dept_id = ?
      AND class_id = ?
    `,
    [courseId, student.dept_id, student.class_id]
  );
  return !!row;
};


app.get(
  "/api/placement-training/student/courses/:courseId/tests",
  authenticateToken,
  authorize(["student"]),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const rollNo = req.user.roll_no;

      const [[student]] = await pool.query(
        "SELECT dept_id, class_id FROM students WHERE roll_no = ?",
        [rollNo]
      );

      if (!student) {
        return res.status(404).json({ message: "Student not found" });
      }

      const [tests] = await pool.query(
        `
  SELECT
    t.test_id,
    t.title,
    t.course_id,
    t.duration_minutes,
    t.publish_start,
    t.publish_end,
    t.total_marks,
    t.pass_mark,
    t.max_attempts
  FROM tests t
  JOIN training_test_assignments tta
    ON tta.test_id = t.test_id
  WHERE
    t.course_id = ?
    AND tta.dept_id = ?
    AND tta.class_id = ?
    AND t.published = 1
    AND NOW() BETWEEN t.publish_start AND t.publish_end
  ORDER BY t.publish_start ASC;
  `,
        [courseId, student.dept_id, student.class_id]
      );


      res.json({ success: true, tests });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);



app.patch(
  "/api/placement-training/tests/:testId/publish-window",
  authenticateToken,
  authorize(["trainer", "HOD", "Principal"]),
  async (req, res) => {
    const { testId } = req.params;
    const publish_start = null;
    const publish_end = null;

    await pool.query(
      `
      UPDATE tests
      SET publish_start = ?, publish_end = ?
      WHERE test_id = ?
      `,
      [publish_start, publish_end, testId]
    );

    res.json({ success: true });
  }
);

app.get(
  "/api/placement-training/tests/:testId/attempts",
  authenticateToken,
  authorize(["trainer", "HOD", "student", "CA", "Principal"]),
  async (req, res) => {
    try {
      const { testId } = req.params;

      const [rows] = await pool.query(
        `
        SELECT
          s.student_id,
          s.roll_no,
          s.name,
          COUNT(ta.attempt_id) AS total_attempts,
          MAX(ta.attempt_no)   AS latest_attempt,
          MAX(ta.submitted_at) AS last_submitted_at
        FROM test_attempts ta
        JOIN students s ON s.student_id = ta.student_id
        WHERE ta.test_id = ?
        GROUP BY s.student_id
        ORDER BY total_attempts DESC
        `,
        [testId]
      );

      res.json({
        success: true,
        students: rows,
        total_students_attempted: rows.length
      });

    } catch (err) {
      console.error("Fetch test attempts error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);


app.get(
  "/api/placement-training/student/tests/:testId/status",
  authenticateToken,
  authorize(["student"]),
  async (req, res) => {
    try {
      const { testId } = req.params;
      const rollNo = req.user.roll_no;

      const [[student]] = await pool.query(
        "SELECT dept_id, class_id FROM students WHERE roll_no = ?",
        [rollNo]
      );

      if (!student) {
        return res.status(404).json({ is_live: false });
      }

      const [[test]] = await pool.query(
        `
        SELECT 1
        FROM tests t
        JOIN training_test_assignments ta
          ON ta.test_id = t.test_id
        WHERE
          t.test_id = ?
          AND t.published = 1
          AND NOW() BETWEEN t.publish_start AND t.publish_end
          AND ta.dept_id = ?
          AND ta.class_id = ?
        `,
        [testId, student.dept_id, student.class_id]
      );

      res.json({
        is_live: !!test
      });

    } catch (err) {
      console.error("Test status check error:", err);
      res.status(500).json({ is_live: false });
    }
  }
);


// =======================
// Server Start
// =======================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`ERP backend running on port ${PORT}`);
});
