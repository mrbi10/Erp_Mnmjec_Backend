// const jwt = require("jsonwebtoken");

// module.exports = function auth(req, res, next) {
//   const token = req.headers.authorization?.split(" ")[1];

//   if (!token) {
//     return res.status(401).json({ message: "No token" });
//   }

//   try {
//     const decoded = jwt.verify(token, process.env.JWT_SECRET);

//     // Your session expiry check
//     if (decoded.sessionExpiry && Date.now() > decoded.sessionExpiry) {
//       return res.status(440).json({ message: "Session expired" });
//     }

//     req.user = decoded;
//     next();
//   } catch (err) {
//     return res.status(401).json({ message: "Invalid token" });
//   }
// };
