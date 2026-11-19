import { useState, lazy, Suspense } from "react"
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom"
import { Loader2 } from "lucide-react"
import AuthPage from "./pages/AuthPage"
import AppLauncherPage from "./pages/AppLauncherPage"

// Lazy-loaded app modules (code-split into separate JS bundles)
const SnapshotApp = lazy(() => import("./pages/SnapshotApp"))
const ParkingAccessApp = lazy(() => import("./pages/ParkingAccessApp"))

export interface UserSession {
  id: number
  full_name: string
  email: string
}

function AppLoadingFallback() {
  return (
    <div className="min-h-screen w-screen bg-slate-950 text-slate-300 flex flex-col items-center justify-center space-y-3">
      <Loader2 className="w-7 h-7 text-blue-500 animate-spin" />
      <p className="text-xs font-medium tracking-wide uppercase text-slate-400">Loading Application Module...</p>
    </div>
  )
}

function AppRoutes() {
  const navigate = useNavigate()
  const [user, setUser] = useState<UserSession | null>(() => {
    const saved = localStorage.getItem("anpr_user")
    if (!saved) return null
    try {
      return JSON.parse(saved)
    } catch {
      localStorage.removeItem("anpr_user")
      return null
    }
  })

  const handleLogout = () => {
    localStorage.removeItem("anpr_token")
    localStorage.removeItem("anpr_user")
    setUser(null)
    navigate("/login", { replace: true })
  }

  return (
    <Suspense fallback={<AppLoadingFallback />}>
      <Routes>
        <Route
          path="/login"
          element={
            user ? (
              <Navigate to="/apps" replace />
            ) : (
              <AuthPage
                onAuthenticated={(loggedInUser) => {
                  setUser(loggedInUser)
                  navigate("/apps", { replace: true })
                }}
              />
            )
          }
        />

        <Route
          path="/apps"
          element={
            user ? (
              <AppLauncherPage
                user={user}
                onSelectApp={(appId) => navigate(`/apps/${appId}`)}
                onLogout={handleLogout}
              />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />

        <Route
          path="/apps/snapshot"
          element={
            user ? (
              <SnapshotApp user={user} onBackToApps={() => navigate("/apps")} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />

        <Route
          path="/apps/parking"
          element={
            user ? (
              <ParkingAccessApp user={user} onBackToApps={() => navigate("/apps")} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />

        <Route path="*" element={<Navigate to={user ? "/apps" : "/login"} replace />} />
      </Routes>
    </Suspense>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}