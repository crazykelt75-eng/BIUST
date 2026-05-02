import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import '../styles/design.css'
import '../styles/Setup.css'

// shown after login when user has no group yet
export default function Setup() {
  const navigate = useNavigate()
  const { createGroup, joinGroup } = useApp()

  const [tab, setTab] = useState('create')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)

  const [groupName, setGroupName] = useState('')
  const [description, setDescription] = useState('')
  const [groupCode, setGroupCode] = useState('')

  async function handleCreate(e) {
    e.preventDefault()
    setMsg('')
    if (!groupName.trim()) { setMsg('Group name is required'); return }

    setLoading(true)
    const res = await createGroup(groupName.trim(), description.trim())
    setLoading(false)

    if (res.ok) navigate('/dashboard')
    else setMsg(res.data.message || 'Failed to create group')
  }

  async function handleJoin(e) {
    e.preventDefault()
    setMsg('')
    if (!groupCode.trim()) { setMsg('Enter the group code'); return }

    setLoading(true)
    const res = await joinGroup(groupCode.trim())
    setLoading(false)

    if (res.ok) navigate('/dashboard')
    else setMsg(res.data.message || 'Invalid group code')
  }

  return (
    <div className="setup-screen">
      <div className="setup-card">

        <div className="login-brand" style={{ justifyContent: 'center', marginBottom: 8 }}>
          <span className="login-brand-icon">👥</span>
          <span className="login-brand-text">Re-Mmogo</span>
        </div>
        <p className="login-subtitle">Create a new motshelo or join an existing one</p>

        <div className="setup-tabs">
          <button className={`setup-tab ${tab === 'create' ? 'active' : ''}`}
            onClick={() => { setTab('create'); setMsg('') }}>
            Create Group
          </button>
          <button className={`setup-tab ${tab === 'join' ? 'active' : ''}`}
            onClick={() => { setTab('join'); setMsg('') }}>
            Join Group
          </button>
        </div>

        {msg && <p className="form-msg error" style={{ marginBottom: 8 }}>{msg}</p>}

        {tab === 'create' ? (
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="form-field">
              <label className="field-label">Group Name</label>
              <input className="input-field" type="text" value={groupName}
                onChange={e => setGroupName(e.target.value)}
                placeholder="e.g Motshelo wa Botlhe" />
            </div>
            <div className="form-field">
              <label className="field-label">Description (optional)</label>
              <input className="input-field" type="text" value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Brief description" />
            </div>
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? 'Creating…' : 'Create Group'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleJoin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="form-field">
              <label className="field-label">Group Code</label>
              <input className="input-field" type="text" value={groupCode}
                onChange={e => setGroupCode(e.target.value.toUpperCase())}
                placeholder="e.g AB12CD34" maxLength={8}
                style={{ letterSpacing: '0.1em', fontWeight: 600, textAlign: 'center' }} />
            </div>
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? 'Joining…' : 'Join Group'}
            </button>
          </form>
        )}

      </div>
    </div>
  )
}
