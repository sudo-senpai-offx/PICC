import { Navigate, Route, Routes, useLocation } from "react-router-dom"
import { Opportunities } from "@/pages/Opportunities"
import { AppShell } from "@/components/AppShell"
import { Login } from "@/pages/Login"
import { Dashboard } from "@/pages/Dashboard"
import { Simulator } from "@/pages/Simulator"
import { Agents } from "@/pages/Agents"
import { Income } from "@/pages/Income"
import { Suites } from "@/pages/Suites"
import { TradingDashboard } from "@/pages/TradingDashboard"
import { StreamPage } from "@/pages/StreamPage"
import { Profile } from "@/pages/Profile"
import { Settings } from "@/pages/Settings"
import { useAuth } from "@/hooks/useAuth"
import { isFeatureOn } from "@/lib/settings"
import type { FeatureKey } from "@/lib/settings"
import { AppErrorBoundary } from "@/components/AppErrorBoundary"
import { Spinner } from "@/components/ui"

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Spinner label="Loading…" />
  if (!session) return <Navigate to="/login" state={{ from: location }} replace />
  return <>{children}</>
}

function RequireFeature({ feature, children }: { feature: FeatureKey; children: React.ReactNode }) {
  if (!isFeatureOn(feature)) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <AppErrorBoundary>
      <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="simulator" element={<Simulator />} />
        <Route
          path="suites"
          element={
            <RequireFeature feature="trading">
              <Suites />
            </RequireFeature>
          }
        />
        <Route path="trading" element={<Navigate to="/suites" replace />} />
        <Route
          path="trading-dashboard"
          element={
            <RequireFeature feature="trading">
              <TradingDashboard />
            </RequireFeature>
          }
        />
        <Route
          path="agents"
          element={
            <RequireFeature feature="agents">
              <Agents />
            </RequireFeature>
          }
        />
        <Route
          path="opportunities"
          element={
            <RequireFeature feature="opportunities">
              <Opportunities />
            </RequireFeature>
          }
        />
        <Route
          path="income"
          element={
            <RequireFeature feature="income">
              <Income />
            </RequireFeature>
          }
        />
        <Route
          path="streams/:id"
          element={
            <RequireFeature feature="income">
              <StreamPage />
            </RequireFeature>
          }
        />
        <Route path="settings" element={<Settings />} />
        <Route path="profile" element={<Profile />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppErrorBoundary>
  )
}
