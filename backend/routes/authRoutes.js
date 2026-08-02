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

module.exports = router;
