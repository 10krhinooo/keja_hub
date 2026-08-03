const express = require('express');
const router = express.Router();
const {
  showHome,
  showRegister,
  showLogin,
  register,
  login,
  logout,
  showForgotPassword,
  forgotPassword,
  showResetPassword,
  resetPassword,
  showVerifyPending,
  resendVerification,
  verifyEmail,
} = require('../controllers/authController');

router.get('/home', showHome);
router.get('/', showHome);
router.get('/register', showRegister);
router.post('/register', register);
router.get('/login', showLogin);
router.post('/login', login);
router.post('/logout', logout);
router.get('/forgot-password', showForgotPassword);
router.post('/forgot-password', forgotPassword);
router.get('/reset-password', showResetPassword);
router.post('/reset-password', resetPassword);
router.get('/verify-email/pending', showVerifyPending);
router.post('/verify-email/resend', resendVerification);
router.get('/verify-email', verifyEmail);

module.exports = router;
