// middleware/auth.js
import jwt from "jsonwebtoken";

export function requireAuth(req, res, next) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Missing token" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Expecting: { id, email, username }
    req.user = { id: payload.id, email: payload.email, username: payload.username };
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}
