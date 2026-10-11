const express = require('express');
const { listUsers, updateUserRole } = require('../controllers/admin');
const { protect } = require('../middleware/auth');
const { adminOnly } = require('../middleware/adminOnly');

const router = express.Router();

router.use(protect, adminOnly);

router.get('/users', listUsers);
router.patch('/users/:id/role', updateUserRole);

module.exports = router;
