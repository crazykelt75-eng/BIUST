import React from 'react'
import { Link } from 'react-router-dom'
import '../styles/design.css'
import '../styles/Home.css'

export default function Home() {
  return (
    <div className="home-screen">

      {/* hero section — full-bleed photo like Figma Landing page */}
      <div className="home-hero">
        <div className="hero-overlay">
          <nav className="hero-nav">
            <div className="hero-logo">
              <span>👥</span>
              <span>Re-Mmogo</span>
            </div>
            <div className="hero-nav-links">
              <Link to="/login" className="hero-nav-link">Login</Link>
              <Link to="/register" className="hero-nav-btn">Register</Link>
            </div>
          </nav>

          <div className="hero-body">
            <h1 className="hero-heading">
              Manage your Motshelo group the smart way
            </h1>
            <p className="hero-sub">
              Track contributions, manage loans, and generate year-end reports — all in one place.
            </p>
            <div className="hero-actions">
              <Link to="/register" className="hero-btn-primary">Get Started</Link>
              <Link to="/login" className="hero-btn-ghost">Log In</Link>
            </div>
          </div>
        </div>
      </div>

      {/* info strip */}
      <div className="home-strip">
        <span className="strip-icon">💵</span>
        <p>
          <strong>P1 000/month</strong> contributions · <strong>20%</strong> loan interest ·
          <strong> P5 000</strong> year-end interest target
        </p>
      </div>

      {/* features */}
      <section className="home-features">
        <div className="home-feat">
          <div className="home-feat-icon">💵</div>
          <h3>Contributions</h3>
          <p>Members submit monthly payments, signatories approve them quickly and securely.</p>
        </div>
        <div className="home-feat">
          <div className="home-feat-icon">💰</div>
          <h3>Loans</h3>
          <p>Apply for loans with 20% monthly interest. Dual signatory approval required.</p>
        </div>
        <div className="home-feat">
          <div className="home-feat-icon">📈</div>
          <h3>Reports</h3>
          <p>Year-end reports show contributions, interest earned, and payout per member.</p>
        </div>
      </section>

      {/* about strip */}
      <div className="home-about">
        <h2>Built for Botswana's motshelo culture</h2>
        <p>
          Re-Mmogo brings transparency and accountability to savings groups.
          Join your group, track every pula, and grow together.
        </p>
        <div className="home-about-actions">
          <Link to="/register" className="btn-primary" style={{ maxWidth: 220, margin: '0 auto' }}>
            Create your group →
          </Link>
        </div>
      </div>

      <footer className="home-footer">
        <span>👥 Re-Mmogo</span>
        <span>© 2026 · Built for motshelo groups in Botswana</span>
      </footer>
    </div>
  )
}
