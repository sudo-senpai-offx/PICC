import { lazy, Suspense } from "react"
import { Navigate, Route, Routes, useLocation } from "react-router-dom"
import { Opportunities } from "@/pages/Opportunities"
import { AppShell } from "@/components/AppShell"
import { Login } from "@/pages/Login"
import { Dashboard } from "@/pages/Dashboard"
import { StudioPage } from "@/pages/StudioPage"
import { Profile } from "@/pages/Profile"
import { Settings } from "@/pages/Settings"
import { useAuth } from "@/hooks/useAuth"
import { isFeatureOn } from "@/lib/settings"
import type { FeatureKey } from "@/lib/settings"
import { AppErrorBoundary } from "@/components/AppErrorBoundary"
import { Spinner } from "@/components/ui"

// T7 — suite code-splitting: the ministry tree below loads lazily so the
// initial bundle is the hub shell + login only. Each suite chunk is fetched on
// first navigation into /suites/* (MinistryRoom further lazy-splits every room,
// so trading/earnings/intelligence land in their own asynchronous chunks).
const MinistryShell = lazy(() => import("@/pages/MinistryShell"))
const Suites = lazy(() => import("@/pages/Suites").then((m) => ({ default: m.Suites })))
const MinistryRoom = lazy(() => import("@/pages/ministry/MinistryRoom").then((m) => ({ default: m.MinistryRoom })))

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

function SuitesRedirect() {
  const { search } = useLocation()
  return <Navigate to={`/suites/trading${search}`} replace />
}

export default function App() {
  return (
    <AppErrorBoundary>
      <Suspense fallback={<Spinner label="Loading…" />}>
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
          <Route path="studio" element={<StudioPage />} />
          {/* The existing Suites page is now the ministry landing under the
              ministry shell's Outlet — it keeps the trading UI + deep links alive. */}
          <Route path="suites/:suiteId" element={<MinistryShell />}>
            <Route index element={<Suites />} />
            <Route path="*" element={<MinistryRoom />} />
          </Route>
          <Route path="suites" element={<SuitesRedirect />} />
          <Route path="trading" element={<Navigate to="/suites/trading" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppErrorBoundary>
  )
}
