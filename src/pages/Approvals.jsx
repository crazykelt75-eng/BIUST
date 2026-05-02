import React, { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import '../styles/design.css'
import '../styles/Approvals.css'

export default function Approvals() {
  const { apiFetch, user } = useApp()

  const [contributions, setContributions] = useState([])
  const [loans, setLoans] = useState([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')

  useEffect(() => { loadPending() }, [])

  async function loadPending() {
    setLoading(true)
    try {
      const [cRes, lRes] = await Promise.all([apiFetch('/contributions'), apiFetch('/loans')])
      if (cRes.ok) setContributions(cRes.data.contributions.filter(c => c.status === 'pending'))
      if (lRes.ok) setLoans(lRes.data.loans.filter(l => l.status === 'pending'))
    } catch (err) { console.log(err) }
    setLoading(false)
  }

  async function act(url) {
    const { ok, data } = await apiFetch(url, { method: 'PUT' })
    setMsg(data.message || (ok ? 'Done' : 'Error'))
    if (ok) loadPending()
    setTimeout(() => setMsg(''), 3000)
  }

  if (user?.role === 'member') {
    return (
      <div className="approvals-page">
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ fontSize: 32, marginBottom: 12 }}>🔒</p>
          <p style={{ color: 'var(--text-sub)', fontSize: 14 }}>Only signatories and admins can approve items.</p>
        </div>
      </div>
    )
  }

  const totalPending = contributions.length + loans.length

  return (
    <div className="approvals-page">

      {msg && (
        <p className={`form-msg ${msg.includes('approved') || msg.includes('Done') ? 'success' : 'error'}`}
          onClick={() => setMsg('')}>{msg}</p>
      )}

      {/* summary bar */}
      <div className="card approvals-summary">
        <div className="appr-sum-item">
          <span className="appr-sum-num">{totalPending}</span>
          <span className="appr-sum-label">Total Pending</span>
        </div>
        <div className="appr-sum-item">
          <span className="appr-sum-num">{contributions.length}</span>
          <span className="appr-sum-label">Contributions</span>
        </div>
        <div className="appr-sum-item">
          <span className="appr-sum-num">{loans.length}</span>
          <span className="appr-sum-label">Loan Requests</span>
        </div>
      </div>

      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: 32, color: 'var(--text-sub)' }}>Loading…</div>
      ) : (
        <>
          {/* pending contributions */}
          <div className="card">
            <h3 className="section-title">Pending Contributions</h3>
            {contributions.length === 0 ? (
              <p className="empty-note">No pending contributions ✓</p>
            ) : (
              <div className="approval-list">
                {contributions.map(c => (
                  <div className="approval-item" key={c.id}>
                    <div className="appr-info">
                      <p className="appr-name">{c.memberName || 'Member'}</p>
                      <p className="appr-detail">
                        <strong>P{Number(c.amount).toLocaleString()}</strong> · {c.monthYear || c.month_year} · Ref: {c.paymentReference || c.payment_reference || 'N/A'}
                      </p>
                    </div>
                    <div className="appr-actions">
                      <button className="btn-approve" onClick={() => act(`/contributions/${c.id}/approve`)}>Approve</button>
                      <button className="btn-reject"  onClick={() => act(`/contributions/${c.id}/reject`)}>Reject</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* pending loans */}
          <div className="card">
            <h3 className="section-title">Pending Loan Requests</h3>
            {loans.length === 0 ? (
              <p className="empty-note">No pending loan requests ✓</p>
            ) : (
              <div className="approval-list">
                {loans.map(l => (
                  <div className="approval-item" key={l.id}>
                    <div className="appr-info">
                      <p className="appr-name">{l.memberName || 'Member'}</p>
                      <p className="appr-detail">
                        <strong>P{Number(l.principalAmount || l.principal_amount).toLocaleString()}</strong> · {l.purpose}
                      </p>
                      {(l.approvedBy1 || l.approved_by_1) && (
                        <p className="appr-note">✅ 1 signatory approved · waiting for 2nd</p>
                      )}
                    </div>
                    <div className="appr-actions">
                      <button className="btn-approve" onClick={() => act(`/loans/${l.id}/approve`)}>Approve</button>
                      <button className="btn-reject"  onClick={() => act(`/loans/${l.id}/reject`)}>Reject</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
