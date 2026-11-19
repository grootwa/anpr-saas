import { useState, useRef, useEffect, useCallback } from "react"
import {
  Upload,
  Loader2,
  ArrowLeft,
  ShieldCheck,
  ShieldAlert,
  LockOpen,
  Lock,
  Car,
  LogIn,
  LogOut,
  IndianRupee,
  Clock,
  Plus,
  Trash2,
  RefreshCw,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Search,
  Maximize2
} from "lucide-react"
import type { UserSession } from "../App"
import IndianPlateBadge from "../components/IndianPlateBadge"
import ImageLightbox from "../components/ImageLightbox"
import PaginationBar from "../components/PaginationBar"

interface ParkingAppProps {
  user: UserSession
  onBackToApps: () => void
}

interface ParkingSessionItem {
  id: number
  plate_number: string
  access_type: "WHITELIST" | "VISITOR" | "BLACKLIST"
  gate_action: "OPENED" | "LOCKED"
  entry_time: string
  exit_time: string | null
  duration_mins: number
  fee_inr: number
  status: "PARKED" | "EXITED" | "BLOCKED"
  image_url: string | null
}

interface VehicleRuleItem {
  id: number
  plate_number: string
  rule_type: "WHITELIST" | "BLACKLIST"
  owner_label: string
}

const API_BASE = "http://localhost:8000"

export default function ParkingAccessApp({ user, onBackToApps }: ParkingAppProps) {
  const [subTab, setSubTab] = useState<"gate" | "sessions" | "rules">(() => {
    const saved = localStorage.getItem("anpr_parking_subtab")
    if (saved === "gate" || saved === "sessions" || saved === "rules") {
      return saved
    }
    return "gate"
  })

  const [gateDirection, setGateDirection] = useState<"ENTRY" | "EXIT">(() => {
    const saved = localStorage.getItem("anpr_parking_direction")
    return saved === "EXIT" ? "EXIT" : "ENTRY"
  })

  useEffect(() => {
    localStorage.setItem("anpr_parking_subtab", subTab)
  }, [subTab])

  useEffect(() => {
    localStorage.setItem("anpr_parking_direction", gateDirection)
  }, [gateDirection])

  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [processingState, setProcessingState] = useState<"idle" | "scanning" | "done" | "error">("idle")
  const [gateBanner, setGateBanner] = useState<{
    action: string
    access_type: string
    plate_number: string
    message: string
    fee_inr?: number
  } | null>(null)
  const [manualPlateInput, setManualPlateInput] = useState("")
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null)

  // Persistent Data & Server-Side Pagination State
  const [sessions, setSessions] = useState<ParkingSessionItem[]>([])
  const [sessionSearch, setSessionSearch] = useState("")
  const [sessionStatusFilter, setSessionStatusFilter] = useState<"ALL" | "PARKED" | "EXITED" | "BLOCKED">("ALL")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(15)
  const [totalItems, setTotalItems] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  const [rules, setRules] = useState<VehicleRuleItem[]>([])
  const [newPlate, setNewPlate] = useState("")
  const [newRuleType, setNewRuleType] = useState<"WHITELIST" | "BLACKLIST">("WHITELIST")
  const [newLabel, setNewLabel] = useState("")
  const [loadingData, setLoadingData] = useState(false)
  const [lightboxItem, setLightboxItem] = useState<ParkingSessionItem | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const showToast = (type: "success" | "error", text: string) => {
    setToast({ type, text })
    setTimeout(() => setToast(null), 3500)
  }

  const applySelectedFile = useCallback((selected: File) => {
    if (!selected.type.startsWith("image/")) {
      showToast("error", "Please select a valid image file.")
      return
    }
    setFile(selected)
    setPreview(URL.createObjectURL(selected))
    setProcessingState("idle")
    setGateBanner(null)
  }, [])

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (subTab !== "gate") return
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const pasted = item.getAsFile()
          if (pasted) {
            applySelectedFile(pasted)
            showToast("success", "Gate frame pasted from clipboard")
          }
          break
        }
      }
    }
    window.addEventListener("paste", handlePaste)
    return () => window.removeEventListener("paste", handlePaste)
  }, [subTab, applySelectedFile])

  const fetchParkingData = useCallback(async () => {
    setLoadingData(true)
    try {
      const params = new URLSearchParams({
        user_id: String(user.id),
        page: String(page),
        page_size: String(pageSize)
      })
      if (sessionSearch.trim()) params.append("search", sessionSearch.trim())
      if (sessionStatusFilter !== "ALL") params.append("status", sessionStatusFilter)

      const [sessRes, rulesRes] = await Promise.all([
        fetch(`${API_BASE}/v1/parking/sessions?${params.toString()}`),
        fetch(`${API_BASE}/v1/parking/rules?user_id=${user.id}`)
      ])

      if (sessRes.ok) {
        const data = await sessRes.json()
        setSessions(data.items || [])
        setTotalItems(data.total || 0)
        setTotalPages(data.total_pages || 1)
      }
      if (rulesRes.ok) {
        setRules(await rulesRes.json())
      }
    } catch {
      showToast("error", "Failed to sync gate records.")
    } finally {
      setLoadingData(false)
    }
  }, [user.id, page, pageSize, sessionSearch, sessionStatusFilter])

  useEffect(() => {
    fetchParkingData()
  }, [fetchParkingData])

  const handleResetGate = () => {
    setFile(null)
    setPreview(null)
    setProcessingState("idle")
    setGateBanner(null)
    setManualPlateInput("")
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const triggerGateLogic = async (plate: string, imagePath?: string) => {
    const res = await fetch(`${API_BASE}/v1/parking/gate-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: user.id,
        plate_number: plate,
        direction: gateDirection,
        image_path: imagePath
      })
    })
    const decision = await res.json()
    setGateBanner(decision)
    setProcessingState("done")
    fetchParkingData()
  }

  const handleGateScan = async () => {
    if (!file) return
    setProcessingState("scanning")
    setGateBanner(null)

    const formData = new FormData()
    formData.append("file", file)
    formData.append("user_id", String(user.id))
    formData.append("app_source", "parking")

    try {
      const res = await fetch(`${API_BASE}/v1/snapshot`, { method: "POST", body: formData })
      if (!res.ok) throw new Error("Upload failed")
      const { task_id, image_path } = await res.json()

      const poll = setInterval(async () => {
        try {
          const stRes = await fetch(`${API_BASE}/v1/status/${task_id}`)
          const stData = await stRes.json()
          if (stData.status === "completed") {
            clearInterval(poll)
            await triggerGateLogic(stData.result.plate, image_path)
          } else if (stData.status === "failed") {
            clearInterval(poll)
            setProcessingState("error")
          }
        } catch {
          clearInterval(poll)
          setProcessingState("error")
        }
      }, 700)
    } catch {
      setProcessingState("error")
    }
  }

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newPlate.trim()) return
    await fetch(`${API_BASE}/v1/parking/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: user.id,
        plate_number: newPlate,
        rule_type: newRuleType,
        owner_label: newLabel
      })
    })
    showToast("success", `Saved ${newPlate.toUpperCase()} to ${newRuleType}`)
    setNewPlate("")
    setNewLabel("")
    fetchParkingData()
  }

  const handleDeleteRule = async (ruleId: number) => {
    await fetch(`${API_BASE}/v1/parking/rules/${ruleId}`, { method: "DELETE" })
    showToast("success", "Rule removed")
    fetchParkingData()
  }

  const activeParkedCount = sessions.filter((s) => s.status === "PARKED").length
  const blockedCount = sessions.filter((s) => s.status === "BLOCKED").length
  const totalRevenue = sessions.reduce((acc, s) => acc + (s.fee_inr || 0), 0)

  return (
    <div className="min-h-screen w-screen bg-slate-950 text-slate-100 flex flex-col">
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-xl border text-xs font-semibold shadow-xl flex items-center space-x-2 ${
            toast.type === "success"
              ? "bg-emerald-950/90 border-emerald-500/50 text-emerald-200"
              : "bg-rose-950/90 border-rose-500/50 text-rose-200"
          }`}
        >
          {toast.type === "success" ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertCircle className="w-4 h-4 text-rose-400" />}
          <span>{toast.text}</span>
        </div>
      )}

      <ImageLightbox
        imageUrl={lightboxItem?.image_url || null}
        plateNumber={lightboxItem?.plate_number}
        onClose={() => setLightboxItem(null)}
      />

      {/* TOP BAR */}
      <header className="h-16 bg-slate-900 border-b border-slate-800 px-8 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={onBackToApps}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>All Apps</span>
          </button>
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-emerald-600/20 text-emerald-400 rounded-lg border border-emerald-500/30">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-white">Smart Parking & Access Control</h1>
              <p className="text-[11px] text-slate-400">Zero-Touch Entry/Exit Barrier & Tariff Engine</p>
            </div>
          </div>
        </div>

        {/* SUB-NAVIGATION TABS */}
        <div className="flex items-center space-x-2 bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => setSubTab("gate")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              subTab === "gate" ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Live Gate Control
          </button>
          <button
            onClick={() => setSubTab("sessions")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              subTab === "sessions" ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Parking Sessions ({totalItems})
          </button>
          <button
            onClick={() => setSubTab("rules")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              subTab === "rules" ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Whitelist & Watchlist ({rules.length})
          </button>
        </div>

        <button
          onClick={fetchParkingData}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium border border-slate-700"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingData ? "animate-spin" : ""}`} />
          <span>Sync</span>
        </button>
      </header>

      <main className="flex-1 p-8 max-w-[1600px] w-full mx-auto space-y-6">
        {/* KPI STRIP */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400 uppercase font-medium">Vehicles Inside</p>
              <p className="text-2xl font-bold text-white mt-1">{activeParkedCount}</p>
            </div>
            <Car className="w-6 h-6 text-emerald-400" />
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400 uppercase font-medium">Whitelisted Vehicles</p>
              <p className="text-2xl font-bold text-blue-400 mt-1">
                {rules.filter((r) => r.rule_type === "WHITELIST").length}
              </p>
            </div>
            <ShieldCheck className="w-6 h-6 text-blue-400" />
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400 uppercase font-medium">Security Alerts</p>
              <p className="text-2xl font-bold text-rose-400 mt-1">{blockedCount}</p>
            </div>
            <ShieldAlert className="w-6 h-6 text-rose-400" />
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400 uppercase font-medium">Tariff Collected</p>
              <p className="text-2xl font-bold text-amber-400 mt-1">₹{totalRevenue.toFixed(0)}</p>
            </div>
            <IndianRupee className="w-6 h-6 text-amber-400" />
          </div>
        </div>

        {/* TAB 1: LIVE GATE CONTROL */}
        {subTab === "gate" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-white">Boom Barrier Simulator</h2>
                  <p className="text-xs text-slate-400">Drop, click, or paste frame • Select lane direction</p>
                </div>

                <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
                  <button
                    onClick={() => setGateDirection("ENTRY")}
                    className={`flex items-center space-x-1 px-3 py-1.5 rounded text-xs font-bold transition-colors ${
                      gateDirection === "ENTRY" ? "bg-emerald-600 text-white" : "text-slate-400"
                    }`}
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    <span>ENTRY</span>
                  </button>
                  <button
                    onClick={() => setGateDirection("EXIT")}
                    className={`flex items-center space-x-1 px-3 py-1.5 rounded text-xs font-bold transition-colors ${
                      gateDirection === "EXIT" ? "bg-amber-600 text-white" : "text-slate-400"
                    }`}
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>EXIT</span>
                  </button>
                </div>
              </div>

              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault()
                  setIsDragging(true)
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setIsDragging(false)
                  if (e.dataTransfer.files?.[0]) applySelectedFile(e.dataTransfer.files[0])
                }}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                  isDragging
                    ? "border-emerald-400 bg-emerald-950/20"
                    : "border-slate-700 hover:border-emerald-500 bg-slate-950/60"
                }`}
              >
                <input
                  type="file"
                  className="hidden"
                  ref={fileInputRef}
                  accept="image/*"
                  onChange={(e) => e.target.files?.[0] && applySelectedFile(e.target.files[0])}
                />
                {preview ? (
                  <div className="w-full aspect-video rounded-lg overflow-hidden border border-slate-700">
                    <img src={preview} alt="Gate Frame" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="py-10 flex flex-col items-center space-y-2 text-slate-400">
                    <Upload className="w-7 h-7 text-emerald-400" />
                    <p className="text-sm font-medium text-slate-200">
                      Capture {gateDirection} Lane Vehicle Frame
                    </p>
                    <p className="text-xs text-slate-500">Click, drop image, or press Ctrl+V</p>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  disabled={!file || processingState === "scanning"}
                  onClick={handleGateScan}
                  className={`flex-1 py-3 rounded-lg font-semibold text-sm flex items-center justify-center transition-colors ${
                    !file || processingState === "scanning"
                      ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                      : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20"
                  }`}
                >
                  {processingState === "scanning" ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Verifying Plate & Access Rules...
                    </>
                  ) : (
                    <span>Process {gateDirection} Gate Vehicle</span>
                  )}
                </button>

                {file && (
                  <button
                    onClick={handleResetGate}
                    title="Next Vehicle"
                    className="px-3.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                )}
              </div>

              {gateBanner && (
                <div
                  className={`p-4 rounded-xl border space-y-3 ${
                    gateBanner.action === "LOCKED"
                      ? "bg-rose-950/60 border-rose-500/50 text-rose-200"
                      : gateBanner.action === "OPENED"
                      ? "bg-emerald-950/60 border-emerald-500/50 text-emerald-200"
                      : "bg-amber-950/60 border-amber-500/50 text-amber-200"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <IndianPlateBadge plate={gateBanner.plate_number} size="lg" />
                    <span className="flex items-center space-x-1 text-xs font-bold uppercase px-2.5 py-1.5 rounded bg-black/40 shrink-0">
                      {gateBanner.action === "OPENED" ? (
                        <>
                          <LockOpen className="w-3.5 h-3.5 text-emerald-400" />
                          <span>OPENED</span>
                        </>
                      ) : (
                        <>
                          <Lock className="w-3.5 h-3.5 text-rose-400" />
                          <span>LOCKED</span>
                        </>
                      )}
                    </span>
                  </div>

                  <p className="text-xs font-medium">{gateBanner.message}</p>

                  {gateBanner.action === "MANUAL_REVIEW" && (
                    <div className="pt-2 border-t border-amber-500/30 flex gap-2">
                      <input
                        type="text"
                        placeholder="Enter plate manually (e.g. JH01AB1234)"
                        value={manualPlateInput}
                        onChange={(e) => setManualPlateInput(e.target.value)}
                        className="flex-1 px-3 py-1.5 bg-slate-950 border border-slate-700 rounded text-xs font-mono uppercase text-white"
                      />
                      <button
                        onClick={() => manualPlateInput.trim() && triggerGateLogic(manualPlateInput)}
                        className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded"
                      >
                        Override & Open
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col">
              <div className="mb-4">
                <h2 className="text-base font-semibold text-white">Live Gate & Parking Activity</h2>
                <p className="text-xs text-slate-400">Click any row to inspect the captured gate frame</p>
              </div>

              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-[11px] font-semibold uppercase text-slate-400">
                      <th className="py-3 px-3">Vehicle Plate</th>
                      <th className="py-3 px-3">Access Type</th>
                      <th className="py-3 px-3">Entry Time</th>
                      <th className="py-3 px-3">Duration</th>
                      <th className="py-3 px-3">Fee</th>
                      <th className="py-3 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 text-xs">
                    {sessions.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-slate-500">
                          No gate events recorded yet. Scan a vehicle at the Entry Gate to start.
                        </td>
                      </tr>
                    ) : (
                      sessions.slice(0, 10).map((s) => (
                        <tr
                          key={s.id}
                          onClick={() => s.image_url && setLightboxItem(s)}
                          className={`hover:bg-slate-800/40 ${s.image_url ? "cursor-pointer" : ""}`}
                        >
                          <td className="py-3 px-3">
                            <IndianPlateBadge plate={s.plate_number} size="sm" />
                          </td>
                          <td className="py-3 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                s.access_type === "WHITELIST"
                                  ? "bg-blue-500/15 text-blue-400"
                                  : s.access_type === "BLACKLIST"
                                  ? "bg-rose-500/15 text-rose-400"
                                  : "bg-amber-500/15 text-amber-400"
                              }`}
                            >
                              {s.access_type}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-slate-400">
                            {s.entry_time ? new Date(s.entry_time).toLocaleTimeString() : "-"}
                          </td>
                          <td className="py-3 px-3 text-slate-300">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="w-3 h-3 text-slate-500" />
                              {s.status === "PARKED" ? "Active" : `${s.duration_mins}m`}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-semibold text-white">₹{s.fee_inr.toFixed(0)}</td>
                          <td className="py-3 px-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                s.status === "PARKED"
                                  ? "bg-emerald-500/15 text-emerald-400"
                                  : s.status === "BLOCKED"
                                  ? "bg-rose-500/15 text-rose-400"
                                  : "bg-slate-700 text-slate-300"
                              }`}
                            >
                              {s.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: FULL PARKING SESSIONS WITH SERVER-SIDE PAGINATION & SEARCH */}
        {subTab === "sessions" && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-base font-semibold text-white">Complete Parking & Gate Audit Log</h2>

              <div className="flex items-center space-x-3">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2" />
                  <input
                    type="text"
                    placeholder="Filter by plate..."
                    value={sessionSearch}
                    onChange={(e) => {
                      setSessionSearch(e.target.value)
                      setPage(1)
                    }}
                    className="pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <select
                  value={sessionStatusFilter}
                  onChange={(e) => {
                    setSessionStatusFilter(e.target.value as any)
                    setPage(1)
                  }}
                  className="px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="PARKED">Currently Parked</option>
                  <option value="EXITED">Exited</option>
                  <option value="BLOCKED">Blocked Alerts</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-xs font-semibold uppercase text-slate-400">
                    <th className="py-3 px-4">ID</th>
                    <th className="py-3 px-4">Snapshot</th>
                    <th className="py-3 px-4">Plate Number</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4">Entry</th>
                    <th className="py-3 px-4">Exit</th>
                    <th className="py-3 px-4">Duration</th>
                    <th className="py-3 px-4">Tariff</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-xs">
                  {sessions.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-500">
                        No matching parking sessions found.
                      </td>
                    </tr>
                  ) : (
                    sessions.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-800/40">
                        <td className="py-3 px-4 text-slate-400">#{s.id}</td>
                        <td className="py-3 px-4">
                          {s.image_url ? (
                            <button
                              onClick={() => setLightboxItem(s)}
                              className="relative group block rounded overflow-hidden border border-slate-700"
                            >
                              <img src={s.image_url} alt={s.plate_number} className="w-16 h-10 object-cover" />
                              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                <Maximize2 className="w-3.5 h-3.5 text-white" />
                              </div>
                            </button>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <IndianPlateBadge plate={s.plate_number} size="sm" />
                        </td>
                        <td className="py-3 px-4 text-slate-300">{s.access_type}</td>
                        <td className="py-3 px-4 text-slate-400">
                          {s.entry_time ? new Date(s.entry_time).toLocaleString() : "-"}
                        </td>
                        <td className="py-3 px-4 text-slate-400">
                          {s.exit_time ? new Date(s.exit_time).toLocaleString() : "-"}
                        </td>
                        <td className="py-3 px-4 text-slate-300">{s.duration_mins} mins</td>
                        <td className="py-3 px-4 font-semibold text-amber-400">₹{s.fee_inr.toFixed(0)}</td>
                        <td className="py-3 px-4 font-semibold text-white">{s.status}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <PaginationBar
              page={page}
              totalPages={totalPages}
              totalItems={totalItems}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(sz) => {
                setPageSize(sz)
                setPage(1)
              }}
            />
          </div>
        )}

        {/* TAB 3: PERSISTENT WHITELIST & BLACKLIST RULES */}
        {subTab === "rules" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
              <h3 className="text-base font-semibold text-white">Register Vehicle Rule</h3>
              <p className="text-xs text-slate-400">
                Saved directly to MySQL (`vehicle_rules`) for automated gate decisions.
              </p>
              <form onSubmit={handleAddRule} className="space-y-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">License Plate</label>
                  <input
                    type="text"
                    required
                    placeholder="JH01FW4809"
                    value={newPlate}
                    onChange={(e) => setNewPlate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm font-mono uppercase text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Rule Action</label>
                  <select
                    value={newRuleType}
                    onChange={(e) => setNewRuleType(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white"
                  >
                    <option value="WHITELIST">Whitelist (Resident / VIP Auto-Open)</option>
                    <option value="BLACKLIST">Blacklist (Lock Gate & Trigger Alert)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Owner / Note</label>
                  <input
                    type="text"
                    placeholder="e.g. Tower B - Flat 304"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-4 h-4" /> Save Rule to Database
                </button>
              </form>
            </div>

            <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-xl p-6">
              <h3 className="text-base font-semibold text-white mb-4">Active Access Control Rules ({rules.length})</h3>
              <div className="divide-y divide-slate-800">
                {rules.length === 0 ? (
                  <p className="py-8 text-center text-xs text-slate-500">
                    No rules added yet. Unlisted plates are automatically treated as Visitors (₹20/hr tariff).
                  </p>
                ) : (
                  rules.map((r) => (
                    <div key={r.id} className="py-3 flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <IndianPlateBadge plate={r.plate_number} size="sm" />
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            r.rule_type === "WHITELIST"
                              ? "bg-blue-500/15 text-blue-400"
                              : "bg-rose-500/15 text-rose-400"
                          }`}
                        >
                          {r.rule_type}
                        </span>
                        {r.owner_label && <span className="text-xs text-slate-400">{r.owner_label}</span>}
                      </div>
                      <button
                        onClick={() => handleDeleteRule(r.id)}
                        className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}