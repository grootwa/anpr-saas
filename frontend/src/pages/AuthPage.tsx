import { useState } from "react"
import { Loader2, ArrowRight, ShieldCheck, Lock, Mail, User } from "lucide-react"

interface AuthPageProps {
  onAuthenticated: (user: { id: number; full_name: string; email: string }, token: string) => void
}

export default function AuthPage({ onAuthenticated }: AuthPageProps) {
  const [isRegister, setIsRegister] = useState(false)
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [logoFailed, setLogoFailed] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")

    const endpoint = isRegister ? "/v1/auth/register" : "/v1/auth/login"
    const payload = isRegister ? { full_name: fullName, email, password } : { email, password }

    try {
      const res = await fetch(`http://localhost:8000${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || "Authentication failed")

      localStorage.setItem("anpr_token", data.token)
      localStorage.setItem("anpr_user", JSON.stringify(data.user))
      onAuthenticated(data.user, data.token)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen w-screen bg-gradient-to-br from-slate-50 via-amber-50/30 to-rose-50/40 text-slate-900 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Subtle Brand Accent Top Bar */}
      <div className="fixed top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[#A62626] via-[#F59E1B] to-[#8F1D36]" />

      {/* Decorative Soft Glows */}
      <div className="pointer-events-none absolute -top-24 -left-24 w-96 h-96 rounded-full bg-[#F59E1B]/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 w-96 h-96 rounded-full bg-[#A62626]/10 blur-3xl" />

      <div className="w-full max-w-md bg-white border border-slate-200/90 rounded-2xl p-8 shadow-xl shadow-slate-200/70 space-y-6 relative z-10">
        {/* Sigma eSolution Brand Header */}
        <div className="flex flex-col items-center text-center space-y-3 pb-2 border-b border-slate-100">
          {!logoFailed ? (
            <img
              src="/sigma-logo.jpg"
              alt="Sigma eSolution Pvt Ltd"
              onError={() => setLogoFailed(true)}
              className="h-14 w-auto object-contain"
            />
          ) : (
            <div className="flex items-center space-x-3">
              <svg viewBox="0 0 64 64" className="w-11 h-11 shrink-0" aria-hidden="true">
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
              <div className="text-left">
                <div className="text-2xl font-extrabold tracking-wider text-[#A62626] leading-none">
                  SIGMA
                </div>
                <div className="text-xs font-semibold text-[#8F1D36] tracking-wide mt-0.5">
                  eSolution Pvt Ltd
                </div>
              </div>
            </div>
          )}

          <div>
            <h1 className="text-base font-bold text-slate-900">Sigma Vision Cloud</h1>
            <p className="text-xs text-slate-500">
              Enterprise ANPR &amp; Automated Access Control Suite
            </p>
          </div>
        </div>

        {/* Mode Switcher */}
        <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200/80">
          <button
            type="button"
            onClick={() => {
              setIsRegister(false)
              setError("")
            }}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
              !isRegister
                ? "bg-[#A62626] text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setIsRegister(true)
              setError("")
            }}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
              isRegister
                ? "bg-[#A62626] text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Create Account
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {isRegister && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Full Name / Organization
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Bikash Kumar"
                  className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-[#A62626] focus:ring-2 focus:ring-[#A62626]/15 transition-all"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Work Email
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operator@sigmaworld.in"
                className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-[#A62626] focus:ring-2 focus:ring-[#A62626]/15 transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-[#A62626] focus:ring-2 focus:ring-[#A62626]/15 transition-all"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-[#A62626] hover:bg-[#8B1E1E] active:bg-[#761818] text-white text-sm font-semibold rounded-xl shadow-md shadow-[#A62626]/20 flex items-center justify-center transition-all disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <span>{isRegister ? "Create Workspace" : "Launch Workspace"}</span>
                <ArrowRight className="w-4 h-4 ml-2" />
              </>
            )}
          </button>
        </form>

        <div className="pt-2 flex items-center justify-center space-x-1.5 text-[11px] text-slate-500">
          <ShieldCheck className="w-3.5 h-3.5 text-[#F59E1B]" />
          <span>Powered by Sigma eSolution Pvt Ltd • Vision AI Engine</span>
        </div>
      </div>
    </div>
  )
}