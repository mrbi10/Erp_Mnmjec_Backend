// routes/auth.js

const express = require('express');

module.exports = (db) => {
    const router = express.Router();

    // Hardcoded User Data (Replace with DB check in production)
    const users = {
        'principal_mnmjec': { id: 1, name: 'Principal', role: 'Admin' },
        'staff_mnmjec': { id: 2, name: 'Faculty Staff', role: 'Staff', dept: 'CSE' },
        'hod_mnmjec': { id: 3, name: 'HOD', role: 'HOD', dept: 'CSE' },
    };

    router.post('/login', (req, res) => {
        const { username, password } = req.body;
        
        if (password !== 'Test@123') {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const user = users[username.toLowerCase()];
        
        if (user) {
            // In a real app, generate and return a JWT here
            return res.json({ 
                message: 'Login successful', 
                user: { id: user.id, name: user.name, role: user.role, dept: user.dept }
            });
        }

        res.status(401).json({ message: 'Invalid credentials' });
    });

    return router;
};