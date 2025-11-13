// authController.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const db = require('../db'); // or wherever your DB connection is

exports.register = async (req, res) => {
  res.json({ message: "Register endpoint" });
};

exports.login = async (req, res) => {
  res.json({ message: "Login endpoint" });
};
