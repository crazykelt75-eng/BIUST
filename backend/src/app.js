const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const app = express();

// Middleware
app.use(helmet());
// allow vercel + local dev
const allowedOrigins = process.env.CLIENT_URL
    ? [process.env.CLIENT_URL]
    : ['http://localhost:5173', 'http://localhost:3000']

app.use(cors({
    origin: function(origin, cb) {
        // allow no-origin requests (mobile, curl, render health checks)
        if (!origin) return cb(null, true)
        if (allowedOrigins.some(o => origin === o || origin.endsWith('.vercel.app'))) {
            return cb(null, true)
        }
        cb(new Error('CORS not allowed: ' + origin))
    },
    credentials: true
}));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', require('./routes/authRoutes'))
app.use('/api/groups', require('./routes/groupRoutes'))
app.use('/api/members', require('./routes/memberRoutes'))
app.use('/api/contributions', require('./routes/contributionRoutes'))
app.use('/api/loans', require('./routes/loanRoutes'))
app.use('/api/reports', require('./routes/reportRoutes'))

// Test route
app.get('/api/test', (req, res) => {
    res.json({ 
        success: true,
        message: 'Re-Mmogo API is running! 🎉',
        timestamp: new Date().toISOString()
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({ 
        message: 'Welcome to Re-Mmogo API',
        version: '1.0.0',
        endpoints: {
            health: '/health',
            test: '/api/test'
        }
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ 
        success: false, 
        message: 'Route not found' 
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ 
        success: false, 
        message: 'Something went wrong!',
        error: process.env.NODE_ENV === 'development' ? err.message : {}
    });
});

module.exports = app;
