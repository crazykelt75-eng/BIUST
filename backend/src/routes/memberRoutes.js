const router = require('express').Router()
const { getMembers, enrollMember, updateMemberRole } = require('../controllers/memberController')
const { verifyToken, isSignatory, isAdmin } = require('../middleware/auth')

router.use(verifyToken)

router.get('/', getMembers)
router.post('/', isSignatory, enrollMember)
router.put('/:memberId/role', isAdmin, updateMemberRole)

module.exports = router
