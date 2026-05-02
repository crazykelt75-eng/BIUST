const router = require('express').Router()
const { register, login, getMe, updateProfile, changePassword } = require('../controllers/authController')
const { verifyToken } = require('../middleware/auth')

router.post('/register', register)
router.post('/login', login)
router.get('/me', verifyToken, getMe)
router.put('/profile', verifyToken, updateProfile)
router.put('/password', verifyToken, changePassword)

module.exports = router
