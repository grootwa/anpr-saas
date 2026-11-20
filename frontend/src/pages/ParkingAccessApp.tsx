import { useState, useEffect, useCallback } from "react"
import {
  ArrowLeft,
  ShieldCheck,
  ShieldAlert,
  Car,
  LogIn,
  LogOut,
  IndianRupee,
  Clock,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Search,
  Maximize2,
  Video,
  Square,
  Play
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

interface LaneState {
  lane: "ENTRY" | "EXIT"
  source_url: string
  line_y_ratio: number
  is_running: boolean
  connected: boolean
  status_text: string
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

  useEffect(() => {
    localStorage.setItem("anpr_parking_subtab", subTab)
  }, [subTab])

  // Dual Live Stream State (ENTRY & EXIT)
  const [lanes, setLanes] = useState<Record<"ENTRY" | "EXIT", LaneState>>({
    ENTRY: {
      lane: "ENTRY",
      source_url: "",
      line_y_ratio: 0.65,
      is_running: false,
      connected: false,
      status_text: "Offline",
    },
    EXIT: {
      lane: "EXIT",
      source_url: "",
      line_y_ratio: 0.65,
      is_running: false,
      connected: false,
      status_text: "Offline",
    },
  })
  const [streamNonce, setStreamNonce] = useState(Date.now())

  // Manual Override Bar for Unreadable Plates
  const [overridePlate, setOverridePlate] = useState("")
  const [overrideDir, setOverrideDir] = useState<"ENTRY" | "EXIT">("ENTRY")
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null)

  // Persistent Sessions & Server-Side Pagination State
  const [sessions, setSessions] = useState<ParkingSessionItem[]>([])
  const [sessionSearch, setSessionSearch] = useState("")
  const [sessionStatusFilter, setSessionStatusFilter] = useState<"ALL" | "PARKED" | "EXITED" | "BLOCKED">("ALL")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(15)
  const [totalItems, setTotalItems] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  // Access Control Rules
  const [rules, setRules] = useState<VehicleRuleItem[]>([])
  const [newPlate, setNewPlate] = useState("")
  const [newRuleType, setNewRuleType] = useState<"WHITELIST" | "BLACKLIST">("WHITELIST")
  const [newLabel, setNewLabel] = useState("")
  const [loadingData, setLoadingData] = useState(false)
  const [lightboxItem, setLightboxItem] = useState<ParkingSessionItem | null>(null)

  const showToast = (type: "success" | "error", text: string) => {
    setToast({ type, text })
    setTimeout(() => setToast(null), 3500)
  }

  const fetchStreamConfigs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/stream/config?user_id=${user.id}`)
      if (res.ok) setLanes(await res.json())
    } catch {
      // Ignore transient network errors during reload
    }
  }, [user.id])

  const fetchParkingData = useCallback(async () => {
    setLoadingData(true)
    try {
      const params = new URLSearchParams({
        user_id: String(user.id),
        page: String(page),
        page_size: String(pageSize),
      })
      if (sessionSearch.trim()) params.append("search", sessionSearch.trim())
      if (sessionStatusFilter !== "ALL") params.append("status", sessionStatusFilter)

      const [sessRes, rulesRes] = await Promise.all([
        fetch(`${API_BASE}/v1/parking/sessions?${params.toString()}`),
        fetch(`${API_BASE}/v1/parking/rules?user_id=${user.id}`),
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
    fetchStreamConfigs()
    fetchParkingData()
  }, [fetchStreamConfigs, fetchParkingData])

  // Auto-poll sessions every 2.5s whenever ENTRY or EXIT camera stream is active
  useEffect(() => {
    if (!lanes.ENTRY.is_running && !lanes.EXIT.is_running) return
    const timer = setInterval(() => {
      fetchParkingData()
    }, 2500)
    return () => clearInterval(timer)
  }, [lanes.ENTRY.is_running, lanes.EXIT.is_running, fetchParkingData])

  const handleStartLane = async (lane: "ENTRY" | "EXIT") => {
    const cfg = lanes[lane]
    if (!cfg.source_url.trim()) {
      showToast("error", `Enter an RTSP URL, video path, or webcam index (0/1) for ${lane}.`)
      return
    }
    const res = await fetch(`${API_BASE}/v1/stream/configure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: user.id,
        lane,
        source_url: cfg.source_url,
        line_y_ratio: cfg.line_y_ratio,
        start_now: true,
      }),
    })
    if (res.ok) {
      setStreamNonce(Date.now())
      await fetchStreamConfigs()
      showToast("success", `${lane} stream started`)
    }
  }

  const handleStopLane = async (lane: "ENTRY" | "EXIT") => {
    await fetch(`${API_BASE}/v1/stream/stop?user_id=${user.id}&lane=${lane}`, { method: "POST" })
    await fetchStreamConfigs()
    showToast("success", `${lane} stream stopped`)
  }

  const handleLineSlider = async (lane: "ENTRY" | "EXIT", newRatio: number) => {
    setLanes((prev) => ({
      ...prev,
      [lane]: { ...prev[lane], line_y_ratio: newRatio },
    }))
    await fetch(`${API_BASE}/v1/stream/line`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: user.id,
        lane,
        line_y_ratio: newRatio,
      }),
    })
  }

  const handleManualOverride = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!overridePlate.trim()) return
    const res = await fetch(`${API_BASE}/v1/parking/gate-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: user.id,
        plate_number: overridePlate,
        direction: overrideDir,
      }),
    })
    if (res.ok) {
      const data = await res.json()
      showToast(data.action === "LOCKED" ? "error" : "success", data.message)
      setOverridePlate("")
      fetchParkingData()
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
        owner_label: newLabel,
      }),
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
          {toast.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400" />
          )}
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
              <p className="text-[11px] text-slate-400">Dual-Lane Live Tripwire ANPR & Barrier Engine</p>
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
            Live Gate Feeds
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
          onClick={() => {
            fetchStreamConfigs()
            fetchParkingData()
          }}
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

        {/* TAB 1: DUAL LIVE GATE FEEDS + LIVE ACTIVITY */}
        {subTab === "gate" && (
          <div className="space-y-6">
            {/* ENTRY & EXIT STREAM WALL */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {(["ENTRY", "EXIT"] as const).map((laneKey) => {
                const cfg = lanes[laneKey]
                const isEntry = laneKey === "ENTRY"
                return (
                  <div key={laneKey} className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        {isEntry ? (
                          <LogIn className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <LogOut className="w-4 h-4 text-amber-400" />
                        )}
                        <h3 className="text-sm font-bold text-white">{laneKey} LANE CAMERA FEED</h3>
                      </div>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          cfg.is_running
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse"
                            : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        {cfg.is_running ? cfg.status_text : "Offline"}
                      </span>
                    </div>

                    {/* MJPEG VIDEO VIEWPORT */}
                    <div className="w-full aspect-video bg-slate-950 rounded-xl overflow-hidden border border-slate-800 flex items-center justify-center">
                      {cfg.is_running ? (
                        <img
                          src={`${API_BASE}/v1/stream/feed/${laneKey}?user_id=${user.id}&t=${streamNonce}`}
                          alt={`${laneKey} Live Feed`}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <div className="text-center space-y-1.5 text-slate-500 px-4">
                          <Video className="w-7 h-7 mx-auto text-slate-600" />
                          <p className="text-xs font-semibold text-slate-400">No Active {laneKey} Video Feed</p>
                          <p className="text-[11px]">
                            Enter RTSP URL, MP4 video file path, or webcam index (0 / 1) below
                          </p>
                        </div>
                      )}
                    </div>

                    {/* STREAM SOURCE & TRIPWIRE CONTROLS */}
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="rtsp://... or /path/to/video.mp4 or 0"
                          value={cfg.source_url}
                          onChange={(e) =>
                            setLanes((prev) => ({
                              ...prev,
                              [laneKey]: { ...prev[laneKey], source_url: e.target.value },
                            }))
                          }
                          className="flex-1 px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                        />
                        {cfg.is_running ? (
                          <button
                            onClick={() => handleStopLane(laneKey)}
                            className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-1.5"
                          >
                            <Square className="w-3.5 h-3.5" /> Stop
                          </button>
                        ) : (
                          <button
                            onClick={() => handleStartLane(laneKey)}
                            className={`px-4 py-2 rounded-lg text-white text-xs font-bold flex items-center gap-1.5 ${
                              isEntry ? "bg-emerald-600 hover:bg-emerald-500" : "bg-amber-600 hover:bg-amber-500"
                            }`}
                          >
                            <Play className="w-3.5 h-3.5" /> Start Feed
                          </button>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-4 text-xs text-slate-400">
                        <span className="shrink-0">
                          Bottom-Edge Tripwire Y: <strong className="text-slate-200">{Math.round(cfg.line_y_ratio * 100)}%</strong>
                        </span>
                        <input
                          type="range"
                          min={15}
                          max={90}
                          value={Math.round(cfg.line_y_ratio * 100)}
                          onChange={(e) => handleLineSlider(laneKey, Number(e.target.value) / 100)}
                          className="w-full accent-emerald-500 cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* LIVE GATE & PARKING ACTIVITY TABLE + OPERATOR OVERRIDE */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-white">Live Gate & Parking Activity</h2>
                  <p className="text-xs text-slate-400">
                    Auto-updates when a vehicle&apos;s bottom edge crosses ENTRY or EXIT tripwires • Click any row to inspect frame
                  </p>
                </div>

                {/* QUICK MANUAL GATE OVERRIDE */}
                <form onSubmit={handleManualOverride} className="flex items-center gap-2">
                  <select
                    value={overrideDir}
                    onChange={(e) => setOverrideDir(e.target.value as "ENTRY" | "EXIT")}
                    className="px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs font-bold text-white"
                  >
                    <option value="ENTRY">ENTRY</option>
                    <option value="EXIT">EXIT</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Manual plate override..."
                    value={overridePlate}
                    onChange={(e) => setOverridePlate(e.target.value)}
                    className="px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono uppercase text-white"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-semibold text-slate-200"
                  >
                    Manual Clear
                  </button>
                </form>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-[11px] font-semibold uppercase text-slate-400">
                      <th className="py-3 px-3">Vehicle Plate</th>
                      <th className="py-3 px-3">Access Type</th>
                      <th className="py-3 px-3">Entry Time</th>
                      <th className="py-3 px-3">Exit Time</th>
                      <th className="py-3 px-3">Duration</th>
                      <th className="py-3 px-3">Fee</th>
                      <th className="py-3 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 text-xs">
                    {sessions.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-slate-500">
                          No gate events recorded yet. Start ENTRY or EXIT camera feeds to detect vehicles automatically.
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
                          <td className="py-3 px-3 text-slate-400">
                            {s.exit_time ? new Date(s.exit_time).toLocaleTimeString() : "-"}
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