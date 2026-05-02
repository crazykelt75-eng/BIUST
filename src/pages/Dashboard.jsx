import React, { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import '../styles/design.css'
import '../styles/Dashboard.css'

export default function Dashboard() {
  const navigate = useNavigate()
  const { user, loans, contributions, activity, fetchLoans, fetchContributions } = useApp()

  useEffect(() => {
    fetchLoans()
    fetchContributions()
  }, [])

  const totalContributions = contributions
    .filter(c => c.status === 'approved')
    .reduce((sum, c) => sum + Number(c.amount), 0)

  const activeLoans = loans.filter(l => l.status === 'active' || l.status === 'approved').length
  const pendingApprovals =
    loans.filter(l => l.status === 'pending').length +
    contributions.filter(c => c.status === 'pending').length

  const target = 100000
  const pct = Math.min(Math.round((totalContributions / target) * 100), 100)

  const today = new Date()
  const dateStr = today.getDate() + ' ' +
    ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][today.getMonth()] +
    ' ' + today.getFullYear()

  function icon(type) {
    if (type === 'contribution') return '💵'
    if (type === 'loan') return '💰'
    if (type === 'member') return '👤'
    return '📌'
  }

  return (
    <div className="dash">

      {/* welcome row */}
      <div className="dash-welcome">
        <div>
          <h2 className="dash-greeting">Welcome back{user?.fullName ? `, ${user.fullName.split(' ')[0]}` : ''}!</h2>
          <p className="dash-date">📅 {dateStr}</p>
        </div>
      </div>

      {/* stat cards */}
      <div className="dash-stats">
        <div className="stat-card">
          <p className="stat-label">Total Contributions</p>
          <p className="stat-value">P{totalContributions.toLocaleString()}.00</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Active Loans</p>
          <p className="stat-value">{activeLoans}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Pending Approvals</p>
          <p className="stat-value">{pendingApprovals}</p>
        </div>
      </div>

      {/* savings progress */}
      <div className="card dash-section">
        <h3 className="section-title">Savings Target</h3>
        <div className="progress-track">
          <div className="progress-bar" style={{ width: pct + '%' }} />
        </div>
        <div className="progress-labels">
          <span className="p-saved">P{totalContributions.toLocaleString()} saved</span>
          <span className="p-pct">{pct}%</span>
        </div>
        <p className="progress-note">
          P{(target - totalContributions).toLocaleString()} more to reach the P{target.toLocaleString()} year-end target
        </p>
      </div>

      {/* quick actions */}
      <div className="card dash-section">
        <h3 className="section-title">Quick Actions</h3>
        <div className="quick-grid">
          <button className="quick-btn" onClick={() => navigate('/contributions')}>💵<br/>Add Payment</button>
          <button className="quick-btn" onClick={() => navigate('/loans/apply')}>💰<br/>Apply Loan</button>
          <button className="quick-btn" onClick={() => navigate('/groups')}>👥<br/>Manage Group</button>
          <button className="quick-btn" onClick={() => navigate('/reports')}>📈<br/>View Reports</button>
        </div>
      </div>

      {/* recent activity */}
      <div className="card dash-section">
        <h3 className="section-title">Recent Activity</h3>
        {activity.length === 0 ? (
          <p className="empty-note">No activity yet. Start by applying for a loan or adding a contribution.</p>
        ) : (
          <div className="activity-list">
            {activity.slice(0, 8).map(a => (
              <div className="activity-row" key={a.id}>
                <span className="activity-ico">{icon(a.type)}</span>
                <span className="activity-txt">{a.text}</span>
                <span className="activity-time">{a.time}</span>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  )
}
