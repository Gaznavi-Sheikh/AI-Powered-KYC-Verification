const express = require('express');
const multer = require('multer');
const path = require('path');
const { verifyDocuments, getHistory } = require('../controllers/kyc');
const { protect } = require('../middleware/auth');

const router = express.Router();

// The uploads/ directory is created once at startup in server.js;
// multer just writes into it here.
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    // Date.now() alone can collide when multiple files land in the same
    // request (same millisecond) - add a random suffix to avoid one
    // supporting file silently overwriting another on disk.
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + unique + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: function (req, file, cb) {
    const filetypes = /jpeg|jpg|png|pdf/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('UNSUPPORTED_FILE_TYPE'));
  }
});

const handleUpload = upload.fields([
  { name: 'identity', maxCount: 1 },
  { name: 'supporting', maxCount: 5 }
]);

router.use(protect); // Protect all routes

router.post('/verify', (req, res, next) => {
  handleUpload(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: 'File is too large. Maximum size is 5MB.' });
      }
      return res.status(400).json({ success: false, message: 'File upload error.' });
    }

    if (err.message === 'UNSUPPORTED_FILE_TYPE') {
      return res.status(400).json({
        success: false,
        message: 'Unsupported file type. Only JPG, JPEG, PNG, and PDF are allowed.'
      });
    }

    return res.status(400).json({ success: false, message: 'File upload failed.' });
  });
}, verifyDocuments);

router.get('/history', getHistory);

module.exports = router;
