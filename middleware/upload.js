const { v2: cloudinary } = require("cloudinary");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const isCloudinaryConfigured = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

if (isCloudinaryConfigured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

const ALLOWED_MIMETYPES = ["image/jpeg", "image/png", "application/pdf"];

function resourceTypeFor(mimetype) {
  if (mimetype === "application/pdf") return "raw";
  if (mimetype.startsWith("video/")) return "video";
  return "image";
}

// Minimal multer storage engine — streams straight to Cloudinary without local disk
class CloudinaryStorageEngine {
  _handleFile(req, file, cb) {
    const resource_type = resourceTypeFor(file.mimetype);

    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: "sap-certificates", resource_type },
      (error, result) => {
        if (error) return cb(error);
        cb(null, {
          filename: result.public_id,
          path: result.secure_url,
          size: result.bytes,
          mimetype: file.mimetype,
          public_id: result.public_id,
          resource_type: result.resource_type,
        });
      }
    );

    file.stream.on("error", (err) => cb(err));
    file.stream.pipe(uploadStream);
  }

  _removeFile(req, file, cb) {
    const resource_type = resourceTypeFor(file.mimetype);
    cloudinary.uploader.destroy(file.filename, { resource_type }, (error) => cb(error));
  }
}

// Fallback disk storage engine if Cloudinary credentials are missing
const uploadsDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const diskStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const uniqueName = `cert-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  },
});

const storage = isCloudinaryConfigured ? new CloudinaryStorageEngine() : diskStorage;

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIMETYPES.includes(file.mimetype)) {
    return cb(new Error("Only jpg, png, and pdf files are allowed"));
  }
  cb(null, true);
};

// Max 5MB or 70KB limit? Note: user schema comment says 70KB or PDF/photo. Let's allow standard 5MB or 1MB to avoid unexpected file rejects while validating types
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

module.exports = upload;
module.exports.isCloudinaryConfigured = isCloudinaryConfigured;
