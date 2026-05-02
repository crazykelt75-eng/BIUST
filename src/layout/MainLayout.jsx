import { useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import '../styles/design.css'

const NAV = [
  { path: '/dashboard',     icon: '📊', label: 'Dashboard'     },
  { path: '/groups',        icon: '👥', label: 'Groups'         },
  { path: '/contributions', icon: '💵', label: 'Contributions'  },
  { path: '/loans',         icon: '💰', label: 'Loans'          },
  { path: '/approvals',     icon: '✅', label: 'Approvals'      },
  { path: '/reports',       icon: '📈', label: 'Reports'        },
  { path: '/settings',      icon: '⚙️',  label: 'Settings'      },
]

const PAGE_TITLES = {
  '/dashboard':     'Dashboard',
  '/groups':        'My Group',
  '/contributions': 'Contributions',
  '/loans':         'Loans',
  '/approvals':     'Approvals',
  '/reports':       'Reports',
  '/settings':      'Settings',
  '/members':       'Members',
}

export default function MainLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useApp()
  const [open, setOpen] = useState(false)

  function goTo(path) {
    navigate(path)
    setOpen(false)
  }

  function handleLogout() {
    logout()
    navigate('/login')
  }

  const title = PAGE_TITLES[location.pathname] || 'Re-Mmogo'
  const initials = user?.fullName
    ? user.fullName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : '?'

  return (
    <div className="app-layout">

      {/* mobile overlay */}
      <div
        className={`sidebar-overlay ${open ? 'open' : ''}`}
        onClick={() => setOpen(false)}
      />

      {/* sidebar */}
      <aside className={`app-sidebar ${open ? 'open' : ''}`}>

        <div className="sidebar-logo">
          <span className="logo-icon">👥</span>
          <span>Re-Mmogo</span>
        </div>

        <nav className="sidebar-nav">
          {NAV.map(item => (
            <button
              key={item.path}
              className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
              onClick={() => goTo(item.path)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-avatar">{initials}</div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user?.fullName || 'User'}</div>
              <div className="sidebar-user-role">{user?.role || 'member'}</div>
            </div>
            <button className="btn-logout" onClick={handleLogout} title="Log out">🚪</button>
          </div>
        </div>
      </aside>

      {/* topbar */}
      <header className="app-topbar">
        <button className="topbar-menu-btn" onClick={() => setOpen(!open)}>☰</button>
        <span className="topbar-title">{title}</span>
        <div className="topbar-actions">
          <button className="topbar-icon-btn">🔔</button>
          <button className="topbar-icon-btn" onClick={() => goTo('/settings')}>👤</button>
        </div>
      </header>

      {/* page content */}
      <main className="app-content">
        <div className="page-inner">
          <Outlet />
        </div>
      </main>

    </div>
  )
}
