const router = require('express').Router()
const { createGroup, joinGroup, getMyGroup } = require('../controllers/groupController')
const { verifyToken } = require('../middleware/auth')

router.use(verifyToken)

router.post('/', createGroup)
router.post('/join', joinGroup)
router.get('/mine', getMyGroup)

module.exports = router
