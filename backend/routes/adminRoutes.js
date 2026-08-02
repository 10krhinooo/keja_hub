const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/auth');
const {
  dashboard,
  adminListings,
  analytics,
  viewHouse,
  approveHouse,
  rejectHouse,
  deleteHouse,
  manageUsers,
  toggleUser,
  toggleVerified,
  manageReports,
  resolveReport,
  allBookings,
  showProfile,
  updateProfile,
  changePassword,
} = require('../controllers/adminController');

router.use(requireRole('admin'));

router.get('/dashboard', dashboard);
router.get('/listings', adminListings);
router.get('/analytics', analytics);
router.get('/house/:id', viewHouse);
router.post('/house/:id/approve', approveHouse);
router.post('/house/:id/reject', rejectHouse);
router.post('/house/:id/delete', deleteHouse);
router.get('/users', manageUsers);
router.post('/users/:id/toggle', toggleUser);
router.post('/users/:id/verify', toggleVerified);
router.get('/reports', manageReports);
router.post('/reports/:id/resolve', resolveReport);
router.get('/bookings', allBookings);
router.get('/profile', showProfile);
router.post('/profile', updateProfile);
router.post('/profile/password', changePassword);

module.exports = router;
