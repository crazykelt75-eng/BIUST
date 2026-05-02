const { pool } = require('../config/database')

exports.getLoans = async (req, res) => {
    try {
        const gId = req.user.groupId
        if (!gId) return res.status(400).json({ success: false, message: 'Not in a group' })

        const mine = req.query.mine === 'true'

        let q = `SELECT l.*, u.full_name as member_name,
                 a1.full_name as approver1_name, a2.full_name as approver2_name
                 FROM loans l
                 JOIN users u ON u.id = l.member_id
                 LEFT JOIN users a1 ON a1.id = l.approved_by_1
                 LEFT JOIN users a2 ON a2.id = l.approved_by_2
                 WHERE l.group_id = ?`
        const params = [gId]

        if (mine) {
            q += ' AND l.member_id = ?'
            params.push(req.user.id)
        }

        q += ' ORDER BY l.created_at DESC'

        const [rows] = await pool.query(q, params)

        const loans = rows.map(r => ({
            id: r.id,
            principalAmount: r.principal_amount,
            outstandingBalance: r.outstanding_balance,
            interestAccrued: r.interest_accrued,
            loanDate: r.loan_date,
            dueDate: r.due_date,
            status: r.status,
            purpose: r.purpose,
            memberName: r.member_name,
            memberId: r.member_id,
            approvedBy1: r.approver1_name,
            approvedBy2: r.approver2_name,
            approvedAt: r.approved_at,
            createdAt: r.created_at
        }))

        res.json({ success: true, loans })
    } catch (err) {
        console.log('getLoans err', err)
        res.status(500).json({ success: false, message: 'Failed to get loans' })
    }
}

exports.requestLoan = async (req, res) => {
    try {
        const gId = req.user.groupId
        if (!gId) return res.status(400).json({ success: false, message: 'Not in a group' })

        const { amount, purpose, termMonths } = req.body

        if (!amount || !purpose) {
            return res.status(400).json({ success: false, message: 'Amount and purpose required' })
        }

        if (amount <= 0) {
            return res.status(400).json({ success: false, message: 'Amount must be positive' })
        }

        // check they dont already have an active or pending loan
        const [active] = await pool.query(
            "SELECT id FROM loans WHERE member_id = ? AND group_id = ? AND status IN ('pending', 'active', 'approved')",
            [req.user.id, gId]
        )
        if (active.length > 0) {
            return res.status(400).json({ success: false, message: 'You already have an active or pending loan' })
        }

        const months = parseInt(termMonths) || 6
        const loanDate = new Date()
        const dueDate = new Date()
        dueDate.setMonth(dueDate.getMonth() + months)

        const [result] = await pool.query(
            `INSERT INTO loans (group_id, member_id, principal_amount, outstanding_balance, loan_date, due_date, purpose)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [gId, req.user.id, amount, amount, loanDate, dueDate, purpose]
        )

        res.status(201).json({
            success: true,
            message: 'Loan request submitted, waiting for approval',
            id: result.insertId
        })
    } catch (err) {
        console.log('requestLoan err', err)
        res.status(500).json({ success: false, message: 'Failed to request loan' })
    }
}

// two signatories must approve - different people
exports.approveLoan = async (req, res) => {
    try {
        const loanId = req.params.id
        const gId = req.user.groupId
        const uid = req.user.id

        const [rows] = await pool.query('SELECT * FROM loans WHERE id = ?', [loanId])
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Loan not found' })

        const loan = rows[0]
        if (loan.group_id !== gId) return res.status(403).json({ success: false, message: 'Not your group' })
        if (loan.status !== 'pending') return res.status(400).json({ success: false, message: 'Loan is not pending' })

        // cant approve your own loan
        if (loan.member_id === uid) {
            return res.status(400).json({ success: false, message: "Can't approve your own loan" })
        }

        if (loan.approved_by_1 === uid || loan.approved_by_2 === uid) {
            return res.status(400).json({ success: false, message: 'You already approved this loan' })
        }

        if (!loan.approved_by_1) {
            // first approval
            await pool.query(
                'UPDATE loans SET approved_by_1 = ? WHERE id = ?',
                [uid, loanId]
            )
            res.json({ success: true, message: 'First approval recorded. Waiting for second signatory.' })
        } else {
            // second approval - activate the loan
            await pool.query(
                "UPDATE loans SET approved_by_2 = ?, status = 'active', approved_at = NOW() WHERE id = ?",
                [uid, loanId]
            )
            res.json({ success: true, message: 'Loan fully approved and is now active!' })
        }
    } catch (err) {
        console.log('approveLoan err', err)
        res.status(500).json({ success: false, message: 'Failed to approve loan' })
    }
}

exports.rejectLoan = async (req, res) => {
    try {
        const loanId = req.params.id
        const gId = req.user.groupId

        const [rows] = await pool.query('SELECT * FROM loans WHERE id = ?', [loanId])
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Not found' })

        const loan = rows[0]
        if (loan.group_id !== gId) return res.status(403).json({ success: false, message: 'Not your group' })
        if (loan.status !== 'pending') return res.status(400).json({ success: false, message: 'Not pending' })

        await pool.query("UPDATE loans SET status = 'rejected' WHERE id = ?", [loanId])

        res.json({ success: true, message: 'Loan rejected' })
    } catch (err) {
        console.log('rejectLoan err', err)
        res.status(500).json({ success: false, message: 'Failed to reject' })
    }
}

// member submits a repayment
exports.makeRepayment = async (req, res) => {
    try {
        const loanId = req.params.id
        const gId = req.user.groupId
        const { amount, paymentReference } = req.body

        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, message: 'Amount required' })
        }

        const [rows] = await pool.query('SELECT * FROM loans WHERE id = ?', [loanId])
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Loan not found' })

        const loan = rows[0]
        if (loan.group_id !== gId) return res.status(403).json({ success: false, message: 'Not your group' })
        if (loan.member_id !== req.user.id) return res.status(403).json({ success: false, message: 'Not your loan' })
        if (loan.status !== 'active') return res.status(400).json({ success: false, message: 'Loan is not active' })

        if (parseFloat(amount) > parseFloat(loan.outstanding_balance)) {
            return res.status(400).json({ success: false, message: "Can't repay more than you owe" })
        }

        const [result] = await pool.query(
            `INSERT INTO loan_repayments (loan_id, member_id, amount, payment_date, payment_reference, initiated_by)
             VALUES (?, ?, ?, CURDATE(), ?, ?)`,
            [loanId, req.user.id, amount, paymentReference || '', req.user.id]
        )

        res.status(201).json({
            success: true,
            message: 'Repayment submitted, waiting for signatory approval',
            id: result.insertId
        })
    } catch (err) {
        console.log('makeRepayment err', err)
        res.status(500).json({ success: false, message: 'Failed to submit repayment' })
    }
}

// signatory approves repayment and updates the loan balance
exports.approveRepayment = async (req, res) => {
    try {
        const repayId = req.params.repayId
        const gId = req.user.groupId

        const [rows] = await pool.query('SELECT * FROM loan_repayments WHERE id = ?', [repayId])
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Repayment not found' })

        const repay = rows[0]
        if (repay.status !== 'pending') return res.status(400).json({ success: false, message: 'Already processed' })

        // get the loan
        const [loanRows] = await pool.query('SELECT * FROM loans WHERE id = ?', [repay.loan_id])
        const loan = loanRows[0]
        if (loan.group_id !== gId) return res.status(403).json({ success: false, message: 'Not your group' })

        const newBalance = parseFloat(loan.outstanding_balance) - parseFloat(repay.amount)
        const newStatus = newBalance <= 0 ? 'paid' : 'active'

        const conn = await pool.getConnection()
        await conn.beginTransaction()
        try {
            await conn.query(
                "UPDATE loan_repayments SET status = 'approved', approved_by = ?, approved_at = NOW() WHERE id = ?",
                [req.user.id, repayId]
            )
            await conn.query(
                'UPDATE loans SET outstanding_balance = ?, status = ? WHERE id = ?',
                [Math.max(0, newBalance), newStatus, repay.loan_id]
            )
            await conn.commit()
            conn.release()
        } catch (e) {
            await conn.rollback()
            conn.release()
            throw e
        }

        res.json({
            success: true,
            message: newStatus === 'paid' ? 'Repayment approved. Loan is fully paid!' : 'Repayment approved',
            newBalance: Math.max(0, newBalance)
        })
    } catch (err) {
        console.log('approveRepayment err', err)
        res.status(500).json({ success: false, message: 'Failed to approve repayment' })
    }
}

// get repayments for a loan
exports.getRepayments = async (req, res) => {
    try {
        const loanId = req.params.id
        const [rows] = await pool.query(
            `SELECT lr.*, u.full_name as member_name
             FROM loan_repayments lr
             JOIN users u ON u.id = lr.member_id
             WHERE lr.loan_id = ?
             ORDER BY lr.created_at DESC`,
            [loanId]
        )
        res.json({ success: true, repayments: rows })
    } catch (err) {
        console.log('getRepayments err', err)
        res.status(500).json({ success: false, message: 'Failed' })
    }
}
