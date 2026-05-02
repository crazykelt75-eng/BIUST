import React, { useEffect, useState } from 'react'
import { useApp } from '../context/AppContext'
import '../styles/Members.css'

export default function MembersPage() {
    const { apiFetch, user } = useApp()
    const [members, setMembers] = useState([])
    const [showForm, setShowForm] = useState(false)
    const [email, setEmail] = useState('')
    const [role, setRole] = useState('member')
    const [msg, setMsg] = useState('')
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        loadMembers()
    }, [])

    async function loadMembers() {
        const { ok, data } = await apiFetch('/members')
        if (ok) setMembers(data.members)
    }

    async function handleEnroll(e) {
        e.preventDefault()
        setMsg('')
        if (!email) {
            setMsg('Email is required')
            return
        }
        setLoading(true)
        const { ok, data } = await apiFetch('/members', {
            method: 'POST',
            body: JSON.stringify({ email, role })
        })
        if (ok) {
            setMsg(data.message)
            setEmail('')
            setRole('member')
            setShowForm(false)
            loadMembers()
        } else {
            setMsg(data.message || 'Failed to add member')
        }
        setLoading(false)
    }

    const canAdd = user && (user.role === 'signatory' || user.role === 'admin')

    return (
        <div className="members-page">
            <div className="topbar">
                <button className="menu-btn">&#9776;</button>
                <h2>👥 Members</h2>
            </div>

            <div className="content">
                <p className="intro">Manage your group members.</p>

                {canAdd && (
                    <button className="btn-add" onClick={() => setShowForm(!showForm)}>
                        {showForm ? 'Cancel' : '+ Add Member'}
                    </button>
                )}

                {showForm && (
                    <form onSubmit={handleEnroll} className="enroll-form">
                        <h4>Enroll New Member</h4>

                        <label>Member Email (they must have registered already)</label>
                        <input
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            placeholder="member@email.com"
                        />

                        <label>Role</label>
                        <select value={role} onChange={e => setRole(e.target.value)}>
                            <option value="member">Member</option>
                            <option value="signatory">Signatory</option>
                        </select>

                        {msg && <p className="form-msg">{msg}</p>}

                        <button type="submit" disabled={loading} className="btn-submit">
                            {loading ? 'Adding...' : 'Add Member'}
                        </button>
                    </form>
                )}

                {msg && !showForm && <p className="form-msg">{msg}</p>}

                <div className="members-table-wrap">
                    <table className="members-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Email</th>
                                <th>Role</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {members.length === 0 ? (
                                <tr><td colSpan={4} style={{ textAlign: 'center', padding: '20px' }}>No members yet</td></tr>
                            ) : (
                                members.map(m => (
                                    <tr key={m.id}>
                                        <td>{m.fullName}</td>
                                        <td className="email-cell">{m.email}</td>
                                        <td style={{ textTransform: 'capitalize' }}>{m.role}</td>
                                        <td>{m.isActive ? <span className="check">✅ Active</span> : <span>Inactive</span>}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
