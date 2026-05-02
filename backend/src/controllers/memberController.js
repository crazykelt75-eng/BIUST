const { pool } = require('../config/database')

// list all members in my group
exports.getMembers = async (req, res) => {
    try {
        const gId = req.user.groupId
        if (!gId) {
            return res.status(400).json({ success: false, message: 'Not in a group' })
        }

        const [rows] = await pool.query(
            `SELECT u.id, u.full_name, u.email, u.phone, gm.role, gm.joined_at, gm.is_active
             FROM group_members gm
             JOIN users u ON u.id = gm.user_id
             WHERE gm.group_id = ?
             ORDER BY gm.joined_at ASC`,
            [gId]
        )

        const members = rows.map(r => ({
            id: r.id,
            fullName: r.full_name,
            email: r.email,
            phone: r.phone,
            role: r.role,
            joinedAt: r.joined_at,
            isActive: r.is_active
        }))

        res.json({ success: true, members })
    } catch (err) {
        console.log('getMembers error', err)
        res.status(500).json({ success: false, message: 'Failed to get members' })
    }
}

// signatory adds a new member by email
exports.enrollMember = async (req, res) => {
    try {
        const gId = req.user.groupId
        const { email, role } = req.body

        if (!email) {
            return res.status(400).json({ success: false, message: 'Email is required' })
        }

        const memberRole = role || 'member'

        // find the user by email
        const [users] = await pool.query('SELECT id, full_name FROM users WHERE email = ?', [email])
        if (users.length === 0) {
            return res.status(404).json({ success: false, message: 'No user found with that email. They need to register first.' })
        }

        const u = users[0]

        // check not already in the group
        const [already] = await pool.query(
            'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?',
            [gId, u.id]
        )
        if (already.length > 0) {
            return res.status(409).json({ success: false, message: 'That person is already in your group' })
        }

        // only 2 signatories allowed
        if (memberRole === 'signatory') {
            const [sigs] = await pool.query(
                "SELECT COUNT(*) as cnt FROM group_members WHERE group_id = ? AND role = 'signatory' AND is_active = 1",
                [gId]
            )
            if (sigs[0].cnt >= 2) {
                return res.status(400).json({ success: false, message: 'A group can only have 2 signatories' })
            }
        }

        await pool.query(
            'INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)',
            [gId, u.id, memberRole]
        )

        res.status(201).json({
            success: true,
            message: `${u.full_name} added as ${memberRole}`,
            member: { id: u.id, fullName: u.full_name, email, role: memberRole }
        })
    } catch (err) {
        console.log('enrollMember error', err)
        res.status(500).json({ success: false, message: 'Failed to enroll member' })
    }
}

// update a member's role (admin only)
exports.updateMemberRole = async (req, res) => {
    try {
        const gId = req.user.groupId
        const memberId = req.params.memberId
        const { role } = req.body

        if (!role) {
            return res.status(400).json({ success: false, message: 'Role is required' })
        }

        // cant change yourself
        if (parseInt(memberId) === req.user.id) {
            return res.status(400).json({ success: false, message: "Can't change your own role" })
        }

        if (role === 'signatory') {
            const [sigs] = await pool.query(
                "SELECT COUNT(*) as cnt FROM group_members WHERE group_id = ? AND role = 'signatory' AND user_id != ? AND is_active = 1",
                [gId, memberId]
            )
            if (sigs[0].cnt >= 2) {
                return res.status(400).json({ success: false, message: 'Already have 2 signatories' })
            }
        }

        await pool.query(
            'UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?',
            [role, gId, memberId]
        )

        res.json({ success: true, message: 'Role updated' })
    } catch (err) {
        console.log('updateRole error', err)
        res.status(500).json({ success: false, message: 'Failed to update role' })
    }
}
