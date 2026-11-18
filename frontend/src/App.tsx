import { useState, useEffect } from "react"
import AuthPage from "./pages/AuthPage"
import AppLauncherPage from "./pages/AppLauncherPage"
import SnapshotApp from "./pages/SnapshotApp"
import ParkingAccessApp from "./pages/ParkingAccessApp"

export interface UserSession {
  id: number
  full_name: string
  email: string
}

export default function App() {
  const [user, setUser] = useState<UserSession | null>(null)
  const [selectedApp, setSelectedApp] = useState<"launcher" | "snapshot" | "parking">("launcher")

  useEffect(() => {
    const savedUser = localStorage.getItem("anpr_user")
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser))
      } catch {
        localStorage.removeItem("anpr_user")
      }
    }
  }, [])

  const handleLogout = () => {
    localStorage.removeItem("anpr_token")
    localStorage.removeItem("anpr_user")
    setUser(null)
    setSelectedApp("launcher")
  }

  if (!user) {
    return (
      <AuthPage
        onAuthenticated={(loggedInUser) => {
          setUser(loggedInUser)
          setSelectedApp("launcher")
        }}
      />
    )
  }

  if (selectedApp === "launcher") {
    return (
      <AppLauncherPage
        user={user}
        onSelectApp={(appId) => setSelectedApp(appId)}
        onLogout={handleLogout}
      />
    )
  }

  if (selectedApp === "snapshot") {
    return <SnapshotApp user={user} onBackToApps={() => setSelectedApp("launcher")} />
  }

  return <ParkingAccessApp user={user} onBackToApps={() => setSelectedApp("launcher")} />
}