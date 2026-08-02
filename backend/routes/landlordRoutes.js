const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { csrfVerify } = require('../middleware/csrf');
const {
  dashboard,
  showAddHouse,
  addHouse,
  showHouse,
  showEditHouse,
  editHouse,
  updateBooking,
  deleteHouse,
  showProfile,
  updateProfile,
  changePassword,
} = require('../controllers/landlordController');

router.use(requireRole('landlord'));

router.get('/dashboard', dashboard);
router.get('/add-house', showAddHouse);
router.post('/add-house', upload.array('images', 10), csrfVerify, addHouse);
router.get('/house/:id', showHouse);
router.get('/house/:id/edit', showEditHouse);
router.post('/house/:id/edit', upload.array('images', 10), csrfVerify, editHouse);
router.post('/booking/:id', updateBooking);
router.post('/house/:id/delete', deleteHouse);
router.get('/profile', showProfile);
router.post('/profile', updateProfile);
router.post('/profile/password', changePassword);

module.exports = router;
