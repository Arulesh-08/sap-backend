const express = require("express");
const router = express.Router();
const StudentPoints = require("../models/StudentPoints");
const { protect } = require("../middleware/auth");

// 1. Get logged-in student's points submissions (GET /api/points/my-points)
router.get("/my-points", protect, async (req, res) => {
  try {
    const points = await StudentPoints.find({ student: req.user.id }).sort({
      createdAt: -1,
    });
    res.json(points);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Alias: also accept GET /api/points/my
router.get("/my", protect, async (req, res) => {
  try {
    const points = await StudentPoints.find({ student: req.user.id }).sort({
      createdAt: -1,
    });
    res.json(points);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 2. Submit new Activity Point entry (POST /api/points)
router.post("/", protect, async (req, res) => {
  try {
    const { category, activityTitle, pointsClaimed, certificateUrl } = req.body;

    const newPoint = new StudentPoints({
      student: req.user.id,
      category,
      activityTitle,
      pointsClaimed,
      certificateUrl,
      status: "pending",
    });

    await newPoint.save();
    res.status(201).json(newPoint);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 3. Get pending submissions for advisors/HOD (GET /api/points/pending)
router.get("/pending", protect, async (req, res) => {
  try {
    const pendingPoints = await StudentPoints.find({ status: "pending" }).populate(
      "student",
      "name rollNo dept"
    );
    res.json(pendingPoints);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
