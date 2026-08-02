const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    // Admin bypasses all role restrictions and gets access to EVERY stage/route!
    if (req.user && (req.user.role === "admin" || allowedRoles.includes(req.user.role))) {
      return next();
    }
    return res.status(403).json({ message: "Access denied for this role" });
  };
};

module.exports = { authorizeRoles };
