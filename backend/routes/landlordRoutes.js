const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');
const {
  dashboard, showAddHouse, addHouse,
  showHouse, updateBooking, deleteHouse
} = require('../controllers/landlordController');

router.use(requireRole('landlord'));

router.get('/dashboard',        dashboard);
router.get('/add-house',        showAddHouse);
router.post('/add-house',       upload.array('images', 10), addHouse);
router.get('/house/:id',        showHouse);
router.post('/booking/:id',     updateBooking);
router.post('/house/:id/delete',deleteHouse);

module.exports = router;