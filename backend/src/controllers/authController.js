const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const { pool } = require('../config/database')

function makeToken(payload) {
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || '7d' })
}

// get user's group membership (they can only be in one group)
async function getMembership(userId) {
    const [rows] = await pool.query(
        `SELECT gm.group_id, gm.role, mg.group_name, mg.group_code
         FROM group_members gm
         JOIN motshelo_groups mg ON mg.id = gm.group_id
         WHERE gm.user_id = ? AND gm.is_active = 1
         LIMIT 1`,
        [userId]
    )
    return rows[0] || null
}

exports.register = async (req, res) => {
    try {
        const { fullName, email, phone, password } = req.body

        if (!fullName || !email || !password) {
            return res.status(400).json({ success: false, message: 'Name, email and password required' })
        }

        const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email])
        if (existing.length > 0) {
            return res.status(409).json({ success: false, message: 'Email already in use' })
        }

        const hash = await bcrypt.hash(password, 12)

        const [result] = await pool.query(
            'INSERT INTO users (full_name, email, phone, password_hash) VALUES (?, ?, ?, ?)',
            [fullName, email, phone || '', hash]
        )

        console.log('new user registered, id:', result.insertId)

        res.status(201).json({ success: true, message: 'Account created! Please log in.' })
    } catch (err) {
        console.log('register error', err)
        res.status(500).json({ success: false, message: 'Registration failed' })
    }
}

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password required' })
        }

        const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email])
        if (users.length === 0) {
            return res.status(401).json({ success: false, message: 'Wrong email or password' })
        }

        const user = users[0]
        const ok = await bcrypt.compare(password, user.password_hash)
        if (!ok) {
            return res.status(401).json({ success: false, message: 'Wrong email or password' })
        }

        const membership = await getMembership(user.id)

        const tokenData = {
            id: user.id,
            fullName: user.full_name,
            email: user.email,
            role: membership ? membership.role : 'member',
            groupId: membership ? membership.group_id : null
        }

        const token = makeToken(tokenData)

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                fullName: user.full_name,
                email: user.email,
                role: membership ? membership.role : null,
                groupId: membership ? membership.group_id : null,
                groupName: membership ? membership.group_name : null,
                groupCode: membership ? membership.group_code : null
            }
        })
    } catch (err) {
        console.log('login error', err)
        res.status(500).json({ success: false, message: 'Login failed' })
    }
}

exports.updateProfile = async (req, res) => {
    try {
        const { name, phone } = req.body
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'Name is required' })
        }
        await pool.query(
            'UPDATE users SET full_name = ?, phone = ? WHERE id = ?',
            [name.trim(), phone || '', req.user.id]
        )
        res.json({ success: true, message: 'Profile updated' })
    } catch (err) {
        console.log('updateProfile error', err)
        res.status(500).json({ success: false, message: 'Could not update profile' })
    }
}

exports.changePassword = async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body
        if (!oldPassword || !newPassword) {
            return res.status(400).json({ success: false, message: 'Both passwords required' })
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' })
        }
        const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id])
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' })

        const match = await bcrypt.compare(oldPassword, rows[0].password_hash)
        if (!match) return res.status(401).json({ success: false, message: 'Current password is incorrect' })

        const hash = await bcrypt.hash(newPassword, 12)
        await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id])
        res.json({ success: true, message: 'Password changed successfully' })
    } catch (err) {
        console.log('changePassword error', err)
        res.status(500).json({ success: false, message: 'Could not change password' })
    }
}

exports.getMe = async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, full_name, email, phone FROM users WHERE id = ?',
            [req.user.id]
        )
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' })
        }

        const u = rows[0]
        const membership = await getMembership(u.id)

        res.json({
            success: true,
            user: {
                id: u.id,
                fullName: u.full_name,
                email: u.email,
                phone: u.phone,
                role: membership ? membership.role : null,
                groupId: membership ? membership.group_id : null,
                groupName: membership ? membership.group_name : null,
                groupCode: membership ? membership.group_code : null
            }
        })
    } catch (err) {
        console.log('getMe error', err)
        res.status(500).json({ success: false, message: 'Could not get user' })
    }
}
