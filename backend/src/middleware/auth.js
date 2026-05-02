const jwt = require('jsonwebtoken')

const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'No token, please login' })
    }

    const token = authHeader.split(' ')[1]

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET)
        req.user = decoded
        next()
    } catch (err) {
        console.log('token error:', err.message)
        return res.status(401).json({ success: false, message: 'Token is not valid' })
    }
}

// only signatories or admins can do approval stuff
const isSignatory = (req, res, next) => {
    if (req.user.role !== 'signatory' && req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Only signatories can do this' })
    }
    next()
}

const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Admin only' })
    }
    next()
}

module.exports = { verifyToken, isSignatory, isAdmin }
