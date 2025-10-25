// controllers/auth.controller.js
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const signToken = (user) =>
  jwt.sign(
    { id: user._id, email: user.email, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

// POST /api/auth/signup
export const signup = async (req, res) => {
  try {
    const { username, email, password } = req.body || {};

    // Basic validation
    if (!username || !email || !password) {
      return res
        .status(400)
        .json({ message: "Username, email, and password are required." });
    }
    if (password.length < 6) {
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters." });
    }

    // Normalize input
    const normalizedEmail = String(email).toLowerCase().trim();
    const normalizedUsername = String(username).toLowerCase().trim();

    // Ensure uniqueness (email OR username)
    const existing = await User.findOne({
      $or: [{ email: normalizedEmail }, { username: normalizedUsername }],
    });
    if (existing) {
      const field =
        existing.email === normalizedEmail ? "email" : "username";
      return res.status(409).json({ message: `That ${field} is already in use.` });
    }

    // Hash password and create user
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({
      username: normalizedUsername,
      email: normalizedEmail,
      password: hash,
    });

    // Issue JWT
    const token = signToken(user);
    return res.status(201).json({
      token,
      user: { id: user._id, email: user.email, username: user.username },
    });
  } catch (err) {
    console.error("[signup] error:", err);
    return res.status(500).json({ message: "Signup failed" });
  }
};

// POST /api/auth/login
// Body: { identifier: "<username OR email>", password: "..." }
export const login = async (req, res) => {
  try {
    const { identifier, password } = req.body || {};

    if (!identifier || !password) {
      return res
        .status(400)
        .json({ message: "Identifier and password are required." });
    }

    const idNorm = String(identifier).toLowerCase().trim();
    const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(idNorm);

    // Find by email OR username
    const user = await User.findOne(
      looksLikeEmail ? { email: idNorm } : { username: idNorm }
    );
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    // Verify password
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    // Issue JWT
    const token = signToken(user);
    return res.json({
      token,
      user: { id: user._id, email: user.email, username: user.username },
    });
  } catch (err) {
    console.error("[login] error:", err);
    return res.status(500).json({ message: "Login failed" });
  }
};
