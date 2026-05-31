const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/auth');
const {
  dashboard, searchHouses, viewHouse,
  sendBooking, myBookings, addReview, reportHouse
} = require('../controllers/studentController');

router.use(requireRole('student'));

router.get('/dashboard',  dashboard);
router.get('/search',     searchHouses);
router.get('/house/:id',  viewHouse);
router.post('/booking',   sendBooking);
router.get('/bookings',   myBookings);
router.post('/review',    addReview);
router.post('/report',    reportHouse);

module.exports = router;