// routes/activity.js

const express = require('express');

module.exports = (db) => {
    const router = express.Router();

    // Helper: Simple Role Check (Middleware would be better)
    const canView = (userRole) => ['Admin', 'HOD', 'Staff'].includes(userRole);
    const canPost = (userRole) => userRole === 'Staff';

    // POST: Submit a new daily activity (Staff only)
    router.post('/', (req, res) => {
        const { activity, staff_id, department } = req.body; // Assume staff_id and department are passed after login
        
        // **NOTE**: Must replace this with a proper role check using JWT in a real app
        // For now, we assume the call is authenticated and includes user info
        
        const query = 'INSERT INTO daily_activity (staff_id, department, activity_details) VALUES (?, ?, ?)';
        db.query(query, [staff_id, department, activity], (err, results) => {
            if (err) return res.status(500).json({ error: err.message });
            res.status(201).json({ message: 'Activity posted successfully', id: results.insertId });
        });
    });

    // GET: Retrieve daily activities (Monitored by HOD, Overall by Admin)
    router.get('/', (req, res) => {
        const { user_role, user_dept } = req.query; // Use query params for simplicity

        let query;
        let params = [];

        if (user_role === 'Admin') {
            // Admin: view all activities
            query = 'SELECT a.*, s.staff_name FROM daily_activity a JOIN staff s ON a.staff_id = s.staff_id ORDER BY created_at DESC';
        } else if (user_role === 'HOD') {
            // HOD: view activities for their department
            query = 'SELECT a.*, s.staff_name FROM daily_activity a JOIN staff s ON a.staff_id = s.staff_id WHERE a.department = ? ORDER BY created_at DESC';
            params.push(user_dept);
        } else {
            // Staff/Other: only view their own (optional, can be restricted)
            return res.status(403).json({ message: 'Access denied.' });
        }

        db.query(query, params, (err, results) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(results);
        });
    });

    return router;
};