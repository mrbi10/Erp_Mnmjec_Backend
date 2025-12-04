// const express = require("express");
// const router = express.Router();
// const multer = require("multer");
// import { uploadToOneDrive } from "./services/onedrive.js";
// const pool = require("../db"); 
// import auth from "./middleware/auth.js";


// // Multer
// const upload = multer();

// // ----------------------------
// // Upload File → OneDrive
// // ----------------------------
// router.post("/upload", auth, upload.single("file"), async (req, res) => {
//   try {
//     if (!req.file) return res.status(400).json({ message: "No file uploaded" });

//     // If admin consent is not given, return mock mode
//     if (!process.env.ONEDRIVE_ENABLED || process.env.ONEDRIVE_ENABLED === "false") {
//       return res.json({
//         mock: true,
//         message: "OneDrive upload disabled, returning test link",
//         webUrl: "https://example.com/test",
//         downloadUrl: "https://example.com/test/download"
//       });
//     }

//     const folderPath = process.env.ONEDRIVE_ROOT_FOLDER || "/ERP_Storage";

//     const result = await uploadToOneDrive(
//       req.file.buffer,
//       req.file.originalname,
//       folderPath
//     );

//     // Insert into DB table 'files'
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
//       ...result
//     });

//   } catch (err) {
//     console.error("Upload error:", err);
//     res.status(500).json({ message: "Upload failed" });
//   }
// });


// // ----------------------------
// // Add Profile Hub item
// // ----------------------------
// router.post("/item", auth, async (req, res) => {
//   try {
//     const { type, title, description, date, extra, file_id } = req.body;

//     if (!type || !title) {
//       return res.status(400).json({ message: "Type and title are required" });
//     }

//     const [result] = await pool.query(
//       `INSERT INTO profile_items 
//        (owner_user_id, owner_type, type, title, description, event_date, extra, file_id)
//        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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

//     res.json({ success: true, item_id: result.insertId });

//   } catch (err) {
//     console.error("Add item error:", err);
//     res.status(500).json({ message: "Server error" });
//   }
// });


// // ----------------------------
// // Get all items of a user
// // ----------------------------
// router.get("/items", auth, async (req, res) => {
//   try {
//     const [rows] = await pool.query(
//       `SELECT * FROM profile_items WHERE owner_user_id = ? AND owner_type = ? ORDER BY created_at DESC`,
//       [req.user.id, req.user.role.toLowerCase()]
//     );

//     res.json(rows);

//   } catch (err) {
//     console.error("Fetch items error:", err);
//     res.status(500).json({ message: "Server error" });
//   }
// });


// // ----------------------------
// // Delete item
// // ----------------------------
// router.delete("/item/:id", auth, async (req, res) => {
//   try {
//     const { id } = req.params;

//     await pool.query(
//       `DELETE FROM profile_items WHERE id = ? AND owner_user_id = ?`,
//       [id, req.user.id]
//     );

//     res.json({ success: true });

//   } catch (err) {
//     console.error("Delete error:", err);
//     res.status(500).json({ message: "Server error" });
//   }
// });


// module.exports = router;
