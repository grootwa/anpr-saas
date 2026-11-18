import { SAAS_APPS, type SaaSAppDefinition } from "../config/appsRegistry"
import { Camera, ShieldCheck, ArrowUpRight, LogOut, PlusCircle, Layers } from "lucide-react"

interface AppLauncherProps {
  user: { id: number; full_name: string; email: string }
  onSelectApp: (appId: "snapshot" | "parking") => void
  onLogout: () => void
}

export default function AppLauncherPage({ user, onSelectApp, onLogout }: AppLauncherProps) {
  return (
    <div className="min-h-screen w-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* TOP BAR */}
      <header className="h-16 border-b border-slate-800 bg-slate-900/70 px-8 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-blue-600 rounded-lg">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-base text-white">Sigma Vision Cloud</span>
        </div>

        <div className="flex items-center space-x-4">
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
            Select an AI solution module to launch its live operational dashboard.
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
                      {app.id === "snapshot" ? (
                        <Camera className="w-6 h-6" />
                      ) : (
                        <ShieldCheck className="w-6 h-6" />
                      )}
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

          {/* PLACEHOLDER CARD FOR FUTURE MODULES */}
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