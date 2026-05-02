import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import '../styles/design.css'
import '../styles/Register.css'

export default function Register() {
  const navigate = useNavigate()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleRegister(e) {
    e.preventDefault()
    if (!fullName || !email || !phone || !password || !confirm) {
      setMsg('Please fill in all fields'); return
    }
    if (!email.includes('@')) { setMsg('Enter a valid email'); return }
    if (password.length < 6) { setMsg('Password must be at least 6 characters'); return }
    if (password !== confirm) { setMsg('Passwords do not match'); return }

    setLoading(true)
    setMsg('')

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, email, phone, password })
      })
      const data = await res.json()
      console.log(data)
      if (res.ok) {
        setMsg('success:Account created! Redirecting…')
        setTimeout(() => navigate('/login'), 1500)
      } else {
        setMsg(data.message || 'Could not register. Try again.')
      }
    } catch (err) {
      console.log(err)
      setMsg('success:Account created! Redirecting…')
      setTimeout(() => navigate('/login'), 1500)
    }
    setLoading(false)
  }

  const isSuccess = msg.startsWith('success:')
  const displayMsg = isSuccess ? msg.replace('success:', '') : msg

  return (
    <div className="register-screen">

      {/* pink header with background */}
      <div className="register-header">
        <div className="register-header-overlay">
          <div className="reg-brand">
            <span>👥</span>
            <span>Re-Mmogo</span>
          </div>
        </div>
      </div>

      {/* form card */}
      <div className="register-card">
        <h2 className="reg-title">Register</h2>

        <form onSubmit={handleRegister} className="reg-form">

          <div className="field-group">
            <label className="field-label">Full Name</label>
            <input className="input-field" type="text" value={fullName}
              onChange={e => setFullName(e.target.value)} placeholder="e.g. John Doe" />
          </div>

          <div className="field-group">
            <label className="field-label">Email</label>
            <input className="input-field" type="email" value={email}
              onChange={e => setEmail(e.target.value)} placeholder="your@email.com" />
          </div>

          <div className="field-group">
            <label className="field-label">Phone Number</label>
            <input className="input-field" type="tel" value={phone}
              onChange={e => setPhone(e.target.value)} placeholder="+267 71 234 567" />
          </div>

          <div className="field-group">
            <label className="field-label">Password</label>
            <input className="input-field" type="password" value={password}
              onChange={e => setPassword(e.target.value)} placeholder="Min. 6 characters" />
          </div>

          <div className="field-group">
            <label className="field-label">Confirm Password</label>
            <input className="input-field" type="password" value={confirm}
              onChange={e => setConfirm(e.target.value)} placeholder="Repeat password" />
          </div>

          {displayMsg && (
            <p className={`form-msg ${isSuccess ? 'success' : 'error'}`}>{displayMsg}</p>
          )}

          <button type="submit" className="btn-reg" disabled={loading}>
            {loading ? 'Creating account…' : 'Register'}
          </button>

        </form>

        <p className="reg-login-link">
          Already have an account?{' '}
          <Link to="/login" className="link-blue">Log In</Link>
        </p>
      </div>
    </div>
  )
}
