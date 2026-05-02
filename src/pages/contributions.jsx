import React, { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import '../styles/design.css'
import '../styles/Contributions.css'

const MONTHS = ['January','February','March','April','May','June',
  'July','August','September','October','November','December']

export default function Contributions() {
  const { contributions, fetchContributions, apiFetch } = useApp()

  const [amount, setAmount] = useState('1000')
  const [month, setMonth] = useState('')
  const [proof, setProof] = useState('')
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => { fetchContributions(true) }, [])

  const totalPaid = contributions
    .filter(c => c.status === 'approved')
    .reduce((s, c) => s + Number(c.amount), 0)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!month) { setMsg('Please select a month'); return }
    if (!amount || Number(amount) <= 0) { setMsg('Enter a valid amount'); return }
    setLoading(true); setMsg('')
    const { ok, data } = await apiFetch('/contributions', {
      method: 'POST',
      body: JSON.stringify({ amount: Number(amount), monthYear: month, paymentReference: proof })
    })
    if (ok) {
      setMsg('success:Contribution submitted! Awaiting approval.')
      setAmount('1000'); setMonth(''); setProof('')
      fetchContributions(true)
    } else {
      setMsg(data.message || 'Could not submit contribution')
    }
    setLoading(false)
  }

  const isSuccess = msg.startsWith('success:')

  return (
    <div className="contrib-page">

      {/* summary */}
      <div className="card contrib-summary">
        <p className="contrib-sum-label">Total Contributed This Year</p>
        <p className="contrib-sum-amount">P{totalPaid.toLocaleString()}.00</p>
        <p className="contrib-sum-sub">{contributions.filter(c => c.status === 'approved').length} approved payments</p>
      </div>

      {/* form card */}
      <div className="card">
        <h3 className="section-title">Record New Contribution</h3>

        <form onSubmit={handleSubmit} className="contrib-form">
          <div className="contrib-form-grid">
            <div className="field-group">
              <label className="field-label">Amount (BWP)</label>
              <input className="input-field" type="number" value={amount}
                onChange={e => setAmount(e.target.value)} placeholder="1000" />
            </div>

            <div className="field-group">
              <label className="field-label">Month</label>
              <select className="input-field" value={month} onChange={e => setMonth(e.target.value)}>
                <option value="">Select month</option>
                {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          <div className="field-group">
            <label className="field-label">Payment Reference (optional)</label>
            <input className="input-field" type="text" value={proof}
              onChange={e => setProof(e.target.value)} placeholder="e.g FNB ref 123456" />
          </div>

          {msg && (
            <p className={`form-msg ${isSuccess ? 'success' : 'error'}`}>
              {msg.replace('success:', '')}
            </p>
          )}

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Submitting…' : 'Submit Contribution'}
          </button>
        </form>
      </div>

      {/* history table */}
      <div className="card">
        <h3 className="section-title">My Contributions</h3>
        {contributions.length === 0 ? (
          <p className="empty-note">No contributions yet.</p>
        ) : (
          <div className="contrib-table-wrap">
            <table className="contrib-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Amount</th>
                  <th>Reference</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {contributions.map(c => (
                  <tr key={c.id}>
                    <td>{c.monthYear || c.month_year || '—'}</td>
                    <td>P{Number(c.amount).toLocaleString()}</td>
                    <td className="ref-td">{c.paymentReference || c.payment_reference || '—'}</td>
                    <td><span className={`badge badge-${c.status}`}>{c.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )
}
