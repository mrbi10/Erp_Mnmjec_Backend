const express = require('express');
const pool = require('../db');
const authenticateToken = require('../middleware/auth');

const router = express.Router();

router.get('/api/dashboard', authenticateToken, async (req, res) => {
    const { role, id: userId, assigned_class_id: classId, dept_id: deptId, roll_no: rollNo } = req.user;

    try {
        let dashboardData = {};

        if (role === 'Student') {
            // Single student attendance
            const [attendanceRows] = await pool.query(
                `SELECT 
                    s.student_id,
                    s.name,
                    COUNT(a.attendance_id) AS totalClasses,
                    SUM(CASE 
                        WHEN a.status = 'Present' THEN 1
                        WHEN a.status = 'Late' THEN 0.5
                        ELSE 0
                    END) AS attendedClasses,
                    ROUND(
                        SUM(CASE 
                            WHEN a.status = 'Present' THEN 1
                            WHEN a.status = 'Late' THEN 0.5
                            ELSE 0
                        END) / COUNT(a.attendance_id) * 100, 2
                    ) AS attendancePercentage
                 FROM students s
                 LEFT JOIN attendance a ON s.student_id = a.student_id
                 WHERE s.roll_no = ?
                 GROUP BY s.student_id, s.name`,
                [rollNo]
            );

            const attendance = attendanceRows[0] || { totalClasses: 0, attendedClasses: 0, attendancePercentage: 0 };

            // Backlogs (marks < 40%)
            const [marksRows] = await pool.query(
                `SELECT COUNT(*) AS backlogs
                 FROM marks m
                 JOIN students s ON m.student_id = s.student_id
                 WHERE s.roll_no = ? AND m.score < (m.max_score * 0.4)`,
                [rollNo]
            );

            // Last 5 attendance entries
            const [recentAttendance] = await pool.query(
                `SELECT a.date, a.status, sub.subject_name
                 FROM attendance a
                 JOIN students s ON a.student_id = s.student_id
                 JOIN subjects sub ON a.subject_id = sub.subject_id
                 WHERE s.roll_no = ?
                 ORDER BY a.date DESC, a.period DESC
                 LIMIT 5`,
                [rollNo]
            );

            dashboardData = {
                role,
                attendancePercentage: attendance.attendancePercentage || 0,
                totalClasses: attendance.totalClasses || 0,
                classesPresent: attendance.attendedClasses || 0,
                backlogs: marksRows[0]?.backlogs || 0,
                lowAttendanceStudents: [],
                pendingReports: [],
                recentAttendance: [],
            };
        }
        else if (role === 'CA' || role === 'Staff') {
            // Low attendance students in assigned class
            const [lowAttendance] = await pool.query(
                `SELECT s.student_id, s.name,
                        ROUND(
                            SUM(CASE 
                                WHEN a.status = 'Present' THEN 1
                                WHEN a.status = 'Late' THEN 0.5
                                ELSE 0
                            END) / COUNT(a.attendance_id) * 100, 2
                        ) AS attendancePercentage
                 FROM students s
                 JOIN attendance a ON s.student_id = a.student_id
                 WHERE s.class_id = ?
                 GROUP BY s.student_id, s.name
                 HAVING attendancePercentage < 75`,
                [classId]
            );

            // Pending marks (score is NULL)
            const [pendingReports] = await pool.query(
                `SELECT m.*, s.name AS student_name, sub.subject_name
                 FROM marks m
                 JOIN students s ON m.student_id = s.student_id
                 JOIN subjects sub ON m.subject_id = sub.subject_id
                 WHERE sub.staff_id = ? AND m.score IS NULL`,
                [userId]
            );

            dashboardData = {
                role,
                lowAttendanceStudents: lowAttendance,
                pendingReports
            };
        }
        else if (role === 'HOD') {
            // Department-wide average attendance
            const [deptAttendance] = await pool.query(
                `SELECT ROUND(AVG(attendancePercentage),2) AS deptAttendance
                 FROM (
                     SELECT s.student_id,
                            ROUND(
                                SUM(CASE 
                                    WHEN a.status = 'Present' THEN 1
                                    WHEN a.status = 'Late' THEN 0.5
                                    ELSE 0
                                END) / COUNT(a.attendance_id) * 100, 2
                            ) AS attendancePercentage
                     FROM students s
                     JOIN attendance a ON s.student_id = a.student_id
                     JOIN classes c ON s.class_id = c.class_id
                     WHERE c.dept_id = ?
                     GROUP BY s.student_id
                 ) AS sub`,
                [deptId]
            );

            // Critical alerts (attendance < 60%)
            const [criticalAlerts] = await pool.query(
                `SELECT s.name AS studentName,
                        ROUND(
                            SUM(CASE 
                                WHEN a.status = 'Present' THEN 1
                                WHEN a.status = 'Late' THEN 0.5
                                ELSE 0
                            END) / COUNT(a.attendance_id) * 100, 2
                        ) AS attendancePercentage
                 FROM students s
                 JOIN attendance a ON s.student_id = a.student_id
                 JOIN classes c ON s.class_id = c.class_id
                 WHERE c.dept_id = ?
                 GROUP BY s.student_id
                 HAVING attendancePercentage < 60`,
                [deptId]
            );

            dashboardData = {
                role,
                departmentAttendance: deptAttendance[0]?.deptAttendance || 0,
                criticalAlerts
            };
        }
        else if (role === 'Principal') {
            // Overall stats
            const [overall] = await pool.query(
                `SELECT COUNT(DISTINCT s.student_id) AS totalStudents,
                        ROUND(
                            SUM(CASE 
                                WHEN a.status = 'Present' THEN 1
                                WHEN a.status = 'Late' THEN 0.5
                                ELSE 0
                            END) / COUNT(a.attendance_id) * 100, 2
                        ) AS overallAttendance
                 FROM students s
                 LEFT JOIN attendance a ON s.student_id = a.student_id`
            );

            dashboardData = {
                role,
                totalStudents: overall[0]?.totalStudents || 0,
                overallAttendance: overall[0]?.overallAttendance || 0
            };
        }

        res.json(dashboardData);
    } catch (err) {
        console.error('[ERROR] /dashboard failed:', err);
        res.status(500).json({ message: 'Server error' });
    }
});


module.exports = router;
