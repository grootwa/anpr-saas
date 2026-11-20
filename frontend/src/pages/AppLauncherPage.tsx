import { useState, useEffect } from "react"
import { SAAS_APPS, type SaaSAppDefinition } from "../config/appsRegistry"
import { Camera, ShieldCheck, ArrowUpRight, LogOut, Building2 } from "lucide-react"

interface AppLauncherProps {
  user: { id: number; full_name: string; email: string }
  onSelectApp: (appId: "snapshot" | "parking") => void
  onLogout: () => void
}

const API_BASE = "http://localhost:8000"

export default function AppLauncherPage({ user, onSelectApp, onLogout }: AppLauncherProps) {
  const [logoFailed, setLogoFailed] = useState(false)
  const [orgName, setOrgName] = useState<string>(() => {
    try {
      const cached = localStorage.getItem(`anpr_org_config_${user.id}`)
      if (cached) {
        const parsed = JSON.parse(cached)
        if (parsed.org_name) return parsed.org_name
      }
    } catch {
      // Fallback to default
    }
    return "Sigma Vision Cloud"
  })

  useEffect(() => {
    let active = true
    const loadOrg = async () => {
      try {
        const res = await fetch(`${API_BASE}/v1/parking/org-config?user_id=${user.id}`)
        if (!res.ok || !active) return
        const data = await res.json()
        if (data.org_name) {
          setOrgName(data.org_name)
          localStorage.setItem(`anpr_org_config_${user.id}`, JSON.stringify(data))
        }
      } catch {
        // Keep cached org name on offline/transient error
      }
    }
    loadOrg()
    return () => {
      active = false
    }
  }, [user.id])

  return (
    <div className="min-h-screen w-screen bg-gradient-to-br from-slate-50 via-amber-50/25 to-rose-50/35 text-slate-900 flex flex-col relative overflow-x-hidden">
      {/* Brand Accent Top Bar */}
      <div className="h-1.5 w-full bg-gradient-to-r from-[#A62626] via-[#F59E1B] to-[#8F1D36]" />

      {/* TOP HEADER */}
      <header className="h-18 bg-white/95 backdrop-blur-md border-b border-slate-200/90 px-6 md:px-10 py-3 flex items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center space-x-4">
          {!logoFailed ? (
            <img
              src="/sigma-logo.jpg"
              alt="Sigma eSolution Pvt Ltd"
              onError={() => setLogoFailed(true)}
              className="h-10 w-auto object-contain"
            />
          ) : (
            <div className="flex items-center space-x-2.5">
              <svg viewBox="0 0 64 64" className="w-9 h-9 shrink-0" aria-hidden="true">
                <path
                  d="M12 16 C12 9, 18 6, 26 6 L48 6 C53 6, 56 10, 56 14 C56 18, 53 21, 48 21 L27 21 L27 32 L12 32 Z"
                  fill="#A62626"
                />
                <path
                  d="M27 11 L50 11 C54 11, 56 14, 56 17 C56 20, 54 22, 50 22 L27 22 Z"
                  fill="#F59E1B"
                />
                <path
                  d="M52 48 C52 55, 46 58, 38 58 L16 58 C11 58, 8 54, 8 50 C8 46, 11 43, 16 43 L37 43 L37 32 L52 32 Z"
                  fill="#A62626"
                />
                <path
                  d="M37 53 L14 53 C10 53, 8 50, 8 47 C8 44, 10 42, 14 42 L37 42 Z"
                  fill="#F59E1B"
                />
              </svg>
              <div>
                <div className="text-lg font-extrabold tracking-wider text-[#A62626] leading-none">
                  SIGMA
                </div>
                <div className="text-[10px] font-semibold text-[#8F1D36] tracking-wide">
                  eSolution Pvt Ltd
                </div>
              </div>
            </div>
          )}

          <div className="hidden sm:block h-7 w-px bg-slate-200" />

          <div className="hidden sm:flex items-center space-x-2">
            <div className="p-1.5 rounded-lg bg-[#FDF2F2] text-[#A62626] border border-[#F5C6C6]">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-900 leading-tight">{orgName}</p>
              <p className="text-[11px] text-slate-500">Enterprise Vision &amp; Access Suite</p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <div className="text-right">
            <p className="text-xs font-bold text-slate-900">{user.full_name}</p>
            <p className="text-[11px] text-slate-500">{user.email}</p>
          </div>
          <button
            onClick={onLogout}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-[#FDF2F2] text-slate-700 hover:text-[#A62626] border border-slate-200 hover:border-[#F5C6C6] text-xs font-semibold transition-colors"
            title="Sign Out"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </header>

      {/* MAIN WORKSPACE LAUNCHER */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 md:px-10 py-14 flex flex-col justify-center">
        {/* <div className="mb-10">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]">
            Workspace Modules
          </span>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight mt-3">
            Select an Application
          </h1>
          <p className="text-sm text-slate-600 mt-1.5 max-w-xl">
            Choose an operational module below to launch its dedicated AI inference and management console.
          </p>
        </div> */}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-7">
          {SAAS_APPS.map((app: SaaSAppDefinition) => {
            const isSnapshot = app.id === "snapshot"
            return (
              <div
                key={app.id}
                onClick={() => onSelectApp(app.id)}
                className="group relative bg-white border border-slate-200/90 hover:border-[#A62626]/50 rounded-2xl p-7 flex flex-col justify-between cursor-pointer transition-all duration-200 hover:-translate-y-1 shadow-md shadow-slate-200/60 hover:shadow-xl hover:shadow-[#A62626]/10 overflow-hidden"
              >
                {/* Top hover accent strip */}
                <div
                  className={`absolute top-0 left-0 right-0 h-1 transition-opacity duration-200 opacity-0 group-hover:opacity-100 ${
                    isSnapshot
                      ? "bg-gradient-to-r from-[#F59E1B] to-[#A62626]"
                      : "bg-gradient-to-r from-[#A62626] to-[#8F1D36]"
                  }`}
                />

                <div className="space-y-5">
                  <div className="flex items-center justify-between">
                    <div
                      className={`p-3.5 rounded-2xl border ${
                        isSnapshot
                          ? "bg-[#FFFBEB] text-[#D97706] border-[#FDE68A]"
                          : "bg-[#FDF2F2] text-[#A62626] border-[#F5C6C6]"
                      }`}
                    >
                      {isSnapshot ? (
                        <Camera className="w-6 h-6" />
                      ) : (
                        <ShieldCheck className="w-6 h-6" />
                      )}
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-[11px] font-bold border ${
                        isSnapshot
                          ? "bg-amber-50 text-amber-800 border-amber-200"
                          : "bg-rose-50 text-[#A62626] border-rose-200"
                      }`}
                    >
                      {app.badge}
                    </span>
                  </div>

                  <div>
                    <h2 className="text-xl font-bold text-slate-900 group-hover:text-[#A62626] transition-colors">
                      {app.name}
                    </h2>
                    <p className="text-xs font-semibold text-slate-500 mt-1">{app.tagline}</p>
                  </div>

                  <p className="text-sm text-slate-600 leading-relaxed">{app.description}</p>
                </div>

                <div className="pt-6 mt-7 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-xs font-bold text-[#A62626] group-hover:text-[#8B1E1E] transition-colors">
                    Open Workspace
                  </span>
                  <div className="w-8 h-8 rounded-full bg-slate-100 group-hover:bg-[#A62626] text-slate-600 group-hover:text-white flex items-center justify-center transition-colors">
                    <ArrowUpRight className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </main>

      {/* SUBTLE FOOTER */}
      <footer className="py-5 px-8 text-center text-xs text-slate-500 border-t border-slate-200/70 bg-white/60">
        © {new Date().getFullYear()} Sigma eSolution Pvt Ltd • Vision AI &amp; Industrial Automation
      </footer>
    </div>
  )
}