const { v2: cloudinary } = require("cloudinary");
const multer = require("multer");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const ALLOWED_MIMETYPES = ["image/jpeg", "image/png", "application/pdf"];

function resourceTypeFor(mimetype) {
  if (mimetype === "application/pdf") return "raw";
  if (mimetype.startsWith("video/")) return "video";
  return "image";
}

// Minimal multer storage engine — replaces multer-storage-cloudinary (unmaintained,
// permanently pinned to the vulnerable cloudinary v1.x line via peerDependencies).
// Streams the incoming file straight to Cloudinary without touching local disk.
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

const storage = new CloudinaryStorageEngine();

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIMETYPES.includes(file.mimetype)) {
    return cb(new Error("Only jpg, png, and pdf files are allowed"));
  }
  cb(null, true);
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 200 * 1024 } });

module.exports = upload;
