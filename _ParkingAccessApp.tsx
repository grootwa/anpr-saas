import { useState, useEffect, useCallback, useRef } from "react"
import {
  ArrowLeft,
  ShieldCheck,
  ShieldAlert,
  Car,
  IndianRupee,
  Clock,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Search,
  Maximize2,
  Bell,
  X,
  Building2,
  Tags,
  Users,
  Video,
  LayoutDashboard,
  FileSpreadsheet,
  Download
} from "lucide-react"
import type { UserSession } from "../App"
import IndianPlateBadge from "../components/IndianPlateBadge"
import ImageLightbox from "../components/ImageLightbox"
import PaginationBar from "../components/PaginationBar"
import CameraManagerSection from "../components/CameraManagerSection"

interface ParkingAppProps {
  user: UserSession
  onBackToApps: () => void
}

interface ParkingSessionItem {
  id: number
  plate_number: string
  vehicle_type: string
  parking_type: string
  access_type: "WHITELIST" | "VISITOR" | "BLACKLIST"
  gate_action: "OPENED" | "LOCKED"
  entry_gate: string | null
  exit_gate: string | null
  entry_time: string
  exit_time: string | null
  duration_mins: number
  fee_inr: number
  status: "PARKED" | "EXITED" | "BLOCKED"
  entry_image_url: string | null
  exit_image_url: string | null
}

interface RecentGateEvent {
  event_key: string
  session_id: number
  plate_number: string
  vehicle_type: string
  access_type: string
  status: "PARKED" | "EXITED" | "BLOCKED"
  gate: string | null
  fee_inr: number
  timestamp: string | null
  image_url: string | null
}

const API_BASE = "http://localhost:8000"

type SubTabKey = "dashboard" | "reports" | "cameras" | "vehicles" | "rates" | "org"

export default function ParkingAccessApp({ user, onBackToApps }: ParkingAppProps) {
  const [subTab, setSubTab] = useState<SubTabKey>(() => {
    const saved = localStorage.getItem("anpr_parking_subtab") as SubTabKey
    return ["dashboard", "reports", "cameras", "vehicles", "rates", "org"].includes(saved)
      ? saved
      : "dashboard"
  })

  useEffect(() => {
    localStorage.setItem("anpr_parking_subtab", subTab)
  }, [subTab])

  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [eventPopup, setEventPopup] = useState<RecentGateEvent | null>(null)
  const lastSeenEventKeyRef = useRef<string | null>(null)

  const [lightboxData, setLightboxData] = useState<{ url: string | null; plate?: string }>({ url: null })

  // Today's KPI Stats (Current Day)
  const [todayStats, setTodayStats] = useState({
    today_entries: 0,
    today_exits: 0,
    today_alerts: 0,
    today_revenue: 0,
    currently_parked: 0,
    occupancy: {
      "2W": { occupied: 0, total: 0, available: 0 },
      "4W": { occupied: 0, total: 0, available: 0 },
      HCV: { occupied: 0, total: 0, available: 0 },
    },
  })

  // Sessions State (Today on Dashboard; Paginated All-Time on Reports)
  const [sessions, setSessions] = useState<ParkingSessionItem[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PARKED" | "EXITED" | "BLOCKED">("ALL")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(15)
  const [totalItems, setTotalItems] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)

  // Vehicle & Owner Registry State
  const [vehicles, setVehicles] = useState<any[]>([])
  const [vehSearch, setVehSearch] = useState("")
  const [vForm, setVForm] = useState({
    plate_number: "",
    owner_name: "",
    phone_number: "",
    flat_or_unit: "",
    vehicle_type: "4W",
    parking_type: "RESIDENT",
    access_status: "WHITELIST",
    valid_until: "",
  })

  // Rate Configurator State
  const [rates, setRates] = useState<any[]>([])
  const [rForm, setRForm] = useState({
    vehicle_type: "4W",
    parking_type: "VISITOR",
    grace_period_mins: 15,
    base_hours: 1,
    base_fee_inr: 20,
    extra_hourly_rate_inr: 10,
    daily_max_cap_inr: 200,
    is_free_for_whitelist: true,
  })

  // Organization & Capacity State
  const [orgForm, setOrgForm] = useState({
    org_name: "Smart Parking Facility",
    address: "",
    contact_phone: "",
    gst_number: "",
    parking_types: ["VISITOR", "RESIDENT", "VIP", "EV"],
    slots: {
      "2W": { VISITOR: 40, RESIDENT: 30, VIP: 10, EV: 10 },
      "4W": { VISITOR: 50, RESIDENT: 40, VIP: 15, EV: 10 },
      HCV: { VISITOR: 10, RESIDENT: 5, VIP: 2, EV: 0 },
    } as Record<string, Record<string, number>>,
  })
  const [newParkingType, setNewParkingType] = useState("")

  const showToast = useCallback((type: "success" | "error", text: string) => {
    setToast({ type, text })
    setTimeout(() => setToast(null), 3500)
  }, [])

  const fetchTodayStats = useCallback(async () => {
    const res = await fetch(`${API_BASE}/v1/parking/stats/today?user_id=${user.id}`)
    if (res.ok) setTodayStats(await res.json())
  }, [user.id])

  const fetchSessions = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        user_id: String(user.id),
        page: String(subTab === "dashboard" ? 1 : page),
        page_size: String(subTab === "dashboard" ? 20 : pageSize),
        today_only: subTab === "dashboard" ? "true" : "false",
      })
      if (searchQuery.trim()) params.append("search", searchQuery.trim())
      if (statusFilter !== "ALL") params.append("status", statusFilter)

      const res = await fetch(`${API_BASE}/v1/parking/sessions?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setSessions(data.items || [])
        setTotalItems(data.total || 0)
        setTotalPages(data.total_pages || 1)
      }
    } finally {
      setLoading(false)
    }
  }, [user.id, subTab, page, pageSize, searchQuery, statusFilter])

  const fetchVehicles = useCallback(async () => {
    const params = new URLSearchParams({ user_id: String(user.id) })
    if (vehSearch.trim()) params.append("search", vehSearch.trim())
    const res = await fetch(`${API_BASE}/v1/parking/vehicles?${params.toString()}`)
    if (res.ok) setVehicles(await res.json())
  }, [user.id, vehSearch])

  const fetchRates = useCallback(async () => {
    const res = await fetch(`${API_BASE}/v1/parking/rates?user_id=${user.id}`)
    if (res.ok) setRates(await res.json())
  }, [user.id])

  const fetchOrgConfig = useCallback(async () => {
    const res = await fetch(`${API_BASE}/v1/parking/org-config?user_id=${user.id}`)
    if (res.ok) {
      const data = await res.json()
      setOrgForm({
        org_name: data.org_name || "Smart Parking Facility",
        address: data.address || "",
        contact_phone: data.contact_phone || "",
        gst_number: data.gst_number || "",
        parking_types: data.capacity_data?.parking_types || ["VISITOR", "RESIDENT", "VIP", "EV"],
        slots: data.capacity_data?.slots || orgForm.slots,
      })
    }
  }, [user.id])

  useEffect(() => {
    fetchTodayStats()
    if (subTab === "dashboard" || subTab === "reports") fetchSessions()
    if (subTab === "vehicles") fetchVehicles()
    if (subTab === "rates") fetchRates()
    if (subTab === "org") fetchOrgConfig()
  }, [subTab, fetchTodayStats, fetchSessions, fetchVehicles, fetchRates, fetchOrgConfig])

  // Lightweight Event Notification Poller (no video streaming on dashboard!)
  useEffect(() => {
    let active = true
    const pollEvents = async () => {
      try {
        const res = await fetch(`${API_BASE}/v1/parking/events/recent?user_id=${user.id}`)
        if (!res.ok || !active) return
        const list: RecentGateEvent[] = await res.json()
        if (list.length > 0) {
          const newest = list[0]
          if (lastSeenEventKeyRef.current === null) {
            lastSeenEventKeyRef.current = newest.event_key
          } else if (lastSeenEventKeyRef.current !== newest.event_key) {
            lastSeenEventKeyRef.current = newest.event_key
            setEventPopup(newest)
            fetchTodayStats()
            if (subTab === "dashboard") fetchSessions()
            window.setTimeout(() => {
              setEventPopup((curr) => (curr?.event_key === newest.event_key ? null : curr))
            }, 6500)
          }
        }
      } catch {
        // Ignore transient errors
      }
    }

    pollEvents()
    const interval = window.setInterval(pollEvents, 2500)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [user.id, subTab, fetchTodayStats, fetchSessions])

  const handleRegisterVehicle = async (e: React.FormEvent) => {
    e.preventDefault()
    const res = await fetch(`${API_BASE}/v1/parking/vehicles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: user.id, ...vForm }),
    })
    if (res.ok) {
      showToast("success", `Registered ${vForm.plate_number.toUpperCase()}`)
      setVForm({
        plate_number: "",
        owner_name: "",
        phone_number: "",
        flat_or_unit: "",
        vehicle_type: "4W",
        parking_type: "RESIDENT",
        access_status: "WHITELIST",
        valid_until: "",
      })
      fetchVehicles()
    }
  }

  const handleSaveRate = async (e: React.FormEvent) => {
    e.preventDefault()
    const res = await fetch(`${API_BASE}/v1/parking/rates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: user.id, ...rForm }),
    })
    if (res.ok) {
      showToast("success", `Saved tariff rule for ${rForm.vehicle_type} (${rForm.parking_type})`)
      fetchRates()
    }
  }

  const handleSaveOrg = async (e: React.FormEvent) => {
    e.preventDefault()
    const res = await fetch(`${API_BASE}/v1/parking/org-config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: user.id,
        org_name: orgForm.org_name,
        address: orgForm.address,
        contact_phone: orgForm.contact_phone,
        gst_number: orgForm.gst_number,
        capacity_data: {
          parking_types: orgForm.parking_types,
          slots: orgForm.slots,
        },
      }),
    })
    if (res.ok) {
      showToast("success", "Organization & slot capacity saved")
      fetchTodayStats()
    }
  }

  const exportCSV = () => {
    const headers = ["ID", "Plate", "Type", "Access", "Entry Gate", "Entry Time", "Exit Gate", "Exit Time", "Duration (m)", "Fee (INR)", "Status"]
    const rows = sessions.map((s) => [
      s.id,
      s.plate_number,
      s.vehicle_type,
      s.access_type,
      s.entry_gate || "",
      s.entry_time || "",
      s.exit_gate || "",
      s.exit_time || "",
      s.duration_mins,
      s.fee_inr,
      s.status,
    ])
    const csv = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n")
    const link = document.createElement("a")
    link.setAttribute("href", encodeURI(csv))
    link.setAttribute("download", `parking_report_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="min-h-screen w-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* STANDARD TOAST */}
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

      {/* REAL-TIME GATE EVENT NOTIFICATION POP-UP */}
      {eventPopup && (
        <div
          onClick={() => eventPopup.image_url && setLightboxData({ url: eventPopup.image_url, plate: eventPopup.plate_number })}
          className={`fixed top-20 right-6 z-50 w-80 rounded-2xl border p-4 shadow-2xl cursor-pointer transition-all backdrop-blur-md ${
            eventPopup.status === "BLOCKED"
              ? "bg-rose-950/95 border-rose-500 text-rose-100"
              : eventPopup.status === "EXITED"
              ? "bg-amber-950/95 border-amber-500/70 text-amber-100"
              : "bg-emerald-950/95 border-emerald-500/70 text-emerald-100"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider">
              <Bell className="w-3.5 h-3.5 animate-bounce" />
              <span>
                {eventPopup.status === "BLOCKED"
                  ? "Security Alert"
                  : eventPopup.status === "EXITED"
                  ? "Vehicle Exit Cleared"
                  : "Vehicle Entry Recorded"}
              </span>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setEventPopup(null)
              }}
              className="text-slate-300 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-2.5 flex items-center justify-between gap-3">
            <div className="space-y-1">
              <IndianPlateBadge plate={eventPopup.plate_number} size="sm" />
              <p className="text-[11px] opacity-90">
                Gate: <strong>{eventPopup.gate || "-"}</strong> • {eventPopup.vehicle_type}
              </p>
              {eventPopup.status === "EXITED" && (
                <p className="text-xs font-bold text-amber-300">Tariff: ₹{eventPopup.fee_inr.toFixed(0)}</p>
              )}
            </div>
            {eventPopup.image_url && (
              <img
                src={eventPopup.image_url}
                alt={eventPopup.plate_number}
                className="w-20 h-14 object-cover rounded-lg border border-white/20 shrink-0"
              />
            )}
          </div>
        </div>
      )}

      <ImageLightbox
        imageUrl={lightboxData.url}
        plateNumber={lightboxData.plate}
        onClose={() => setLightboxData({ url: null })}
      />

      {/* TOP HEADER */}
      <header className="h-16 bg-slate-900 border-b border-slate-800 px-6 flex items-center justify-between gap-4">
        <div className="flex items-center space-x-3 shrink-0">
          <button
            onClick={onBackToApps}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Apps</span>
          </button>
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-emerald-600/20 text-emerald-400 rounded-lg border border-emerald-500/30">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-white">{orgForm.org_name}</h1>
              <p className="text-[11px] text-slate-400">ANPR Parking & Gate Operations</p>
            </div>
          </div>
        </div>

        {/* NAVIGATION TABS */}
        <nav className="flex items-center space-x-1 bg-slate-950 p-1 rounded-xl border border-slate-800 overflow-x-auto">
          {[
            { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
            { key: "reports", label: "Audit Logs", icon: FileSpreadsheet },
            { key: "cameras", label: "Cameras", icon: Video },
            { key: "vehicles", label: "Vehicles & Owners", icon: Users },
            { key: "rates", label: "Rate Configurator", icon: Tags },
            { key: "org", label: "Organization & Slots", icon: Building2 },
          ].map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.key}
                onClick={() => {
                  setSubTab(t.key as SubTabKey)
                  setPage(1)
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  subTab === t.key ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
              </button>
            )
          })}
        </nav>

        <button
          onClick={() => {
            fetchTodayStats()
            fetchSessions()
          }}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium border border-slate-700 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          <span>Sync</span>
        </button>
      </header>

      <main className="flex-1 p-6 max-w-[1650px] w-full mx-auto space-y-6">
        {/* CURRENT-DAY KPI CARDS (TODAY'S STATS, NOT CURRENT PAGE) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-[11px] text-slate-400 uppercase font-semibold">Today&apos;s Entries</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">{todayStats.today_entries}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Exits Today: {todayStats.today_exits}</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-[11px] text-slate-400 uppercase font-semibold">Vehicles Inside Now</p>
            <p className="text-2xl font-bold text-white mt-1">{todayStats.currently_parked}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              2W: {todayStats.occupancy["2W"]?.available ?? 0} free • 4W: {todayStats.occupancy["4W"]?.available ?? 0} free
            </p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-[11px] text-slate-400 uppercase font-semibold">Slot Availability</p>
            <div className="mt-1.5 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">2-Wheeler:</span>
                <span className="font-bold text-blue-400">
                  {todayStats.occupancy["2W"]?.available}/{todayStats.occupancy["2W"]?.total}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">4-Wheeler / HCV:</span>
                <span className="font-bold text-emerald-400">
                  {todayStats.occupancy["4W"]?.available}/{todayStats.occupancy["4W"]?.total} •{" "}
                  {todayStats.occupancy.HCV?.available}/{todayStats.occupancy.HCV?.total}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-[11px] text-slate-400 uppercase font-semibold">Today&apos;s Alerts</p>
              <p className="text-2xl font-bold text-rose-400 mt-1">{todayStats.today_alerts}</p>
            </div>
            <ShieldAlert className="w-6 h-6 text-rose-400" />
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-[11px] text-slate-400 uppercase font-semibold">Today&apos;s Collection</p>
              <p className="text-2xl font-bold text-amber-400 mt-1">₹{todayStats.today_revenue.toFixed(0)}</p>
            </div>
            <IndianRupee className="w-6 h-6 text-amber-400" />
          </div>
        </div>

        {/* 1. OPERATIONS DASHBOARD (NO LIVE FEEDS — TODAY'S TABLE WITH ENTRY & EXIT IMAGES) */}
        {(subTab === "dashboard" || subTab === "reports") && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-white">
                  {subTab === "dashboard" ? "Today's Gate Entry & Exit Log" : "Complete Parking Audit Repository"}
                </h2>
                <p className="text-xs text-slate-400">
                  Click any Entry or Exit frame thumbnail to inspect full-resolution capture
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2" />
                  <input
                    type="text"
                    placeholder="Search plate..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value)
                      setPage(1)
                    }}
                    className="pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white"
                  />
                </div>

                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value as any)
                    setPage(1)
                  }}
                  className="px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="PARKED">Currently Parked</option>
                  <option value="EXITED">Exited</option>
                  <option value="BLOCKED">Blocked Alerts</option>
                </select>

                {subTab === "reports" && (
                  <button
                    onClick={exportCSV}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
                  >
                    <Download className="w-3.5 h-3.5" /> Export CSV
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] font-semibold uppercase text-slate-400">
                    <th className="py-3 px-3">Plate</th>
                    <th className="py-3 px-3">Type / Access</th>
                    <th className="py-3 px-3">Entry Image</th>
                    <th className="py-3 px-3">Entry Gate & Time</th>
                    <th className="py-3 px-3">Exit Image</th>
                    <th className="py-3 px-3">Exit Gate & Time</th>
                    <th className="py-3 px-3">Duration</th>
                    <th className="py-3 px-3">Fee</th>
                    <th className="py-3 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 text-xs">
                  {sessions.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-500">
                        No gate events recorded for this view.
                      </td>
                    </tr>
                  ) : (
                    sessions.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-800/40">
                        <td className="py-2.5 px-3">
                          <IndianPlateBadge plate={s.plate_number} size="sm" />
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex flex-col gap-1">
                            <span className="font-bold text-slate-200">{s.vehicle_type}</span>
                            <span
                              className={`w-fit px-2 py-0.5 rounded text-[10px] font-bold ${
                                s.access_type === "WHITELIST"
                                  ? "bg-blue-500/15 text-blue-400"
                                  : s.access_type === "BLACKLIST"
                                  ? "bg-rose-500/15 text-rose-400"
                                  : "bg-amber-500/15 text-amber-400"
                              }`}
                            >
                              {s.access_type}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          {s.entry_image_url ? (
                            <button
                              onClick={() => setLightboxData({ url: s.entry_image_url, plate: s.plate_number })}
                              className="relative group block rounded overflow-hidden border border-slate-700"
                            >
                              <img src={s.entry_image_url} alt="Entry" className="w-16 h-10 object-cover" />
                              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center">
                                <Maximize2 className="w-3.5 h-3.5 text-white" />
                              </div>
                            </button>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-slate-300">
                          <div className="font-medium text-white">{s.entry_gate || "-"}</div>
                          <div className="text-[11px] text-slate-400">
                            {s.entry_time ? new Date(s.entry_time).toLocaleString() : "-"}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          {s.exit_image_url ? (
                            <button
                              onClick={() => setLightboxData({ url: s.exit_image_url, plate: s.plate_number })}
                              className="relative group block rounded overflow-hidden border border-slate-700"
                            >
                              <img src={s.exit_image_url} alt="Exit" className="w-16 h-10 object-cover" />
                              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center">
                                <Maximize2 className="w-3.5 h-3.5 text-white" />
                              </div>
                            </button>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-slate-300">
                          <div className="font-medium text-white">{s.exit_gate || "-"}</div>
                          <div className="text-[11px] text-slate-400">
                            {s.exit_time ? new Date(s.exit_time).toLocaleString() : "-"}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-300">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-500" />
                            {s.status === "PARKED" ? "Inside" : `${s.duration_mins}m`}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-bold text-amber-400">₹{s.fee_inr.toFixed(0)}</td>
                        <td className="py-2.5 px-3">
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

            {subTab === "reports" && (
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
            )}
          </div>
        )}

        {/* 2. CAMERA MANAGEMENT SECTION */}
        {subTab === "cameras" && (
          <CameraManagerSection userId={user.id} apiBase={API_BASE} onNotify={showToast} />
        )}

        {/* 3. VEHICLES & OWNERS REGISTRY PAGE */}
        {subTab === "vehicles" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
              <h3 className="text-base font-bold text-white">Register Vehicle & Owner</h3>
              <form onSubmit={handleRegisterVehicle} className="space-y-3">
                <input
                  type="text"
                  required
                  placeholder="License Plate (e.g. JH01FW4809)"
                  value={vForm.plate_number}
                  onChange={(e) => setVForm({ ...vForm, plate_number: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono uppercase text-white"
                />
                <input
                  type="text"
                  required
                  placeholder="Owner Full Name"
                  value={vForm.owner_name}
                  onChange={(e) => setVForm({ ...vForm, owner_name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Phone Number"
                    value={vForm.phone_number}
                    onChange={(e) => setVForm({ ...vForm, phone_number: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white"
                  />
                  <input
                    type="text"
                    placeholder="Flat / Dept / Unit"
                    value={vForm.flat_or_unit}
                    onChange={(e) => setVForm({ ...vForm, flat_or_unit: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={vForm.vehicle_type}
                    onChange={(e) => setVForm({ ...vForm, vehicle_type: e.target.value })}
                    className="px-2.5 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white"
                  >
                    <option value="2W">2-Wheeler</option>
                    <option value="4W">4-Wheeler</option>
                    <option value="HCV">Heavy (HCV)</option>
                  </select>
                  <select
                    value={vForm.parking_type}
                    onChange={(e) => setVForm({ ...vForm, parking_type: e.target.value })}
                    className="px-2.5 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white"
                  >
                    {orgForm.parking_types.map((pt) => (
                      <option key={pt} value={pt}>
                        {pt}
                      </option>
                    ))}
                  </select>
                  <select
                    value={vForm.access_status}
                    onChange={(e) => setVForm({ ...vForm, access_status: e.target.value })}
                    className="px-2.5 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs font-bold text-white"
                  >
                    <option value="WHITELIST">WHITELIST</option>
                    <option value="BLACKLIST">BLACKLIST</option>
                  </select>
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-4 h-4" /> Save Vehicle Profile
                </button>
              </form>
            </div>

            <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-white">Registered Vehicles ({vehicles.length})</h3>
                <input
                  type="text"
                  placeholder="Search plate, owner, unit..."
                  value={vehSearch}
                  onChange={(e) => setVehSearch(e.target.value)}
                  className="px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white"
                />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-[11px] uppercase text-slate-400">
                      <th className="py-2.5 px-3">Plate</th>
                      <th className="py-2.5 px-3">Owner & Unit</th>
                      <th className="py-2.5 px-3">Category</th>
                      <th className="py-2.5 px-3">Access</th>
                      <th className="py-2.5 px-3 text-right">Remove</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {vehicles.map((v) => (
                      <tr key={v.id}>
                        <td className="py-2.5 px-3">
                          <IndianPlateBadge plate={v.plate_number} size="sm" />
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-white">{v.owner_name}</div>
                          <div className="text-[11px] text-slate-400">
                            {v.flat_or_unit} {v.phone_number ? `• ${v.phone_number}` : ""}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-300">
                          {v.vehicle_type} • {v.parking_type}
                        </td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              v.access_status === "WHITELIST"
                                ? "bg-blue-500/15 text-blue-400"
                                : "bg-rose-500/15 text-rose-400"
                            }`}
                          >
                            {v.access_status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            onClick={async () => {
                              await fetch(`${API_BASE}/v1/parking/vehicles/${v.id}`, { method: "DELETE" })
                              fetchVehicles()
                            }}
                            className="text-slate-500 hover:text-rose-400"
                          >
                            <Trash2 className="w-4 h-4 inline" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 4. RATE CONFIGURATOR PAGE */}
        {subTab === "rates" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
              <h3 className="text-base font-bold text-white">Configure Tariff Rule</h3>
              <form onSubmit={handleSaveRate} className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-400 mb-1">Vehicle Type</label>
                    <select
                      value={rForm.vehicle_type}
                      onChange={(e) => setRForm({ ...rForm, vehicle_type: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                    >
                      <option value="2W">2-Wheeler (2W)</option>
                      <option value="4W">4-Wheeler (4W)</option>
                      <option value="HCV">Heavy Vehicle (HCV)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Parking Type</label>
                    <select
                      value={rForm.parking_type}
                      onChange={(e) => setRForm({ ...rForm, parking_type: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                    >
                      {orgForm.parking_types.map((pt) => (
                        <option key={pt} value={pt}>
                          {pt}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-400 mb-1">Free Grace (mins)</label>
                    <input
                      type="number"
                      value={rForm.grace_period_mins}
                      onChange={(e) => setRForm({ ...rForm, grace_period_mins: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Base Slab (hours)</label>
                    <input
                      type="number"
                      value={rForm.base_hours}
                      onChange={(e) => setRForm({ ...rForm, base_hours: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-slate-400 mb-1">Base Fee (₹)</label>
                    <input
                      type="number"
                      value={rForm.base_fee_inr}
                      onChange={(e) => setRForm({ ...rForm, base_fee_inr: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Extra / Hr (₹)</label>
                    <input
                      type="number"
                      value={rForm.extra_hourly_rate_inr}
                      onChange={(e) => setRForm({ ...rForm, extra_hourly_rate_inr: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Daily Cap (₹)</label>
                    <input
                      type="number"
                      value={rForm.daily_max_cap_inr}
                      onChange={(e) => setRForm({ ...rForm, daily_max_cap_inr: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                    />
                  </div>
                </div>

                <label className="flex items-center space-x-2 text-slate-300 pt-1">
                  <input
                    type="checkbox"
                    checked={rForm.is_free_for_whitelist}
                    onChange={(e) => setRForm({ ...rForm, is_free_for_whitelist: e.target.checked })}
                    className="accent-emerald-500"
                  />
                  <span>Zero tariff (₹0) for Whitelisted vehicles</span>
                </label>

                <button
                  type="submit"
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg"
                >
                  Save Tariff Rule
                </button>
              </form>
            </div>

            <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-xl p-6">
              <h3 className="text-base font-bold text-white mb-4">Active Rate Matrix ({rates.length})</h3>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] uppercase text-slate-400">
                    <th className="py-2.5 px-3">Vehicle</th>
                    <th className="py-2.5 px-3">Parking Type</th>
                    <th className="py-2.5 px-3">Grace</th>
                    <th className="py-2.5 px-3">Base Slab</th>
                    <th className="py-2.5 px-3">Extra / Hr</th>
                    <th className="py-2.5 px-3">Daily Cap</th>
                    <th className="py-2.5 px-3 text-right">Delete</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {rates.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2.5 px-3 font-bold text-white">{r.vehicle_type}</td>
                      <td className="py-2.5 px-3 text-blue-400 font-semibold">{r.parking_type}</td>
                      <td className="py-2.5 px-3 text-slate-300">{r.grace_period_mins} mins</td>
                      <td className="py-2.5 px-3 text-emerald-400 font-bold">
                        ₹{r.base_fee_inr} ({r.base_hours}h)
                      </td>
                      <td className="py-2.5 px-3 text-slate-300">₹{r.extra_hourly_rate_inr}/hr</td>
                      <td className="py-2.5 px-3 text-amber-400">₹{r.daily_max_cap_inr}</td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          onClick={async () => {
                            await fetch(`${API_BASE}/v1/parking/rates/${r.id}`, { method: "DELETE" })
                            fetchRates()
                          }}
                          className="text-slate-500 hover:text-rose-400"
                        >
                          <Trash2 className="w-4 h-4 inline" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 5. ORGANIZATION & CAPACITY CONFIGURATION PAGE */}
        {subTab === "org" && (
          <form onSubmit={handleSaveOrg} className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
              <h3 className="text-base font-bold text-white">Organization Details</h3>
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block text-slate-400 mb-1">Organization / Site Name</label>
                  <input
                    type="text"
                    required
                    value={orgForm.org_name}
                    onChange={(e) => setOrgForm({ ...orgForm, org_name: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Site Address</label>
                  <input
                    type="text"
                    value={orgForm.address}
                    onChange={(e) => setOrgForm({ ...orgForm, address: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-400 mb-1">Contact Phone</label>
                    <input
                      type="text"
                      value={orgForm.contact_phone}
                      onChange={(e) => setOrgForm({ ...orgForm, contact_phone: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">GSTIN (Optional)</label>
                    <input
                      type="text"
                      value={orgForm.gst_number}
                      onChange={(e) => setOrgForm({ ...orgForm, gst_number: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800 space-y-2">
                <label className="block text-xs font-semibold text-slate-300">Parking Zones / Types</label>
                <div className="flex flex-wrap gap-1.5">
                  {orgForm.parking_types.map((pt) => (
                    <span
                      key={pt}
                      className="px-2.5 py-1 rounded-md bg-slate-800 text-xs font-bold text-blue-300 flex items-center gap-1.5"
                    >
                      {pt}
                      {orgForm.parking_types.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setOrgForm({
                              ...orgForm,
                              parking_types: orgForm.parking_types.filter((x) => x !== pt),
                            })
                          }
                          className="text-slate-400 hover:text-rose-400"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                </div>
                <div className="flex gap-2 pt-1">
                  <input
                    type="text"
                    placeholder="Add zone (e.g. STAFF)"
                    value={newParkingType}
                    onChange={(e) => setNewParkingType(e.target.value)}
                    className="flex-1 px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs uppercase text-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const clean = newParkingType.trim().toUpperCase()
                      if (clean && !orgForm.parking_types.includes(clean)) {
                        setOrgForm({ ...orgForm, parking_types: [...orgForm.parking_types, clean] })
                        setNewParkingType("")
                      }
                    }}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-bold text-white"
                  >
                    Add Type
                  </button>
                </div>
              </div>
            </div>

            <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
              <h3 className="text-base font-bold text-white">Slot Capacity Matrix (Vehicle Type × Parking Type)</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-[11px] uppercase text-slate-400">
                      <th className="py-2.5 px-3">Vehicle Category</th>
                      {orgForm.parking_types.map((pt) => (
                        <th key={pt} className="py-2.5 px-3">
                          {pt} Slots
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {(["2W", "4W", "HCV"] as const).map((vt) => (
                      <tr key={vt}>
                        <td className="py-3 px-3 font-bold text-white">
                          {vt === "2W" ? "2-Wheeler (2W)" : vt === "4W" ? "4-Wheeler (4W)" : "Heavy Vehicle (HCV)"}
                        </td>
                        {orgForm.parking_types.map((pt) => (
                          <td key={pt} className="py-3 px-3">
                            <input
                              type="number"
                              min={0}
                              value={orgForm.slots?.[vt]?.[pt] ?? 0}
                              onChange={(e) => {
                                const val = Math.max(0, Number(e.target.value))
                                setOrgForm({
                                  ...orgForm,
                                  slots: {
                                    ...orgForm.slots,
                                    [vt]: { ...(orgForm.slots?.[vt] || {}), [pt]: val },
                                  },
                                })
                              }}
                              className="w-20 px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded text-white font-mono"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                type="submit"
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg"
              >
                Save Organization & Slot Capacity
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  )
}