import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import '../styles/design.css'
import '../styles/Login.css'

export default function Login() {
  const navigate = useNavigate()
  const { login } = useApp()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setMsg('')
    if (!email || !password) { setMsg('Please fill in all fields'); return }

    setLoading(true)
    const { ok, data } = await login(email, password)
    if (ok) {
      navigate(data.user.groupId ? '/dashboard' : '/setup')
    } else {
      setMsg(data.message || 'Login failed. Check your credentials.')
    }
    setLoading(false)
  }

  return (
    <div className="login-screen">
      <div className="login-card">

        {/* branding row */}
        <div className="login-brand">
          <span className="login-brand-icon">👥</span>
          <span className="login-brand-text">Welcome Back!</span>
        </div>

        {/* avatar illustration */}
        <div className="login-avatar">
          <div className="avatar-circle">
            <span className="avatar-emoji">🧑‍💼</span>
          </div>
        </div>

        <p className="login-subtitle">Enter your credentials to access your account</p>

        <form onSubmit={handleLogin} className="login-form">
          <div className="field-group">
            <label className="field-label">Email Address</label>
            <input
              className="input-field"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Enter your email"
            />
          </div>

          <div className="field-group">
            <label className="field-label">Password</label>
            <input
              className="input-field"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter your password"
            />
            <div className="login-forgot-row">
              <Link to="#" className="login-forgot">forgot password?</Link>
            </div>
          </div>

          <div className="login-remember">
            <input
              type="checkbox"
              id="remember"
              checked={remember}
              onChange={e => setRemember(e.target.checked)}
            />
            <label htmlFor="remember">Remember for 30 days</label>
          </div>

          {msg && <p className="form-msg error">{msg}</p>}

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Logging in…' : 'Log In'}
          </button>
        </form>

        <div className="or-divider">Or</div>

        <button className="btn-social">
          <img src="https://www.google.com/favicon.ico" alt="" width="18" height="18" />
          Sign in with Google
        </button>

        <button className="btn-social" style={{ marginTop: 10 }}>
          <span style={{ fontSize: 18 }}>🍎</span>
          Sign in with Apple
        </button>

        <p className="login-register-link">
          Don't have an account?{' '}
          <Link to="/register" className="link-blue">Register</Link>
        </p>

        <div className="login-footer-brand">
          <span>👥</span>
          <span>Re-Mmogo</span>
        </div>
      </div>
    </div>
  )
}
