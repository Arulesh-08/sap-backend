const { v2: cloudinary } = require("cloudinary");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    let resource_type = "image";
    if (file.mimetype === "application/pdf") resource_type = "raw";
    if (file.mimetype.startsWith("video/")) resource_type = "video";
    return {
      folder: "sap-certificates",
      allowed_formats: ["jpg", "jpeg", "png", "pdf"],
      resource_type,
    };
  },
});

const upload = multer({ storage, limits: { fileSize: 200 * 1024 } });
module.exports = upload;
