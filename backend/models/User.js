const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a name'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Please add an email'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      'Please add a valid email'
    ]
  },
  password: {
    type: String,
    required: [true, 'Please add a password'],
    minlength: 6,
    select: false
  },
  // Phase 11: set true only when the registration flow completed email
  // OTP verification. Existing users (created before this phase) default
  // to false - this is informational only and does not gate login, so
  // existing sessions/accounts are unaffected.
  emailVerified: {
    type: Boolean,
    default: false
  },
  // Login-time email OTP. Defaults to true for every user (opt-out, not
  // opt-in) - a user turns this off for themselves via Settings, which
  // makes login() skip straight to issuing a session token as before.
  twoFactorEnabled: {
    type: Boolean,
    default: true
  },
  // Every account is a Normal User unless explicitly promoted via the
  // admin-only PATCH /admin/users/:id/role endpoint or the one-time
  // scripts/promoteAdmin.js setup script - never settable from
  // registration input or any other client-supplied value.
  role: {
    type: String,
    enum: ['admin', 'user'],
    default: 'user'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Encrypt password using bcrypt. Mongoose 9's async pre-hooks are
// promise-based - no `next` callback is passed to them, so this must
// never call next() (that was a pre-existing bug here: every prior
// .save()/.create() always modified the password, so the isModified()
// branch calling next() was never actually reached until a save that
// touches an unrelated field, e.g. twoFactorEnabled, hit it and crashed
// with "next is not a function").
userSchema.pre('save', async function() {
  if (!this.isModified('password')) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Match user entered password to hashed password in database
userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
