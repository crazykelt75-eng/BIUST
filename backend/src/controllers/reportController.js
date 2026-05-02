const { pool } = require('../config/database')

// year end report - shows contributions, loans, interest per member
exports.getYearEndReport = async (req, res) => {
    try {
        const gId = req.user.groupId
        if (!gId) return res.status(400).json({ success: false, message: 'Not in a group' })

        const year = req.query.year || new Date().getFullYear()

        // get all members
        const [members] = await pool.query(
            `SELECT u.id, u.full_name FROM group_members gm
             JOIN users u ON u.id = gm.user_id
             WHERE gm.group_id = ? AND gm.is_active = 1`,
            [gId]
        )

        // contributions for this year (approved only)
        const [contribs] = await pool.query(
            `SELECT member_id, SUM(amount) as total
             FROM contributions
             WHERE group_id = ? AND status = 'approved' AND YEAR(month_year) = ?
             GROUP BY member_id`,
            [gId, year]
        )

        // approved loans this year
        const [loans] = await pool.query(
            `SELECT member_id, SUM(principal_amount) as total
             FROM loans
             WHERE group_id = ? AND status IN ('active', 'paid') AND YEAR(loan_date) = ?
             GROUP BY member_id`,
            [gId, year]
        )

        // approved repayments - to figure out interest paid
        // interest = total repaid - principal paid off
        const [repayments] = await pool.query(
            `SELECT lr.member_id, SUM(lr.amount) as total_repaid, l.principal_amount
             FROM loan_repayments lr
             JOIN loans l ON l.id = lr.loan_id
             WHERE l.group_id = ? AND lr.status = 'approved' AND YEAR(lr.payment_date) = ?
             GROUP BY lr.member_id, l.principal_amount`,
            [gId, year]
        )

        // build maps for quick lookup
        const contribMap = {}
        contribs.forEach(c => { contribMap[c.member_id] = parseFloat(c.total) })

        const loanMap = {}
        loans.forEach(l => { loanMap[l.member_id] = parseFloat(l.total) })

        const repayMap = {}
        repayments.forEach(r => {
            if (!repayMap[r.member_id]) repayMap[r.member_id] = 0
            // simple estimate: 20% of what they repaid is interest
            repayMap[r.member_id] += parseFloat(r.total_repaid) * 0.1667
        })

        const reportData = members.map(m => {
            const contributions = contribMap[m.id] || 0
            const loans = loanMap[m.id] || 0
            const interest = parseFloat((repayMap[m.id] || 0).toFixed(2))
            return {
                id: m.id,
                name: m.full_name,
                contributions,
                loans,
                interest
            }
        })

        // totals
        const totalContrib = reportData.reduce((s, m) => s + m.contributions, 0)
        const totalLoans = reportData.reduce((s, m) => s + m.loans, 0)
        const totalInterest = reportData.reduce((s, m) => s + m.interest, 0)

        // find highest/lowest interest earner
        const sorted = [...reportData].sort((a, b) => b.interest - a.interest)
        const highest = sorted[0] || null
        const lowest = sorted[sorted.length - 1] || null

        // flag anyone who hasnt reached P5000 interest target
        const TARGET = 5000
        reportData.forEach(m => {
            m.metTarget = m.interest >= TARGET
        })

        res.json({
            success: true,
            report: {
                year,
                groupId: gId,
                members: reportData,
                totals: { totalContrib, totalLoans, totalInterest },
                highlights: { highest, lowest },
                avgPayout: reportData.length > 0
                    ? parseFloat(((totalContrib + totalInterest - totalLoans) / reportData.length).toFixed(2))
                    : 0
            }
        })
    } catch (err) {
        console.log('yearEndReport err', err)
        res.status(500).json({ success: false, message: 'Failed to generate report' })
    }
}
