const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const { markAttendance, getAttendance } = require('../controllers/attendanceController'); 

router.get('/api/attendance/class/:classId', authenticateToken, async (req, res) => {
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


router.get('/api/attendance/subject/:subjectId', authenticateToken, async (req, res) => {
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
router.post("/api/attendance", authenticateToken, authorize(["Staff", "CA"]), async (req, res) => {
    const attendanceList = req.body;
    const markedBy = req.user.id;
    console.log("Marked by user ID:", markedBy);

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

        const caClasses = allowedRows.filter(r => r.access_type === "ca").map(r => r.class_id);

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


router.get('/api/attendance', authenticateToken, async (req, res) => {
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


router.get('/api/attendance/period/:periodId', authenticateToken, async (req, res) => {
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


module.exports = router;
