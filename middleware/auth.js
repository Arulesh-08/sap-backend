const jwt = require("jsonwebtoken");

// Authentication middleware to check JWT token
const protect = (req, res, next) => {
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      token = req.headers.authorization.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "secret");
      req.user = decoded; // Contains id, role, email, etc.
      return next();
    } catch (error) {
      return res.status(401).json({ message: "Not authorized, token failed" });
    }
  }

  if (!token) {
    return res.status(401).json({ message: "Not authorized, no token provided" });
  }
};

// Authorization middleware that lets ADMIN access everything alongside allowed roles!
const allowRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "User not authenticated" });
    }

    // 🔑 Super Admin Bypass: Admin has full access to ALL student/FM/CA/HOD routes!
    if (req.user.role === "admin" || allowedRoles.includes(req.user.role)) {
      return next();
    }

    return res.status(403).json({ message: "Access denied for this role" });
  };
};

// Alias for compatibility
const authorizeRoles = allowRoles;

module.exports = {
  protect,
  allowRoles,
  authorizeRoles,
};
