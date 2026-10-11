// One-time, manually-run setup script. Promotes the initial VerifyAI
// admin account. NOT wired into server.js startup or any request path -
// run it by hand once:
//
//   node scripts/promoteAdmin.js
//
// Safe to re-run: if the account is already an admin, it's a no-op.
// Never creates an account, never touches password/emailVerified/
// twoFactorEnabled - only ever flips the role field.

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const INITIAL_ADMIN_EMAIL = 'gaznavisheikh01@gmail.com';

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    const normalizedEmail = INITIAL_ADMIN_EMAIL.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      console.error(`No account found for ${normalizedEmail}. Nothing was created or changed.`);
      process.exitCode = 1;
      return;
    }

    if (user.role === 'admin') {
      console.log(`${normalizedEmail} is already an admin. No change made.`);
      return;
    }

    user.role = 'admin';
    await user.save();
    console.log(`${normalizedEmail} promoted to admin successfully.`);
  } catch (err) {
    console.error('Admin promotion failed:', err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
