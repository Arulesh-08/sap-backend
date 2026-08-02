const express = require("express");
const router = express.Router();
const User = require("../models/User");
const StudentPoints = require("../models/StudentPoints");
const { protect } = require("../middleware/auth");

// Restrict access to ADMIN only
const requireAdmin = (req, res, next) => {
  if (req.user && req.user.role === "admin") {
    return next();
  }
  return res.status(403).json({ message: "Admin access required." });
};

// 1. Get all registered users
router.get("/users", protect, requireAdmin, async (req, res) => {
  try {
    const users = await User.find().select("-password");
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 2. Approve user access (for FM, CA, HOD)
router.patch("/users/:id/approve", protect, requireAdmin, async (req, res) => {
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

// 3. Delete user account and cleanup points data
router.delete("/users/:id", protect, requireAdmin, async (req, res) => {
  try {
    const userId = req.params.id;

    const deletedUser = await User.findByIdAndDelete(userId);
    if (!deletedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    await StudentPoints.deleteMany({ student: userId });

    res.json({ message: "User and associated records deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
