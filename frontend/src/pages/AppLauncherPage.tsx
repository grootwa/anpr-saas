import { useState, useEffect } from "react"
import { SAAS_APPS, type SaaSAppDefinition } from "../config/appsRegistry"
import { Camera, ShieldCheck, ArrowUpRight, LogOut, PlusCircle, Layers, Search, Loader2 } from "lucide-react"
import IndianPlateBadge from "../components/IndianPlateBadge"

interface AppLauncherProps {
  user: { id: number; full_name: string; email: string }
  onSelectApp: (appId: "snapshot" | "parking") => void
  onLogout: () => void
}

interface GlobalSearchHit {
  id: string
  app: "snapshot" | "parking"
  app_label: string
  plate_number: string
  meta: string
  timestamp: string | null
  image_url: string | null
}

export default function AppLauncherPage({ user, onSelectApp, onLogout }: AppLauncherProps) {
  const [globalQuery, setGlobalQuery] = useState("")
  const [searchResults, setSearchResults] = useState<GlobalSearchHit[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    const trimmed = globalQuery.trim()
    if (trimmed.length < 2) {
      setSearchResults([])
      return
    }

    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(
          `http://localhost:8000/v1/search?user_id=${user.id}&q=${encodeURIComponent(trimmed)}`
        )
        if (res.ok) {
          const data = await res.json()
          setSearchResults(data.results || [])
        }
      } catch (err) {
        console.error(err)
      } finally {
        setSearching(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [globalQuery, user.id])

  return (
    <div className="min-h-screen w-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* TOP BAR WITH GLOBAL SEARCH */}
      <header className="h-16 border-b border-slate-800 bg-slate-900/70 px-8 flex items-center justify-between gap-4">
        <div className="flex items-center space-x-3 shrink-0">
          <div className="p-2 bg-blue-600 rounded-lg">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-base text-white">Sigma Vision Cloud</span>
        </div>

        {/* GLOBAL PLATE SEARCH */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
          <input
            type="text"
            value={globalQuery}
            onChange={(e) => setGlobalQuery(e.target.value)}
            placeholder="Global search plate across all apps (e.g. JH01)..."
            className="w-full pl-10 pr-9 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
          {searching && <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin absolute right-3 top-2.5" />}

          {/* DROPDOWN RESULTS */}
          {globalQuery.trim().length >= 2 && (
            <div className="absolute left-0 right-0 mt-2 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-40 max-h-80 overflow-y-auto divide-y divide-slate-800">
              {searchResults.length === 0 && !searching ? (
                <div className="p-4 text-center text-xs text-slate-500">
                  No matching vehicles found across Snapshot or Parking logs.
                </div>
              ) : (
                searchResults.map((hit) => (
                  <button
                    key={hit.id}
                    onClick={() => onSelectApp(hit.app)}
                    className="w-full p-3 hover:bg-slate-800/70 flex items-center justify-between text-left transition-colors"
                  >
                    <div className="flex items-center space-x-3">
                      {hit.image_url && (
                        <img
                          src={hit.image_url}
                          alt={hit.plate_number}
                          className="w-12 h-8 object-cover rounded border border-slate-700"
                        />
                      )}
                      <div>
                        <IndianPlateBadge plate={hit.plate_number} size="sm" />
                        <p className="text-[11px] text-slate-400 mt-1">{hit.meta}</p>
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        hit.app === "snapshot"
                          ? "bg-blue-500/15 text-blue-400"
                          : "bg-emerald-500/15 text-emerald-400"
                      }`}
                    >
                      {hit.app_label} →
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div className="flex items-center space-x-4 shrink-0">
          <div className="text-right">
            <p className="text-xs font-semibold text-white">{user.full_name}</p>
            <p className="text-[11px] text-slate-400">{user.email}</p>
          </div>
          <button
            onClick={onLogout}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
            title="Sign Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* APP CARDS GRID */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-8 py-12 space-y-8">
        <div>
          <h2 className="text-2xl font-bold text-white">Applications</h2>
          <p className="text-sm text-slate-400 mt-1">
            Each module loads independently on demand. Select an application to open its workspace.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {SAAS_APPS.map((app: SaaSAppDefinition) => {
            const isBlue = app.accentColor === "blue"
            return (
              <div
                key={app.id}
                onClick={() => onSelectApp(app.id)}
                className="group bg-slate-900 border border-slate-800 hover:border-blue-500/60 rounded-2xl p-6 flex flex-col justify-between cursor-pointer transition-all hover:-translate-y-1 shadow-lg"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div
                      className={`p-3 rounded-xl ${
                        isBlue ? "bg-blue-600/15 text-blue-400" : "bg-emerald-600/15 text-emerald-400"
                      }`}
                    >
                      {app.id === "snapshot" ? <Camera className="w-6 h-6" /> : <ShieldCheck className="w-6 h-6" />}
                    </div>
                    <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                      {app.badge}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-lg font-bold text-white group-hover:text-blue-400 transition-colors">
                      {app.name}
                    </h3>
                    <p className="text-xs font-medium text-slate-400 mt-0.5">{app.tagline}</p>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed">{app.description}</p>
                </div>

                <div className="pt-6 mt-6 border-t border-slate-800/80 flex items-center justify-between text-xs font-semibold text-blue-400">
                  <span>Open Application</span>
                  <ArrowUpRight className="w-4 h-4 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                </div>
              </div>
            )
          })}

          <div className="border-2 border-dashed border-slate-800 rounded-2xl p-6 flex flex-col items-center justify-center text-center space-y-2 text-slate-500">
            <PlusCircle className="w-7 h-7 text-slate-600" />
            <p className="text-sm font-semibold text-slate-400">More Modules Coming Soon</p>
            <p className="text-xs max-w-[220px]">
              Weighbridge Automation, Facial Access & Fleet Analytics ready to plug in.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}