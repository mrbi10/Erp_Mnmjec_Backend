const express = require('express');
const pool = require('../db');
const authenticateToken = require('../middleware/auth');

const router = express.Router();
router.post('/api/forgotpassword', async (req, res) => {
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
router.post('/api/resetpassword/:token', async (req, res) => {
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

module.exports = router;
