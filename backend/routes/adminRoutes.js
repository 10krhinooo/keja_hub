const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/auth');
const {
  dashboard, approveHouse, rejectHouse,
  manageUsers, toggleUser, manageReports, resolveReport
} = require('../controllers/adminController');

router.use(requireRole('admin'));

router.get('/dashboard',            dashboard);
router.post('/house/:id/approve',   approveHouse);
router.post('/house/:id/reject',    rejectHouse);
router.get('/users',                manageUsers);
router.post('/users/:id/toggle',    toggleUser);
router.get('/reports',              manageReports);
router.post('/reports/:id/resolve', resolveReport);

module.exports = router;