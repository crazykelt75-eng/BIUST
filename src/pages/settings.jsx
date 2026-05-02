import { useState } from 'react'
import { useApp } from '../context/AppContext'
import '../styles/design.css'
import '../styles/Settings.css'

export default function Settings() {
  const { user, apiFetch, logout } = useApp()

  const [name, setName] = useState(user?.fullName || '')
  const [phone, setPhone] = useState(user?.phone || '')
  const [oldPass, setOldPass] = useState('')
  const [newPass, setNewPass] = useState('')
  const [msg, setMsg] = useState('')
  const [msgType, setMsgType] = useState('success')
  const [saving, setSaving] = useState(false)

  // flash a message then clear it
  function flash(text, type = 'success') {
    setMsg(text)
    setMsgType(type)
    setTimeout(() => setMsg(''), 3000)
  }

  async function saveProfile(e) {
    e.preventDefault()
    if (!name.trim()) { flash('Name is required', 'error'); return }

    setSaving(true)
    const res = await apiFetch('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify({ name: name.trim(), phone: phone.trim() })
    })
    setSaving(false)

    if (res.ok) flash('Profile updated')
    else flash(res.data.message || 'Could not save', 'error')
  }

  async function changePassword(e) {
    e.preventDefault()
    if (!oldPass || !newPass) { flash('Fill in both password fields', 'error'); return }
    if (newPass.length < 6) { flash('New password needs 6+ characters', 'error'); return }

    setSaving(true)
    const res = await apiFetch('/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ oldPassword: oldPass, newPassword: newPass })
    })
    setSaving(false)

    if (res.ok) {
      flash('Password changed')
      setOldPass('')
      setNewPass('')
    } else {
      flash(res.data.message || 'Could not change password', 'error')
    }
  }

  const initials = (user?.fullName || 'U').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)

  return (
    <div className="settings-page">

      {msg && (
        <p className={`form-msg ${msgType}`} onClick={() => setMsg('')}>{msg}</p>
      )}

      {/* profile section */}
      <div className="card">
        <h3 className="section-title">My Profile</h3>

        <div className="settings-avatar">
          <div className="s-avatar">{initials}</div>
          <div>
            <p className="s-name">{user?.fullName}</p>
            <span className={`badge badge-${user?.role}`}>{user?.role}</span>
          </div>
        </div>

        <form onSubmit={saveProfile} className="settings-form">
          <div className="form-row-2">
            <div className="form-field">
              <label className="field-label">Full Name</label>
              <input className="input-field" value={name}
                onChange={e => setName(e.target.value)} placeholder="Your name" />
            </div>
            <div className="form-field">
              <label className="field-label">Phone</label>
              <input className="input-field" type="tel" value={phone}
                onChange={e => setPhone(e.target.value)} placeholder="+267 7x xxx xxx" />
            </div>
          </div>
          <div className="form-field">
            <label className="field-label">Email</label>
            <input className="input-field" value={user?.email || ''} disabled style={{ opacity: .6 }} />
            <p className="field-hint">email cant be changed</p>
          </div>
          <button className="btn-primary" type="submit" disabled={saving}
            style={{ alignSelf: 'flex-start', width: 'auto', padding: '10px 24px' }}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </form>
      </div>

      {/* change password */}
      <div className="card">
        <h3 className="section-title">Change Password</h3>
        <form onSubmit={changePassword} className="settings-form">
          <div className="form-field">
            <label className="field-label">Current Password</label>
            <input className="input-field" type="password" value={oldPass}
              onChange={e => setOldPass(e.target.value)} placeholder="••••••••" />
          </div>
          <div className="form-field">
            <label className="field-label">New Password</label>
            <input className="input-field" type="password" value={newPass}
              onChange={e => setNewPass(e.target.value)} placeholder="Min 6 characters" />
          </div>
          <button className="btn-primary" type="submit" disabled={saving}
            style={{ alignSelf: 'flex-start', width: 'auto', padding: '10px 24px' }}>
            {saving ? 'Updating…' : 'Update Password'}
          </button>
        </form>
      </div>

      {/* group info - read only */}
      <div className="card">
        <h3 className="section-title">Group Info</h3>
        <div className="settings-info-list">
          <div className="s-info-row">
            <span className="s-info-label">Group</span>
            <span className="s-info-val">{user?.groupName || 'No group'}</span>
          </div>
          <div className="s-info-row">
            <span className="s-info-label">Your role</span>
            <span className="s-info-val" style={{ textTransform: 'capitalize' }}>{user?.role}</span>
          </div>
          <div className="s-info-row">
            <span className="s-info-label">Interest rate</span>
            <span className="s-info-val">20% / month</span>
          </div>
          <div className="s-info-row">
            <span className="s-info-label">Year-end target</span>
            <span className="s-info-val">P5 000 interest</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="section-title">Account</h3>
        <button className="btn-danger" onClick={logout}>Log Out</button>
      </div>

    </div>
  )
}
