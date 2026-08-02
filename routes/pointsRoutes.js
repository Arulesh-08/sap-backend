const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const StudentPoints = require("../models/StudentPoints");
const { protect } = require("../middleware/auth");

// Storage setup for Multer file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

// Accept single file from any form field name (certificate, file, image, etc.)
const upload = multer({ storage });

const handleSubmit = async (req, res) => {
  try {
    console.log("Submit body:", req.body);
    console.log("Submit file:", req.file);

    const { category, activityTitle, pointsClaimed } = req.body;
    const certificateUrl = req.file ? `/uploads/${req.file.filename}` : "";

    const newPoint = new StudentPoints({
      student: req.user.id || req.user._id,
      category: category || "General",
      activityTitle: activityTitle || "Untitled Activity",
      pointsClaimed: Number(pointsClaimed) || 0,
      certificateUrl,
      status: "pending",
    });

    await newPoint.save();
    return res.status(201).json(newPoint);
  } catch (err) {
    console.error("Error in handleSubmit:", err);
    return res.status(500).json({ message: err.message });
  }
};

// Handle all common submission route names and field names
router.post("/submit", protect, upload.any(), handleSubmit);
router.post("/", protect, upload.any(), handleSubmit);

// Fetch student's points
router.get("/my-points", protect, async (req, res) => {
  try {
    const points = await StudentPoints.find({ student: req.user.id || req.user._id }).sort({
      createdAt: -1,
    });
    res.json(points);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/my", protect, async (req, res) => {
  try {
    const points = await StudentPoints.find({ student: req.user.id || req.user._id }).sort({
      createdAt: -1,
    });
    res.json(points);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
