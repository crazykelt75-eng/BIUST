const router = require('express').Router()
const { getYearEndReport } = require('../controllers/reportController')
const { verifyToken } = require('../middleware/auth')

router.use(verifyToken)

router.get('/year-end', getYearEndReport)

module.exports = router
