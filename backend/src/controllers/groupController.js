const { pool } = require('../config/database')

function genCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    let code = ''
    for (let i = 0; i < 8; i++) {
        code += chars[Math.floor(Math.random() * chars.length)]
    }
    return code
}

exports.createGroup = async (req, res) => {
    const conn = await pool.getConnection()
    try {
        await conn.beginTransaction()

        const { groupName, description, monthlyContribution, interestRate } = req.body

        if (!groupName) {
            conn.release()
            return res.status(400).json({ success: false, message: 'Group name is required' })
        }

        // check user doesnt already have a group
        const [existing] = await conn.query(
            'SELECT id FROM group_members WHERE user_id = ? AND is_active = 1',
            [req.user.id]
        )
        if (existing.length > 0) {
            conn.release()
            return res.status(400).json({ success: false, message: 'You are already in a group' })
        }

        // make sure code is unique
        let code = genCode()
        let [check] = await conn.query('SELECT id FROM motshelo_groups WHERE group_code = ?', [code])
        while (check.length > 0) {
            code = genCode()
            ;[check] = await conn.query('SELECT id FROM motshelo_groups WHERE group_code = ?', [code])
        }

        const monthly = monthlyContribution || 1000.00
        const rate = interestRate || 20.00

        const [gResult] = await conn.query(
            'INSERT INTO motshelo_groups (group_name, group_code, description, monthly_contribution, interest_rate, created_by) VALUES (?, ?, ?, ?, ?, ?)',
            [groupName, code, description || '', monthly, rate, req.user.id]
        )

        const gId = gResult.insertId

        // creator becomes admin
        await conn.query(
            'INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)',
            [gId, req.user.id, 'admin']
        )

        await conn.commit()
        conn.release()

        res.status(201).json({
            success: true,
            message: 'Group created!',
            group: { id: gId, groupName, groupCode: code, monthlyContribution: monthly, interestRate: rate }
        })
    } catch (err) {
        await conn.rollback()
        conn.release()
        console.log('createGroup error', err)
        res.status(500).json({ success: false, message: 'Failed to create group' })
    }
}

exports.joinGroup = async (req, res) => {
    try {
        const { groupCode } = req.body
        if (!groupCode) {
            return res.status(400).json({ success: false, message: 'Group code required' })
        }

        const [groups] = await pool.query(
            'SELECT * FROM motshelo_groups WHERE group_code = ? AND is_active = 1',
            [groupCode.toUpperCase()]
        )
        if (groups.length === 0) {
            return res.status(404).json({ success: false, message: 'Invalid group code' })
        }

        const grp = groups[0]

        const [already] = await pool.query(
            'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
            [grp.id, req.user.id]
        )
        if (already.length > 0) {
            return res.status(409).json({ success: false, message: 'Already in this group' })
        }

        await pool.query(
            'INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)',
            [grp.id, req.user.id, 'member']
        )

        res.json({
            success: true,
            message: 'Joined group!',
            group: { id: grp.id, groupName: grp.group_name, groupCode: grp.group_code }
        })
    } catch (err) {
        console.log('joinGroup error', err)
        res.status(500).json({ success: false, message: 'Failed to join group' })
    }
}

exports.getMyGroup = async (req, res) => {
    try {
        const gId = req.user.groupId
        if (!gId) {
            return res.status(404).json({ success: false, message: 'You are not in a group yet' })
        }

        const [rows] = await pool.query('SELECT * FROM motshelo_groups WHERE id = ?', [gId])
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Group not found' })
        }

        const g = rows[0]

        const [cnt] = await pool.query(
            'SELECT COUNT(*) as total FROM group_members WHERE group_id = ? AND is_active = 1',
            [gId]
        )

        res.json({
            success: true,
            group: {
                id: g.id,
                groupName: g.group_name,
                groupCode: g.group_code,
                description: g.description,
                monthlyContribution: g.monthly_contribution,
                interestRate: g.interest_rate,
                targetInterest: g.target_interest,
                memberCount: cnt[0].total,
                createdAt: g.created_at
            }
        })
    } catch (err) {
        console.log('getMyGroup error', err)
        res.status(500).json({ success: false, message: 'Failed to get group' })
    }
}
