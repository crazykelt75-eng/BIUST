import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppProvider, useApp } from './context/AppContext'
import MainLayout from './layout/MainLayout'

import Login from './pages/Login'
import Register from './pages/Register'
import Setup from './pages/Setup'
import Home from './pages/Home'
import Dashboard from './pages/Dashboard'
import Contributions from './pages/contributions'
import Loans from './pages/Loans'
import LoanApplication from './pages/LoanApplication'
import Groups from './pages/Groups'
import MembersPage from './pages/members'
import Reports from './pages/Reports'
import Settings from './pages/settings'
import Approvals from './pages/Approvals'

// protect routes that need login
function PrivateRoute({ children }) {
    const { user, loading } = useApp()
    if (loading) return <div style={{ textAlign: 'center', padding: '60px' }}>Loading...</div>
    if (!user) return <Navigate to="/login" replace />
    return children
}

function AppRoutes() {
    return (
        <Routes>
            {/* public */}
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />

            {/* after login, no group yet */}
            <Route path="/setup" element={
                <PrivateRoute><Setup /></PrivateRoute>
            } />

            {/* protected pages with sidebar layout */}
            <Route element={<MainLayout />}>
                <Route path="/dashboard" element={
                    <PrivateRoute><Dashboard /></PrivateRoute>
                } />
                <Route path="/contributions" element={
                    <PrivateRoute><Contributions /></PrivateRoute>
                } />
                <Route path="/loans" element={
                    <PrivateRoute><Loans /></PrivateRoute>
                } />
                <Route path="/loans/apply" element={
                    <PrivateRoute><LoanApplication /></PrivateRoute>
                } />
                <Route path="/groups" element={
                    <PrivateRoute><Groups /></PrivateRoute>
                } />
                <Route path="/members" element={
                    <PrivateRoute><MembersPage /></PrivateRoute>
                } />
                <Route path="/approvals" element={
                    <PrivateRoute><Approvals /></PrivateRoute>
                } />
                <Route path="/reports" element={
                    <PrivateRoute><Reports /></PrivateRoute>
                } />
                <Route path="/settings" element={
                    <PrivateRoute><Settings /></PrivateRoute>
                } />
            </Route>
        </Routes>
    )
}

function App() {
    return (
        <BrowserRouter>
            <AppProvider>
                <AppRoutes />
            </AppProvider>
        </BrowserRouter>
    )
}

export default App
