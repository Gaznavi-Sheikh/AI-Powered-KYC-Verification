const mongoose = require('mongoose');
const User = require('../models/User');

const ALLOWED_ROLES = ['admin', 'user'];

const buildUserListItem = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  emailVerified: user.emailVerified,
  twoFactorEnabled: user.twoFactorEnabled,
  createdAt: user.createdAt
});

exports.listUsers = async (req, res) => {
  try {
    // Explicit field allowlist via .select() - password, OTP hashes, and
    // reset-token hashes live on other documents/collections entirely
    // and are never queried here; this list is additionally never
    // extended with raw field spreads.
    const users = await User.find()
      .select('name email role emailVerified twoFactorEnabled createdAt')
      .sort('-createdAt');

    return res.status(200).json({
      success: true,
      count: users.length,
      data: users.map(buildUserListItem)
    });
  } catch (err) {
    console.error('List users error:', err.message);
    return res.status(500).json({ success: false, message: 'Something went wrong, please try again' });
  }
};

exports.updateUserRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid user id' });
    }

    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: "role must be 'admin' or 'user'" });
    }

    const target = await User.findById(id);
    if (!target) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // req.user is the authenticated caller (from protect()) - never an id
    // taken from the request body. No one, including an admin, may change
    // their own role through this endpoint.
    if (String(req.user._id) === String(target._id)) {
      return res.status(403).json({ success: false, message: 'You cannot change your own role.' });
    }

    if (target.role === 'admin' && role === 'user') {
      const otherAdmins = await User.countDocuments({ role: 'admin', _id: { $ne: target._id } });
      if (otherAdmins === 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot demote the last remaining admin.'
        });
      }
    }

    target.role = role;
    await target.save();

    return res.status(200).json({ success: true, data: buildUserListItem(target) });
  } catch (err) {
    console.error('Update user role error:', err.message);
    return res.status(500).json({ success: false, message: 'Something went wrong, please try again' });
  }
};
