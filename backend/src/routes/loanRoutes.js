const router = require('express').Router()
const ctrl = require('../controllers/loanController')
const { verifyToken, isSignatory } = require('../middleware/auth')

router.use(verifyToken)

router.get('/', ctrl.getLoans)
router.post('/', ctrl.requestLoan)
router.put('/:id/approve', isSignatory, ctrl.approveLoan)
router.put('/:id/reject', isSignatory, ctrl.rejectLoan)
router.post('/:id/repayments', ctrl.makeRepayment)
router.get('/:id/repayments', ctrl.getRepayments)
router.put('/repayments/:repayId/approve', isSignatory, ctrl.approveRepayment)

module.exports = router
