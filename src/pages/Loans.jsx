import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import '../styles/design.css'
import '../styles/Loans.css'

export default function Loans() {
  const navigate = useNavigate()
  const { loans, fetchLoans, apiFetch } = useApp()

  const [repaying, setRepaying] = useState(null) // loan id
  const [repayAmount, setRepayAmount] = useState('')
  const [repayRef, setRepayRef] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => { fetchLoans(true) }, [])

  const active = loans.filter(l => ['active', 'pending', 'approved'].includes(l.status))
  const history = loans.filter(l => ['paid', 'rejected'].includes(l.status))

  async function submitRepayment(loanId) {
    if (!repayAmount || Number(repayAmount) <= 0) { setMsg('Enter a valid amount'); return }
    setLoading(true); setMsg('')
    const { ok, data } = await apiFetch(`/loans/${loanId}/repayments`, {
      method: 'POST',
      body: JSON.stringify({ amount: Number(repayAmount), paymentReference: repayRef })
    })
    if (ok) {
      setMsg('success:Repayment submitted! Awaiting approval.')
      setRepaying(null); setRepayAmount(''); setRepayRef('')
      fetchLoans(true)
    } else {
      setMsg(data.message || 'Could not submit repayment')
    }
    setLoading(false)
  }

  const isSuccess = msg.startsWith('success:')

  return (
    <div className="loans-page">

      {/* header action */}
      <div className="loans-top">
        <p className="loans-sub">Apply for loans and track your repayments.</p>
        <button className="btn-apply-loan" onClick={() => navigate('/loans/apply')}>+ Apply for Loan</button>
      </div>

      {msg && (
        <p className={`form-msg ${isSuccess ? 'success' : 'error'}`} style={{ marginBottom: 8 }}>
          {msg.replace('success:', '')}
        </p>
      )}

      {/* active loans */}
      <div className="card">
        <h3 className="section-title">Active Loans</h3>
        {active.length === 0 ? (
          <p className="empty-note">No active loans. Click "Apply for Loan" to get started.</p>
        ) : (
          <div className="loan-cards">
            {active.map(loan => (
              <div className="loan-card" key={loan.id}>
                <div className="loan-card-top">
                  <div>
                    <p className="loan-purpose">{loan.purpose || 'General loan'}</p>
                    <p className="loan-amount">P{Number(loan.principalAmount || loan.principal_amount).toLocaleString()}</p>
                  </div>
                  <span className={`badge badge-${loan.status}`}>{loan.status}</span>
                </div>

                <div className="loan-meta">
                  <div className="loan-meta-row">
                    <span>Balance remaining</span>
                    <span className="loan-balance">P{Number(loan.outstandingBalance || loan.outstanding_balance).toLocaleString()}</span>
                  </div>
                  <div className="loan-meta-row">
                    <span>Interest (20%/mo)</span>
                    <span>P{Number(loan.interestAccrued || loan.interest_accrued || 0).toLocaleString()}</span>
                  </div>
                  <div className="loan-meta-row">
                    <span>Due date</span>
                    <span>{loan.dueDate || loan.due_date || '—'}</span>
                  </div>
                </div>

                {loan.status === 'active' && (
                  repaying === loan.id ? (
                    <div className="repay-form">
                      <input className="input-field" type="number" value={repayAmount}
                        onChange={e => setRepayAmount(e.target.value)} placeholder="Amount (BWP)" />
                      <input className="input-field" type="text" value={repayRef}
                        onChange={e => setRepayRef(e.target.value)} placeholder="Payment reference" />
                      <div className="repay-actions">
                        <button className="btn-primary" style={{ flex: 1 }}
                          onClick={() => submitRepayment(loan.id)} disabled={loading}>
                          {loading ? 'Submitting…' : 'Submit Repayment'}
                        </button>
                        <button className="btn-ghost" style={{ flex: 1 }}
                          onClick={() => { setRepaying(null); setMsg('') }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button className="btn-repay" onClick={() => { setRepaying(loan.id); setMsg('') }}>
                      Make Repayment
                    </button>
                  )
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* loan history */}
      {history.length > 0 && (
        <div className="card">
          <h3 className="section-title">Loan History</h3>
          <div className="contrib-table-wrap">
            <table className="contrib-table">
              <thead>
                <tr><th>Purpose</th><th>Amount</th><th>Due</th><th>Status</th></tr>
              </thead>
              <tbody>
                {history.map(l => (
                  <tr key={l.id}>
                    <td>{l.purpose || '—'}</td>
                    <td>P{Number(l.principalAmount || l.principal_amount).toLocaleString()}</td>
                    <td>{l.dueDate || l.due_date || '—'}</td>
                    <td><span className={`badge badge-${l.status}`}>{l.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  )
}
