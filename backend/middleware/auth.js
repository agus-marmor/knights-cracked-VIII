import jwt from "jsonwebtoken";

export function requireAuth(req, res, next) {
  // --- Log 1: Middleware Entry ---
  console.log(`[requireAuth] Middleware running for path: ${req.method} ${req.originalUrl}`);

  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;

  if (!token) {
    // --- Log 2: Missing Token ---
    console.error("[requireAuth] FAILED: Missing token (Authorization header missing or invalid format).");
    return res.status(401).json({ message: "Missing token" });
  }
  console.log("[requireAuth] Token found in header.");

  try {
    // --- Log 3: Verifying Token ---
    console.log("[requireAuth] Attempting to verify token...");
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Basic check of payload structure
    if (!payload || typeof payload !== 'object' || !payload.id || !payload.username) {
        console.error("[requireAuth] FAILED: Invalid token payload structure:", payload);
        throw new Error('Invalid token payload'); // Go to catch block
    }

    // Expecting: { id, email, username }
    req.user = { id: payload.id, email: payload.email, username: payload.username };
    // --- Log 4: Success ---
    console.log(`[requireAuth] Token verified successfully. User: ${req.user.username} (ID: ${req.user.id}). Calling next().`);
    next(); // Proceed to controller

  } catch (error) { // Catch the error object
    // --- Log 5: Failure ---
    console.error("[requireAuth] FAILED: Invalid token.", error.message); // Log the specific JWT error
    return res.status(401).json({ message: "Invalid token", error: error.message }); // Optionally include error message
  }
}