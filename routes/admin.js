const express = require("express");
const router = express.Router();
const User = require("../models/User");
const { verifyToken } = require("../middleware/auth"); // Ensure path matches your setup

// Middleware to restrict access to ADMIN only
const requireAdmin = (req, res, next) => {
  if (req.user && req.user.role === "admin") {
    return next();
  }
  return res.status(403).json({ message: "Admin access required." });
};

// 1. Fetch all registered users
router.get("/users", verifyToken, requireAdmin, async (req, res) => {
  try {
    const users = await User.find().select("-password");
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 2. Grant access approval (for FM, CA, HOD)
router.patch("/users/:id/approve", verifyToken, requireAdmin, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isApproved: true },
      { new: true }
    ).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "User access granted successfully", user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 3. Remove/Delete a user account
router.delete("/users/:id", verifyToken, requireAdmin, async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "User deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
