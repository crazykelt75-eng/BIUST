import React, { createContext, useState, useContext, useEffect } from 'react'

const AppContext = createContext()

// in production this will be the Render backend URL
const API = import.meta.env.VITE_API_URL || '/api'

// all api calls go through here so we dont repeat auth header every time
async function callApi(path, options = {}) {
  const token = localStorage.getItem('token')
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (token) headers['Authorization'] = 'Bearer ' + token

  const res = await fetch(API + path, { ...options, headers })
  const data = await res.json()
  return { ok: res.ok, status: res.status, data }
}

export function AppProvider({ children }) {
  const [user, setUser]   = useState(null)
  const [token, setToken] = useState(localStorage.getItem('token') || null)
  const [loading, setLoading] = useState(true)

  const [loans, setLoans]               = useState([])
  const [contributions, setContributions] = useState([])
  const [members, setMembers]           = useState([])
  const [memberRequests, setMemberRequests] = useState([])
  const [activity, setActivity]         = useState([])

  // restore session on load
  useEffect(() => {
    if (!token) { setLoading(false); return }

    callApi('/auth/me').then(res => {
      if (res.ok) {
        setUser(res.data.user)
      } else {
        // token is probably stale
        localStorage.removeItem('token')
        setToken(null)
      }
      setLoading(false)
    }).catch(() => {
      setLoading(false)
    })
  }, [])

  function addActivity(type, text) {
    const item = { id: Date.now(), type, text, time: 'just now' }
    setActivity(prev => [item, ...prev])
  }

  async function login(email, password) {
    const res = await callApi('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    })
    if (res.ok) {
      localStorage.setItem('token', res.data.token)
      setToken(res.data.token)
      setUser(res.data.user)
    }
    return res
  }

  async function register(fullName, email, phone, password) {
    return callApi('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ fullName, email, phone, password })
    })
  }

  function logout() {
    localStorage.removeItem('token')
    setToken(null)
    setUser(null)
    setLoans([])
    setContributions([])
    setMembers([])
    setActivity([])
  }

  async function createGroup(groupName, description) {
    const res = await callApi('/groups', {
      method: 'POST',
      body: JSON.stringify({ groupName, description })
    })
    if (res.ok) {
      const g = res.data.group
      setUser(prev => ({ ...prev, groupId: g.id, groupName: g.groupName, groupCode: g.groupCode }))
    }
    return res
  }

  async function joinGroup(groupCode) {
    const res = await callApi('/groups/join', {
      method: 'POST',
      body: JSON.stringify({ groupCode })
    })
    if (res.ok) {
      const g = res.data.group
      setUser(prev => ({ ...prev, groupId: g.id, groupName: g.groupName, groupCode: g.groupCode }))
    }
    return res
  }

  async function fetchLoans(mine = false) {
    const res = await callApi('/loans' + (mine ? '?mine=true' : ''))
    if (res.ok) setLoans(res.data.loans)
    return res.data
  }

  async function fetchContributions(mine = false) {
    const res = await callApi('/contributions' + (mine ? '?mine=true' : ''))
    if (res.ok) setContributions(res.data.contributions)
    return res.data
  }

  async function fetchMembers() {
    const res = await callApi('/members')
    if (res.ok) setMembers(res.data.members)
    return res.data
  }

  // kept for any page still using the local context helpers
  function addLoan(loan) {
    const tmp = {
      id: Date.now(),
      principalAmount: loan.amount,
      outstandingBalance: loan.amount,
      interestAccrued: 0,
      status: 'pending',
      purpose: loan.reason,
      memberName: user ? user.fullName : 'Me',
      dueDate: loan.dueDate
    }
    setLoans(prev => [...prev, tmp])
    addActivity('loan', `Loan of P${loan.amount} submitted for approval`)
  }

  function addMemberRequest(m) {
    const tmp = { id: Date.now(), name: m.name, email: m.email, role: m.role, status: 'Pending' }
    setMemberRequests(prev => [...prev, tmp])
    addActivity('member', `${m.name} requested to join the group`)
  }

  function addContribution(c) {
    const tmp = {
      id: Date.now(),
      amount: c.amount,
      memberName: user ? user.fullName : 'Me',
      monthYear: c.month,
      status: 'pending',
      createdAt: new Date().toISOString()
    }
    setContributions(prev => [...prev, tmp])
    addActivity('contribution', `Contribution of P${c.amount} submitted`)
  }

  function updateLoan(updated) {
    setLoans(prev => prev.map(l => l.id === updated.id ? { ...l, ...updated } : l))
  }

  return (
    <AppContext.Provider value={{
      user, token, loading,
      loans, contributions, members, activity, memberRequests,
      login, logout, register,
      createGroup, joinGroup,
      fetchLoans, fetchContributions, fetchMembers,
      addLoan, addContribution, addMemberRequest, updateLoan,
      addActivity,
      apiFetch: callApi
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  return useContext(AppContext)
}
