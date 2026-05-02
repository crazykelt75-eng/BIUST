import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import '../styles/design.css'
import '../styles/LoanApplication.css'

export default function LoanApplication() {
  const navigate = useNavigate()
  const { apiFetch, fetchLoans } = useApp()

  const [amount, setAmount]   = useState('')
  const [term, setTerm]       = useState('')
  const [purpose, setPurpose] = useState('')
  const [msg, setMsg]         = useState('')
  const [loading, setLoading] = useState(false)

  // calculator state
  const [calcAmt, setCalcAmt]   = useState('')
  const [calcTerm, setCalcTerm] = useState('')
  const [calc, setCalc]         = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()

    if (!amount || !term || !purpose) {
      setMsg('Please fill in all fields')
      return
    }
    if (Number(amount) <= 0) {
      setMsg('Enter a valid amount')
      return
    }

    setLoading(true)
    setMsg('')

    const months = parseInt(term) || 6
    const due = new Date()
    due.setMonth(due.getMonth() + months)
    const dueDate = due.toISOString().split('T')[0]

    const res = await apiFetch('/loans', {
      method: 'POST',
      body: JSON.stringify({
        principalAmount: Number(amount),
        purpose,
        termMonths: months,
        dueDate
      })
    })

    setLoading(false)

    if (res.ok) {
      fetchLoans(true)
      navigate('/loans')
    } else {
      setMsg(res.data.message || 'Could not submit application')
    }
  }

  function doCalc() {
    const p = Number(calcAmt)
    const m = Number(calcTerm)
    if (!p || !m) return

    const interest = p * 0.2 * m
    const total    = p + interest
    const monthly  = total / m

    setCalc({ interest, total, monthly })
  }

  return (
    <div className="loan-app-page">

      <div className="loan-app-header">
        <button className="btn-ghost" onClick={() => navigate('/loans')}
          style={{ width: 'auto', padding: '8px 16px' }}>← Back</button>
        <h3 style={{ margin: 0 }}>Apply for a Loan</h3>
      </div>

      <div className="loan-app-body">

        {/* application form */}
        <div className="card">
          <h3 className="section-title">Loan Application</h3>
          <p style={{ fontSize: 13, color: 'var(--text-sub)', marginBottom: 16 }}>
            Your request will be reviewed by group signatories.
          </p>

          {msg && <p className="form-msg error" style={{ marginBottom: 12 }}>{msg}</p>}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="form-field">
              <label className="field-label">Amount (BWP)</label>
              <input className="input-field" type="number"
                value={amount} onChange={e => setAmount(e.target.value)}
                placeholder="e.g 5000" min="1" />
            </div>

            <div className="form-field">
              <label className="field-label">Term (months)</label>
              <input className="input-field" type="number"
                value={term} onChange={e => setTerm(e.target.value)}
                placeholder="e.g 6" min="1" max="24" />
            </div>

            <div className="form-field">
              <label className="field-label">Purpose / Reason</label>
              <input className="input-field" type="text"
                value={purpose} onChange={e => setPurpose(e.target.value)}
                placeholder="e.g School fees" />
            </div>

            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? 'Submitting…' : 'Submit Application'}
            </button>
          </form>
        </div>

        {/* calculator */}
        <div className="card">
          <h3 className="section-title">Interest Calculator</h3>
          <p style={{ fontSize: 13, color: 'var(--text-sub)', marginBottom: 16 }}>
            Estimate your repayments at 20% per month.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="form-field">
              <label className="field-label">Loan Amount</label>
              <input className="input-field" type="number"
                value={calcAmt} onChange={e => setCalcAmt(e.target.value)}
                placeholder="e.g 5000" />
            </div>

            <div className="form-field">
              <label className="field-label">Term (months)</label>
              <input className="input-field" type="number"
                value={calcTerm} onChange={e => setCalcTerm(e.target.value)}
                placeholder="e.g 6" />
            </div>

            <button className="btn-secondary" type="button" onClick={doCalc}>Calculate</button>
          </div>

          {calc && (
            <div className="calc-results">
              <div className="calc-row">
                <span>Interest (20%/mo)</span>
                <span>P{calc.interest.toFixed(2)}</span>
              </div>
              <div className="calc-row">
                <span>Monthly repayment</span>
                <span>P{calc.monthly.toFixed(2)}</span>
              </div>
              <div className="calc-row calc-total">
                <span>Total repayment</span>
                <span>P{calc.total.toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
