const jwt = require("jsonwebtoken");

// Authentication Middleware
const protect = (req, res, next) => {
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      token = req.headers.authorization.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "secret");
      req.user = decoded;
      return next();
    } catch (error) {
      return res.status(401).json({ message: "Not authorized, token failed" });
    }
  }

  if (!token) {
    return res.status(401).json({ message: "Not authorized, no token provided" });
  }
};

// Alias protect as verifyToken so both names work everywhere
const verifyToken = protect;

// Role Check Middleware (Grants Admin full bypass access)
const allowRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "User not authenticated" });
    }

    if (req.user.role === "admin" || allowedRoles.includes(req.user.role)) {
      return next();
    }

    return res.status(403).json({ message: "Access denied for this role" });
  };
};

const authorizeRoles = allowRoles;

module.exports = {
  protect,
  verifyToken,
  allowRoles,
  authorizeRoles,
};
