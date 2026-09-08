import { Navigate, Route, Routes, useLocation } from "react-router-dom"
import { Opportunities } from "@/pages/Opportunities"
import { AppShell } from "@/components/AppShell"
import { Login } from "@/pages/Login"
import { Dashboard } from "@/pages/Dashboard"
import { Suites } from "@/pages/Suites"
import MinistryShell from "@/pages/MinistryShell"
import { Profile } from "@/pages/Profile"
import { Settings } from "@/pages/Settings"
import { useAuth } from "@/hooks/useAuth"
import { isFeatureOn } from "@/lib/settings"
import type { FeatureKey } from "@/lib/settings"
import { AppErrorBoundary } from "@/components/AppErrorBoundary"
import { Spinner } from "@/components/ui"
import { MinistryRoom } from "@/pages/ministry/MinistryRoom"

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
        <Route
          path="opportunities"
          element={
            <RequireFeature feature="opportunities">
              <Opportunities />
            </RequireFeature>
          }
        />
        <Route path="settings" element={<Settings />} />
        <Route path="profile" element={<Profile />} />
        {/* The existing Suites page is now the ministry landing under the
            ministry shell's Outlet — it keeps the trading UI + deep links alive. */}
        <Route path="suites/:suiteId" element={<MinistryShell />}>
          <Route index element={<Suites />} />
          <Route path="*" element={<MinistryRoom />} />
        </Route>
        <Route path="suites" element={<Navigate to="/suites/trading" replace />} />
        <Route path="trading" element={<Navigate to="/suites/trading" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppErrorBoundary>
  )
}
