const router = require('express').Router()
const ctrl = require('../controllers/contributionController')
const { verifyToken, isSignatory } = require('../middleware/auth')

router.use(verifyToken)

router.get('/', ctrl.getContributions)
router.post('/', ctrl.submitContribution)
router.put('/:id/approve', isSignatory, ctrl.approveContribution)
router.put('/:id/reject', isSignatory, ctrl.rejectContribution)

module.exports = router
