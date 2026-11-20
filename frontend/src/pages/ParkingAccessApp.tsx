import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import {
  ArrowLeft,
  ShieldCheck,
  ShieldAlert,
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
  Download,
  LogOut,
  TrendingUp,
  PieChart as PieChartIcon,
  BarChart3
} from "lucide-react"
import type { UserSession } from "../App"
import IndianPlateBadge from "../components/IndianPlateBadge"
import ImageLightbox from "../components/ImageLightbox"
import PaginationBar from "../components/PaginationBar"
import CameraManagerSection from "../components/CameraManagerSection"

interface ParkingAppProps {
  user: UserSession
  onBackToApps: () => void
  onLogout?: () => void
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

interface StackedGatePopup extends RecentGateEvent {
  popup_id: string
  display_time: string
}

interface OrgConfigState {
  org_name: string
  address: string
  contact_phone: string
  gst_number: string
  parking_types: string[]
  slots: Record<string, Record<string, number>>
}

const API_BASE = "http://localhost:8000"

const DEFAULT_ORG_CONFIG: OrgConfigState = {
  org_name: "Smart Parking Facility",
  address: "",
  contact_phone: "",
  gst_number: "",
  parking_types: ["VISITOR", "RESIDENT", "VIP", "EV"],
  slots: {
    "2W": { VISITOR: 40, RESIDENT: 30, VIP: 10, EV: 10 },
    "4W": { VISITOR: 50, RESIDENT: 40, VIP: 15, EV: 10 },
    HCV: { VISITOR: 10, RESIDENT: 5, VIP: 2, EV: 0 },
  },
}

type SubTabKey = "dashboard" | "reports" | "cameras" | "vehicles" | "rates" | "org"

export default function ParkingAccessApp({ user, onBackToApps, onLogout }: ParkingAppProps) {
  const [subTab, setSubTab] = useState<SubTabKey>(() => {
    const saved = localStorage.getItem("anpr_parking_subtab") as SubTabKey
    return ["dashboard", "reports", "cameras", "vehicles", "rates", "org"].includes(saved)
      ? saved
      : "dashboard"
  })

  useEffect(() => {
    localStorage.setItem("anpr_parking_subtab", subTab)
  }, [subTab])

  const [logoFailed, setLogoFailed] = useState(false)
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null)

  // Top-right LIFO stack of up to 5 live vehicle alerts (3s lifespan each)
  const [eventPopups, setEventPopups] = useState<StackedGatePopup[]>([])
  const seenEventKeysRef = useRef<Set<string>>(new Set())
  const initialPollDoneRef = useRef(false)
  const pollingInFlightRef = useRef(false)

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

  // Sessions State (Today on Dashboard for Analytics; Paginated All-Time on Audit Logs)
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

  // Organization & Capacity State (hydrated immediately from localStorage, then synced with backend)
  const orgStorageKey = `anpr_org_config_${user.id}`
  const [orgForm, setOrgForm] = useState<OrgConfigState>(() => {
    try {
      const cached = localStorage.getItem(orgStorageKey)
      if (cached) {
        const parsed = JSON.parse(cached)
        return {
          ...DEFAULT_ORG_CONFIG,
          ...parsed,
          slots: parsed.slots || DEFAULT_ORG_CONFIG.slots,
        }
      }
    } catch {
      // Fallback to default
    }
    return DEFAULT_ORG_CONFIG
  })
  const [newParkingType, setNewParkingType] = useState("")

  const handleLogoutClick = () => {
    if (onLogout) {
      onLogout()
    } else {
      localStorage.removeItem("anpr_token")
      localStorage.removeItem("anpr_user")
      window.location.reload()
    }
  }

  const showToast = useCallback((type: "success" | "error", text: string) => {
    setToast({ type, text })
    setTimeout(() => setToast(null), 3500)
  }, [])

  const pushGatePopup = useCallback((ev: RecentGateEvent) => {
    const popupId = `${ev.event_key}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const displayTime = ev.timestamp
      ? new Date(ev.timestamp).toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      : new Date().toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })

    const card: StackedGatePopup = {
      ...ev,
      popup_id: popupId,
      display_time: displayTime,
    }

    // LIFO stack: newest at top (index 0); if > 5, evict oldest from bottom
    setEventPopups((prev) => [card, ...prev].slice(0, 5))

    // Each card lives for 3 seconds independently
    window.setTimeout(() => {
      setEventPopups((prev) => prev.filter((item) => item.popup_id !== popupId))
    }, 3000)
  }, [])

  const fetchTodayStats = useCallback(async () => {
    const res = await fetch(`${API_BASE}/v1/parking/stats/today?user_id=${user.id}`)
    if (res.ok) setTodayStats(await res.json())
  }, [user.id])

  const fetchSessions = useCallback(async () => {
    setLoading(true)
    try {
      const isDash = subTab === "dashboard"
      const params = new URLSearchParams({
        user_id: String(user.id),
        page: String(isDash ? 1 : page),
        page_size: String(isDash ? 100 : pageSize),
        today_only: isDash ? "true" : "false",
      })
      if (!isDash && searchQuery.trim()) params.append("search", searchQuery.trim())
      if (!isDash && statusFilter !== "ALL") params.append("status", statusFilter)

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
    try {
      const res = await fetch(`${API_BASE}/v1/parking/org-config?user_id=${user.id}`)
      if (!res.ok) return
      const data = await res.json()
      const nextOrg: OrgConfigState = {
        org_name: data.org_name || DEFAULT_ORG_CONFIG.org_name,
        address: data.address || "",
        contact_phone: data.contact_phone || "",
        gst_number: data.gst_number || "",
        parking_types: data.capacity_data?.parking_types || DEFAULT_ORG_CONFIG.parking_types,
        slots: data.capacity_data?.slots || DEFAULT_ORG_CONFIG.slots,
      }
      setOrgForm(nextOrg)
      localStorage.setItem(orgStorageKey, JSON.stringify(nextOrg))
    } catch {
      // Keep cached org config if offline
    }
  }, [user.id, orgStorageKey])

  // Always hydrate global organization config on mount so sidebar/header stays persistent across refreshes
  useEffect(() => {
    fetchOrgConfig()
  }, [fetchOrgConfig])

  useEffect(() => {
    if (subTab === "dashboard") {
      fetchTodayStats()
      fetchSessions()
    } else if (subTab === "reports") {
      fetchSessions()
    } else if (subTab === "vehicles") {
      fetchVehicles()
    } else if (subTab === "rates") {
      fetchRates()
    } else if (subTab === "org") {
      fetchOrgConfig()
    }
  }, [subTab, fetchTodayStats, fetchSessions, fetchVehicles, fetchRates, fetchOrgConfig])

  // Ref-stabilized, non-overlapping Event Notification Poller (eliminates NS_BINDING_ABORTED)
  const latestCallbacksRef = useRef({
    subTab,
    pushGatePopup,
    fetchTodayStats,
    fetchSessions,
  })

  useEffect(() => {
    latestCallbacksRef.current = {
      subTab,
      pushGatePopup,
      fetchTodayStats,
      fetchSessions,
    }
  }, [subTab, pushGatePopup, fetchTodayStats, fetchSessions])

  useEffect(() => {
    let active = true
    const controller = new AbortController()

    const pollEvents = async () => {
      if (!active || pollingInFlightRef.current || document.hidden) return
      pollingInFlightRef.current = true
      try {
        const res = await fetch(`${API_BASE}/v1/parking/events/recent?user_id=${user.id}`, {
          signal: controller.signal,
        })
        if (!res.ok || !active) return
        const list: RecentGateEvent[] = await res.json()

        if (!initialPollDoneRef.current) {
          list.forEach((ev) => seenEventKeysRef.current.add(ev.event_key))
          initialPollDoneRef.current = true
          return
        }

        const freshEvents = [...list].reverse().filter((ev) => {
          if (seenEventKeysRef.current.has(ev.event_key)) return false
          seenEventKeysRef.current.add(ev.event_key)
          return true
        })

        if (freshEvents.length > 0) {
          const {
            pushGatePopup: push,
            fetchTodayStats: refreshStats,
            fetchSessions: refreshSessions,
            subTab: currentTab,
          } = latestCallbacksRef.current
          freshEvents.forEach((ev) => push(ev))
          if (currentTab === "dashboard") {
            refreshStats()
            refreshSessions()
          } else if (currentTab === "reports") {
            refreshSessions()
          }
        }
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          // Ignore transient network errors
        }
      } finally {
        pollingInFlightRef.current = false
      }
    }

    pollEvents()
    const interval = window.setInterval(pollEvents, 2500)
    return () => {
      active = false
      controller.abort()
      window.clearInterval(interval)
    }
  }, [user.id])

  // --- DASHBOARD ANALYTICS DERIVATIONS (FROM TODAY'S SESSIONS & OCCUPANCY) ---
  const analytics = useMemo(() => {
    // 1. Hourly Entries, Exits & Revenue (2-hour buckets across 24h: 00-02 ... 22-24)
    const buckets = Array.from({ length: 12 }, (_, idx) => {
      const startHr = idx * 2
      return {
        label: `${String(startHr).padStart(2, "0")}:00`,
        entries: 0,
        exits: 0,
        revenue: 0,
      }
    })

    const accessCounts = { WHITELIST: 0, VISITOR: 0, BLACKLIST: 0 }
    const vehicleCounts = { "2W": 0, "4W": 0, HCV: 0 }
    let completedDurations = 0
    let completedCount = 0

    sessions.forEach((s) => {
      const acc = s.access_type in accessCounts ? s.access_type : "VISITOR"
      accessCounts[acc] += 1

      const vt = s.vehicle_type in vehicleCounts ? (s.vehicle_type as "2W" | "4W" | "HCV") : "4W"
      vehicleCounts[vt] += 1

      if (s.entry_time) {
        const hr = new Date(s.entry_time).getHours()
        const bIdx = Math.min(11, Math.max(0, Math.floor(hr / 2)))
        if (s.status !== "BLOCKED") buckets[bIdx].entries += 1
      }
      if (s.exit_time && s.status === "EXITED") {
        const hr = new Date(s.exit_time).getHours()
        const bIdx = Math.min(11, Math.max(0, Math.floor(hr / 2)))
        buckets[bIdx].exits += 1
        buckets[bIdx].revenue += Number(s.fee_inr || 0)
        completedDurations += Number(s.duration_mins || 0)
        completedCount += 1
      }
    })

    const maxTraffic = Math.max(4, ...buckets.map((b) => Math.max(b.entries, b.exits)))
    const maxRevenue = Math.max(50, ...buckets.map((b) => b.revenue))
    const avgStayMins = completedCount > 0 ? Math.round(completedDurations / completedCount) : 0

    // Donut geometry helper (circumference for r=42 is ~263.89)
    const totalAccess = Math.max(1, accessCounts.WHITELIST + accessCounts.VISITOR + accessCounts.BLACKLIST)
    const hasAccessData = accessCounts.WHITELIST + accessCounts.VISITOR + accessCounts.BLACKLIST > 0

    const totalVeh = Math.max(1, vehicleCounts["2W"] + vehicleCounts["4W"] + vehicleCounts.HCV)
    const hasVehData = vehicleCounts["2W"] + vehicleCounts["4W"] + vehicleCounts.HCV > 0

    return {
      buckets,
      maxTraffic,
      maxRevenue,
      accessCounts,
      totalAccess,
      hasAccessData,
      vehicleCounts,
      totalVeh,
      hasVehData,
      avgStayMins,
    }
  }, [sessions])

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
    const cleanOrgName = orgForm.org_name.trim() || DEFAULT_ORG_CONFIG.org_name
    const nextOrg: OrgConfigState = {
      ...orgForm,
      org_name: cleanOrgName,
    }

    const res = await fetch(`${API_BASE}/v1/parking/org-config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: user.id,
        org_name: nextOrg.org_name,
        address: nextOrg.address,
        contact_phone: nextOrg.contact_phone,
        gst_number: nextOrg.gst_number,
        capacity_data: {
          parking_types: nextOrg.parking_types,
          slots: nextOrg.slots,
        },
      }),
    })
    if (res.ok) {
      setOrgForm(nextOrg)
      localStorage.setItem(orgStorageKey, JSON.stringify(nextOrg))
      showToast("success", "Organization & slot capacity saved globally")
      fetchTodayStats()
    } else {
      showToast("error", "Failed to save organization details")
    }
  }

  const exportCSV = () => {
    const headers = [
      "ID",
      "Plate",
      "Type",
      "Access",
      "Entry Gate",
      "Entry Time",
      "Exit Gate",
      "Exit Time",
      "Duration (m)",
      "Fee (INR)",
      "Status",
    ]
    const rows = sessions.map((s) => [
      s.id,
      s.plate_number,
      s.vehicle_type,
      s.access_type,
      s.entry_gate || "",
      s.entry_time ? new Date(s.entry_time).toLocaleString("en-IN") : "",
      s.exit_gate || "",
      s.exit_time ? new Date(s.exit_time).toLocaleString("en-IN") : "",
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

  // SVG Line Chart coordinates (600 x 190 viewBox)
  const chartW = 600
  const chartH = 175
  const padX = 28
  const padY = 18
  const plotW = chartW - padX * 2
  const plotH = chartH - padY * 2

  const entryPoints = analytics.buckets.map((b, i) => {
    const x = padX + (i / (analytics.buckets.length - 1)) * plotW
    const y = padY + plotH - (b.entries / analytics.maxTraffic) * plotH
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const exitPoints = analytics.buckets.map((b, i) => {
    const x = padX + (i / (analytics.buckets.length - 1)) * plotW
    const y = padY + plotH - (b.exits / analytics.maxTraffic) * plotH
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const entryAreaPoints = `${padX},${padY + plotH} ${entryPoints.join(" ")} ${padX + plotW},${padY + plotH}`

  const navItems: { key: SubTabKey; label: string; icon: any }[] = [
    { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { key: "reports", label: "Audit Logs", icon: FileSpreadsheet },
    { key: "cameras", label: "Cameras", icon: Video },
    { key: "vehicles", label: "Vehicles & Owners", icon: Users },
    { key: "rates", label: "Rate Configurator", icon: Tags },
    { key: "org", label: "Organization & Slots", icon: Building2 },
  ]

  return (
    <div className="min-h-screen w-screen bg-slate-50 text-slate-900 flex">
      {/* STANDARD TOAST */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl border text-xs font-semibold shadow-lg flex items-center space-x-2 ${
            toast.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-rose-50 border-rose-200 text-rose-800"
          }`}
        >
          {toast.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600" />
          )}
          <span>{toast.text}</span>
        </div>
      )}

      {/* TOP-RIGHT 5-CARD LIFO REAL-TIME GATE EVENT NOTIFICATION STACK (3s LIFESPAN EACH) */}
      {eventPopups.length > 0 && (
        <div className="fixed top-20 right-6 z-50 w-80 flex flex-col gap-2.5 pointer-events-none">
          {eventPopups.map((item, idx) => (
            <div
              key={item.popup_id}
              onClick={() => item.image_url && setLightboxData({ url: item.image_url, plate: item.plate_number })}
              style={{ opacity: Math.max(0.86, 1 - idx * 0.03) }}
              className={`pointer-events-auto rounded-2xl border p-3.5 shadow-xl cursor-pointer transition-all duration-200 bg-white/95 backdrop-blur-md ${
                item.status === "BLOCKED"
                  ? "border-rose-300 ring-2 ring-rose-500/20"
                  : item.status === "EXITED"
                  ? "border-amber-300 ring-2 ring-amber-500/20"
                  : "border-emerald-300 ring-2 ring-emerald-500/20"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div
                  className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${
                    item.status === "BLOCKED"
                      ? "text-rose-700"
                      : item.status === "EXITED"
                      ? "text-amber-700"
                      : "text-emerald-700"
                  }`}
                >
                  <Bell className="w-3.5 h-3.5 animate-bounce shrink-0" />
                  <span>
                    {item.status === "BLOCKED"
                      ? "Security Alert"
                      : item.status === "EXITED"
                      ? "Vehicle Exit Cleared"
                      : "Vehicle Entry Recorded"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] font-mono text-slate-500">{item.display_time}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setEventPopups((prev) => prev.filter((p) => p.popup_id !== item.popup_id))
                    }}
                    className="text-slate-400 hover:text-slate-700"
                    aria-label="Dismiss alert"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <IndianPlateBadge plate={item.plate_number} size="sm" />
                  <p className="text-[11px] text-slate-600 truncate">
                    Gate: <strong className="text-slate-900">{item.gate || "-"}</strong> • {item.vehicle_type}
                  </p>
                  {item.status === "EXITED" && (
                    <p className="text-xs font-bold text-[#A62626]">Tariff: ₹{item.fee_inr.toFixed(0)}</p>
                  )}
                </div>
                {item.image_url && (
                  <img
                    src={item.image_url}
                    alt={item.plate_number}
                    className="w-16 h-12 object-cover rounded-lg border border-slate-200 shrink-0"
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ImageLightbox
        imageUrl={lightboxData.url}
        plateNumber={lightboxData.plate}
        onClose={() => setLightboxData({ url: null })}
      />

      {/* LEFT VERTICAL SIDEBAR */}
      <aside className="w-64 shrink-0 bg-white border-r border-slate-200 flex flex-col justify-between sticky top-0 h-screen">
        <div>
          <div className="h-1.5 w-full bg-gradient-to-r from-[#A62626] via-[#F59E1B] to-[#8F1D36]" />

          {/* Brand & Saved Org Badge */}
          <div className="p-5 border-b border-slate-100 space-y-3">
            {!logoFailed ? (
              <img
                src="/sigma-logo.jpg"
                alt="Sigma eSolution Pvt Ltd"
                onError={() => setLogoFailed(true)}
                className="h-9 w-auto object-contain"
              />
            ) : (
              <div>
                <div className="text-lg font-extrabold tracking-wider text-[#A62626] leading-none">
                  SIGMA
                </div>
                <div className="text-[10px] font-semibold text-[#8F1D36] tracking-wide">
                  eSolution Pvt Ltd
                </div>
              </div>
            )}

            <div className="flex items-center space-x-2 px-2.5 py-2 rounded-xl bg-slate-50 border border-slate-200/80">
              <Building2 className="w-3.5 h-3.5 text-[#A62626] shrink-0" />
              <span className="text-xs font-bold text-slate-800 truncate">{orgForm.org_name}</span>
            </div>
          </div>

          {/* Back to App Launcher */}
          <div className="px-4 pt-4">
            <button
              onClick={onBackToApps}
              className="w-full flex items-center space-x-2 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200/70 text-xs font-semibold text-slate-700 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>All Applications</span>
            </button>
          </div>

          {/* Section Label */}
          <div className="px-4 pt-5 pb-2">
            <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Parking &amp; Access Control
            </p>
          </div>

          {/* Vertical Navigation */}
          <nav className="px-4 space-y-1.5">
            {navItems.map((t) => {
              const Icon = t.icon
              const isActive = subTab === t.key
              return (
                <button
                  key={t.key}
                  onClick={() => {
                    setSubTab(t.key)
                    setPage(1)
                  }}
                  className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    isActive
                      ? "bg-[#FDF2F2] text-[#A62626] border border-[#F5C6C6] shadow-2xs"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? "text-[#A62626]" : "text-slate-400"}`} />
                  <span>{t.label}</span>
                </button>
              )
            })}
          </nav>
        </div>

        {/* Bottom Live Gate Summary Pill */}
        <div className="p-4 border-t border-slate-100">
          <div className="px-3 py-2.5 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] text-[11px] text-amber-900">
            <p className="font-bold">Live Gate Engine Active</p>
            <p className="text-[10px] text-amber-700 mt-0.5">
              Inside Now: <span className="font-bold">{todayStats.currently_parked}</span> vehicles
            </p>
          </div>
        </div>
      </aside>

      {/* RIGHT CONTENT COLUMN */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* TOP HEADER WITH TOP-RIGHT PROFILE & LOGOUT */}
        <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between gap-4 sticky top-0 z-20">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-[#FDF2F2] text-[#A62626] border border-[#F5C6C6]">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-900">{orgForm.org_name}</h1>
              <p className="text-[11px] text-slate-500">
                {orgForm.address ? orgForm.address : "Smart Parking & Automated Gate Access Control"}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={() => {
                fetchTodayStats()
                fetchSessions()
                fetchOrgConfig()
              }}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200/80 text-slate-700 text-xs font-semibold border border-slate-200 transition-colors"
              title="Sync live data"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-[#A62626]" : ""}`} />
              <span className="hidden md:inline">Sync</span>
            </button>

            <div className="h-6 w-px bg-slate-200" />

            {/* TOP-RIGHT USER PROFILE & LOGOUT */}
            <div className="flex items-center space-x-2.5 pr-1">
              <div className="w-8 h-8 rounded-full bg-[#FDF2F2] border border-[#F5C6C6] text-[#A62626] font-bold text-xs flex items-center justify-center uppercase">
                {(user.full_name || "U").slice(0, 1)}
              </div>
              <div className="text-right hidden sm:block">
                <p className="text-xs font-bold text-slate-900 leading-tight">{user.full_name}</p>
                <p className="text-[11px] text-slate-500 leading-tight">{user.email}</p>
              </div>
            </div>

            <button
              onClick={handleLogoutClick}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-[#FDF2F2] text-slate-700 hover:text-[#A62626] border border-slate-200 hover:border-[#F5C6C6] text-xs font-semibold transition-colors"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Logout</span>
            </button>
          </div>
        </header>

        {/* MAIN CONTENT AREA */}
        <main className="flex-1 p-8 max-w-[1600px] w-full mx-auto space-y-6">
          {/* 1. ANALYTICAL DASHBOARD (KPI CARDS + CHARTS ONLY — NO DATATABLE) */}
          {subTab === "dashboard" && (
            <>
              {/* CURRENT-DAY KPI CARDS */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs">
                  <p className="text-[11px] text-slate-500 uppercase font-bold tracking-wider">
                    Today&apos;s Entries
                  </p>
                  <p className="text-2xl font-extrabold text-emerald-600 mt-1">{todayStats.today_entries}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">Exits Today: {todayStats.today_exits}</p>
                </div>

                <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs">
                  <p className="text-[11px] text-slate-500 uppercase font-bold tracking-wider">
                    Vehicles Inside Now
                  </p>
                  <p className="text-2xl font-extrabold text-slate-900 mt-1">{todayStats.currently_parked}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Avg Stay: <strong className="text-slate-700">{analytics.avgStayMins}m</strong>
                  </p>
                </div>

                <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs">
                  <p className="text-[11px] text-slate-500 uppercase font-bold tracking-wider">
                    Slot Availability
                  </p>
                  <div className="mt-1.5 space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">2-Wheeler:</span>
                      <span className="font-bold text-slate-800">
                        {todayStats.occupancy["2W"]?.available}/{todayStats.occupancy["2W"]?.total}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">4W / HCV:</span>
                      <span className="font-bold text-[#A62626]">
                        {todayStats.occupancy["4W"]?.available}/{todayStats.occupancy["4W"]?.total} •{" "}
                        {todayStats.occupancy.HCV?.available}/{todayStats.occupancy.HCV?.total}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs flex items-center justify-between">
                  <div>
                    <p className="text-[11px] text-slate-500 uppercase font-bold tracking-wider">
                      Today&apos;s Alerts
                    </p>
                    <p className="text-2xl font-extrabold text-rose-600 mt-1">{todayStats.today_alerts}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">Blacklist blocks</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200">
                    <ShieldAlert className="w-5 h-5 text-rose-600" />
                  </div>
                </div>

                <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs flex items-center justify-between">
                  <div>
                    <p className="text-[11px] text-slate-500 uppercase font-bold tracking-wider">
                      Today&apos;s Collection
                    </p>
                    <p className="text-2xl font-extrabold text-[#D97706] mt-1">
                      ₹{todayStats.today_revenue.toFixed(0)}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">Visitor tariff</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#FFFBEB] border border-[#FDE68A]">
                    <IndianRupee className="w-5 h-5 text-[#D97706]" />
                  </div>
                </div>
              </div>

              {/* CHARTS ROW 1: HOURLY TRAFFIC LINE CHART + SLOT OCCUPANCY BAR GRAPH */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* LINE CHART: Hourly Entry vs Exit Traffic */}
                <div className="lg:col-span-7 bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center space-x-2.5">
                      <div className="p-2 rounded-xl bg-[#FDF2F2] text-[#A62626] border border-[#F5C6C6]">
                        <TrendingUp className="w-4 h-4" />
                      </div>
                      <div>
                        <h2 className="text-sm font-bold text-slate-900">
                          Today&apos;s Gate Traffic Trend (Entry vs. Exit)
                        </h2>
                        <p className="text-xs text-slate-500">2-hour vehicle movement intervals</p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-4 text-xs font-semibold">
                      <span className="flex items-center gap-1.5 text-slate-700">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#A62626]" /> Entries
                      </span>
                      <span className="flex items-center gap-1.5 text-slate-700">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#F59E1B]" /> Exits
                      </span>
                    </div>
                  </div>

                  <div className="w-full pt-2">
                    <svg viewBox={`0 0 ${chartW} ${chartH + 24}`} className="w-full h-56 overflow-visible">
                      <defs>
                        <linearGradient id="sigmaEntryGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#A62626" stopOpacity="0.22" />
                          <stop offset="100%" stopColor="#A62626" stopOpacity="0.0" />
                        </linearGradient>
                      </defs>

                      {/* Horizontal Grid Lines */}
                      {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
                        const y = padY + plotH * (1 - ratio)
                        const val = Math.round(analytics.maxTraffic * ratio)
                        return (
                          <g key={idx}>
                            <line
                              x1={padX}
                              y1={y}
                              x2={chartW - padX}
                              y2={y}
                              stroke="#E2E8F0"
                              strokeDasharray="3 3"
                              strokeWidth="1"
                            />
                            <text x={4} y={y + 4} fontSize="10" fill="#94A3B8" fontFamily="monospace">
                              {val}
                            </text>
                          </g>
                        )
                      })}

                      {/* Entry Shaded Area + Line */}
                      <polygon points={entryAreaPoints} fill="url(#sigmaEntryGrad)" />
                      <polyline
                        fill="none"
                        stroke="#A62626"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        points={entryPoints.join(" ")}
                      />

                      {/* Exit Line */}
                      <polyline
                        fill="none"
                        stroke="#F59E1B"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        points={exitPoints.join(" ")}
                      />

                      {/* Data Points & X-Axis Labels */}
                      {analytics.buckets.map((b, i) => {
                        const x = padX + (i / (analytics.buckets.length - 1)) * plotW
                        const yEntry = padY + plotH - (b.entries / analytics.maxTraffic) * plotH
                        const yExit = padY + plotH - (b.exits / analytics.maxTraffic) * plotH
                        return (
                          <g key={b.label}>
                            <circle cx={x} cy={yEntry} r="3.5" fill="#A62626" stroke="#FFFFFF" strokeWidth="1.5" />
                            <circle cx={x} cy={yExit} r="3.5" fill="#F59E1B" stroke="#FFFFFF" strokeWidth="1.5" />
                            <text
                              x={x}
                              y={chartH + 16}
                              textAnchor="middle"
                              fontSize="10"
                              fill="#64748B"
                              fontFamily="monospace"
                            >
                              {b.label}
                            </text>
                          </g>
                        )
                      })}
                    </svg>
                  </div>
                </div>

                {/* BAR GRAPH: Live Slot Occupancy by Vehicle Category */}
                <div className="lg:col-span-5 bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs flex flex-col justify-between space-y-5">
                  <div className="flex items-center space-x-2.5">
                    <div className="p-2 rounded-xl bg-[#FFFBEB] text-[#D97706] border border-[#FDE68A]">
                      <BarChart3 className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-slate-900">Live Bay &amp; Slot Utilization</h2>
                      <p className="text-xs text-slate-500">Occupied vs. total configured capacity</p>
                    </div>
                  </div>

                  <div className="space-y-5 my-auto">
                    {(
                      [
                        { key: "4W", label: "4-Wheeler (Cars / SUVs)", color: "bg-[#A62626]" },
                        { key: "2W", label: "2-Wheeler (Bikes / Scooters)", color: "bg-[#F59E1B]" },
                        { key: "HCV", label: "Heavy Commercial (HCV)", color: "bg-[#8F1D36]" },
                      ] as const
                    ).map((cat) => {
                      const stat = todayStats.occupancy[cat.key] || { occupied: 0, total: 0, available: 0 }
                      const pct = stat.total > 0 ? Math.min(100, Math.round((stat.occupied / stat.total) * 100)) : 0
                      return (
                        <div key={cat.key} className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-slate-800">{cat.label}</span>
                            <span className="font-mono text-slate-600">
                              <strong className="text-slate-900">{stat.occupied}</strong> / {stat.total} ({pct}%)
                            </span>
                          </div>
                          <div className="w-full h-3.5 rounded-full bg-slate-100 border border-slate-200/80 overflow-hidden">
                            <div
                              style={{ width: `${pct}%` }}
                              className={`h-full rounded-full transition-all duration-500 ${cat.color}`}
                            />
                          </div>
                          <div className="flex justify-between text-[11px] text-slate-400">
                            <span>Occupied: {stat.occupied} bays</span>
                            <span>Available: {stat.available} bays</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* CHARTS ROW 2: ACCESS TYPE PIE/DONUT + VEHICLE MIX PIE + HOURLY REVENUE BAR CHART */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* PIE / DONUT CHART 1: Access Classification */}
                <div className="lg:col-span-4 bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-4">
                  <div className="flex items-center space-x-2.5">
                    <div className="p-2 rounded-xl bg-[#FDF2F2] text-[#A62626] border border-[#F5C6C6]">
                      <PieChartIcon className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-slate-900">Access Policy Breakdown</h2>
                      <p className="text-xs text-slate-500">Today&apos;s traffic by authorization tier</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-around gap-4 pt-2">
                    <svg viewBox="0 0 110 110" className="w-32 h-32 shrink-0 -rotate-90">
                      <circle cx="55" cy="55" r="42" fill="none" stroke="#F1F5F9" strokeWidth="14" />
                      {analytics.hasAccessData && (() => {
                        const C = 2 * Math.PI * 42
                        const wlLen = (analytics.accessCounts.WHITELIST / analytics.totalAccess) * C
                        const visLen = (analytics.accessCounts.VISITOR / analytics.totalAccess) * C
                        const blkLen = (analytics.accessCounts.BLACKLIST / analytics.totalAccess) * C
                        return (
                          <>
                            <circle
                              cx="55"
                              cy="55"
                              r="42"
                              fill="none"
                              stroke="#16A34A"
                              strokeWidth="14"
                              strokeDasharray={`${wlLen} ${C}`}
                              strokeDashoffset={0}
                            />
                            <circle
                              cx="55"
                              cy="55"
                              r="42"
                              fill="none"
                              stroke="#F59E1B"
                              strokeWidth="14"
                              strokeDasharray={`${visLen} ${C}`}
                              strokeDashoffset={-wlLen}
                            />
                            <circle
                              cx="55"
                              cy="55"
                              r="42"
                              fill="none"
                              stroke="#A62626"
                              strokeWidth="14"
                              strokeDasharray={`${blkLen} ${C}`}
                              strokeDashoffset={-(wlLen + visLen)}
                            />
                          </>
                        )
                      })()}
                    </svg>

                    <div className="space-y-2.5 text-xs flex-1">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-slate-700 font-medium">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" /> Whitelist
                        </span>
                        <span className="font-bold text-slate-900">{analytics.accessCounts.WHITELIST}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-slate-700 font-medium">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#F59E1B]" /> Visitor
                        </span>
                        <span className="font-bold text-slate-900">{analytics.accessCounts.VISITOR}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-slate-700 font-medium">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#A62626]" /> Blacklist
                        </span>
                        <span className="font-bold text-slate-900">{analytics.accessCounts.BLACKLIST}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* PIE / DONUT CHART 2: Vehicle Category Mix */}
                <div className="lg:col-span-4 bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-4">
                  <div className="flex items-center space-x-2.5">
                    <div className="p-2 rounded-xl bg-[#FFFBEB] text-[#D97706] border border-[#FDE68A]">
                      <PieChartIcon className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-slate-900">Vehicle Fleet Distribution</h2>
                      <p className="text-xs text-slate-500">Share of 2W, 4W &amp; HCV movements</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-around gap-4 pt-2">
                    <svg viewBox="0 0 110 110" className="w-32 h-32 shrink-0 -rotate-90">
                      <circle cx="55" cy="55" r="42" fill="none" stroke="#F1F5F9" strokeWidth="14" />
                      {analytics.hasVehData && (() => {
                        const C = 2 * Math.PI * 42
                        const v4Len = (analytics.vehicleCounts["4W"] / analytics.totalVeh) * C
                        const v2Len = (analytics.vehicleCounts["2W"] / analytics.totalVeh) * C
                        const hcvLen = (analytics.vehicleCounts.HCV / analytics.totalVeh) * C
                        return (
                          <>
                            <circle
                              cx="55"
                              cy="55"
                              r="42"
                              fill="none"
                              stroke="#A62626"
                              strokeWidth="14"
                              strokeDasharray={`${v4Len} ${C}`}
                              strokeDashoffset={0}
                            />
                            <circle
                              cx="55"
                              cy="55"
                              r="42"
                              fill="none"
                              stroke="#F59E1B"
                              strokeWidth="14"
                              strokeDasharray={`${v2Len} ${C}`}
                              strokeDashoffset={-v4Len}
                            />
                            <circle
                              cx="55"
                              cy="55"
                              r="42"
                              fill="none"
                              stroke="#334155"
                              strokeWidth="14"
                              strokeDasharray={`${hcvLen} ${C}`}
                              strokeDashoffset={-(v4Len + v2Len)}
                            />
                          </>
                        )
                      })()}
                    </svg>

                    <div className="space-y-2.5 text-xs flex-1">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-slate-700 font-medium">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#A62626]" /> 4-Wheeler
                        </span>
                        <span className="font-bold text-slate-900">{analytics.vehicleCounts["4W"]}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-slate-700 font-medium">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#F59E1B]" /> 2-Wheeler
                        </span>
                        <span className="font-bold text-slate-900">{analytics.vehicleCounts["2W"]}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-slate-700 font-medium">
                          <span className="w-2.5 h-2.5 rounded-full bg-slate-700" /> Heavy (HCV)
                        </span>
                        <span className="font-bold text-slate-900">{analytics.vehicleCounts.HCV}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* BAR GRAPH 2: Hourly Tariff Collection (₹) */}
                <div className="lg:col-span-4 bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs flex flex-col justify-between space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2.5">
                      <div className="p-2 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <IndianRupee className="w-4 h-4" />
                      </div>
                      <div>
                        <h2 className="text-sm font-bold text-slate-900">Tariff Revenue by Slot</h2>
                        <p className="text-xs text-slate-500">Today&apos;s INR collection curve</p>
                      </div>
                    </div>
                    <span className="text-xs font-extrabold text-emerald-700">
                      ₹{todayStats.today_revenue.toFixed(0)}
                    </span>
                  </div>

                  <div className="h-36 flex items-end justify-between gap-1.5 pt-4 border-b border-slate-200 pb-1">
                    {analytics.buckets.map((b) => {
                      const heightPct = Math.max(6, Math.round((b.revenue / analytics.maxRevenue) * 100))
                      return (
                        <div key={b.label} className="flex-1 flex flex-col items-center gap-1 group">
                          <div className="w-full flex items-end justify-center h-28">
                            <div
                              title={`${b.label}: ₹${b.revenue.toFixed(0)}`}
                              style={{ height: `${b.revenue > 0 ? heightPct : 6}%` }}
                              className={`w-full max-w-[16px] rounded-t-md transition-all ${
                                b.revenue > 0
                                  ? "bg-gradient-to-t from-[#A62626] to-[#F59E1B]"
                                  : "bg-slate-100"
                              }`}
                            />
                          </div>
                          <span className="text-[9px] font-mono text-slate-400">
                            {b.label.slice(0, 2)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* 2. AUDIT LOGS (CLEAN DATATABLE + SEARCH + FILTER + EXPORT ONLY — NO KPI CARDS) */}
          {subTab === "reports" && (
            <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Complete Parking Audit Repository</h2>
                  <p className="text-xs text-slate-500">
                    Click any Entry or Exit frame thumbnail to inspect full-resolution capture
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="Search plate..."
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value)
                        setPage(1)
                      }}
                      className="pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
                    />
                  </div>

                  <select
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value as any)
                      setPage(1)
                    }}
                    className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
                  >
                    <option value="ALL">All Statuses</option>
                    <option value="PARKED">Currently Parked</option>
                    <option value="EXITED">Exited</option>
                    <option value="BLOCKED">Blocked Alerts</option>
                  </select>

                  <button
                    onClick={exportCSV}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#A62626] hover:bg-[#8B1E1E] text-white text-xs font-semibold shadow-2xs transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" /> Export CSV
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500 bg-slate-50/70">
                      <th className="py-3 px-3">Plate</th>
                      <th className="py-3 px-3">Type / Access</th>
                      <th className="py-3 px-3">Entry Image</th>
                      <th className="py-3 px-3">Entry Gate &amp; Time</th>
                      <th className="py-3 px-3">Exit Image</th>
                      <th className="py-3 px-3">Exit Gate &amp; Time</th>
                      <th className="py-3 px-3">Duration</th>
                      <th className="py-3 px-3">Fee</th>
                      <th className="py-3 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {sessions.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-12 text-center text-slate-400">
                          No gate events recorded for this view.
                        </td>
                      </tr>
                    ) : (
                      sessions.map((s) => (
                        <tr key={s.id} className="hover:bg-slate-50/90 transition-colors">
                          <td className="py-2.5 px-3">
                            <IndianPlateBadge plate={s.plate_number} size="sm" />
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="flex flex-col gap-1">
                              <span className="font-bold text-slate-800">{s.vehicle_type}</span>
                              <span
                                className={`w-fit px-2 py-0.5 rounded text-[10px] font-bold ${
                                  s.access_type === "WHITELIST"
                                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                    : s.access_type === "BLACKLIST"
                                    ? "bg-rose-50 text-rose-700 border border-rose-200"
                                    : "bg-amber-50 text-amber-800 border border-amber-200"
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
                                className="relative group block rounded-lg overflow-hidden border border-slate-200"
                              >
                                <img src={s.entry_image_url} alt="Entry" className="w-16 h-10 object-cover" />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center">
                                  <Maximize2 className="w-3.5 h-3.5 text-white" />
                                </div>
                              </button>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-slate-700">
                            <div className="font-semibold text-slate-900">{s.entry_gate || "-"}</div>
                            <div className="text-[11px] text-slate-500">
                              {s.entry_time ? new Date(s.entry_time).toLocaleString("en-IN") : "-"}
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            {s.exit_image_url ? (
                              <button
                                onClick={() => setLightboxData({ url: s.exit_image_url, plate: s.plate_number })}
                                className="relative group block rounded-lg overflow-hidden border border-slate-200"
                              >
                                <img src={s.exit_image_url} alt="Exit" className="w-16 h-10 object-cover" />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center">
                                  <Maximize2 className="w-3.5 h-3.5 text-white" />
                                </div>
                              </button>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-slate-700">
                            <div className="font-semibold text-slate-900">{s.exit_gate || "-"}</div>
                            <div className="text-[11px] text-slate-500">
                              {s.exit_time ? new Date(s.exit_time).toLocaleString("en-IN") : "-"}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-slate-700">
                            <span className="inline-flex items-center gap-1">
                              <Clock className="w-3 h-3 text-slate-400" />
                              {s.status === "PARKED" ? "Inside" : `${s.duration_mins}m`}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-bold text-[#D97706]">₹{s.fee_inr.toFixed(0)}</td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                s.status === "PARKED"
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  : s.status === "BLOCKED"
                                  ? "bg-rose-50 text-rose-700 border border-rose-200"
                                  : "bg-slate-100 text-slate-700 border border-slate-200"
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

          {/* 3. CAMERA MANAGEMENT SECTION */}
          {subTab === "cameras" && (
            <CameraManagerSection userId={user.id} apiBase={API_BASE} onNotify={showToast} />
          )}

          {/* 4. VEHICLES & OWNERS REGISTRY PAGE */}
          {subTab === "vehicles" && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-4 bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-4">
                <h3 className="text-base font-bold text-slate-900">Register Vehicle &amp; Owner</h3>
                <form onSubmit={handleRegisterVehicle} className="space-y-3">
                  <input
                    type="text"
                    required
                    placeholder="License Plate (e.g. JH01FW4809)"
                    value={vForm.plate_number}
                    onChange={(e) => setVForm({ ...vForm, plate_number: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono uppercase text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
                  />
                  <input
                    type="text"
                    required
                    placeholder="Owner Full Name"
                    value={vForm.owner_name}
                    onChange={(e) => setVForm({ ...vForm, owner_name: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="Phone Number"
                      value={vForm.phone_number}
                      onChange={(e) => setVForm({ ...vForm, phone_number: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
                    />
                    <input
                      type="text"
                      placeholder="Flat / Dept / Unit"
                      value={vForm.flat_or_unit}
                      onChange={(e) => setVForm({ ...vForm, flat_or_unit: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <select
                      value={vForm.vehicle_type}
                      onChange={(e) => setVForm({ ...vForm, vehicle_type: e.target.value })}
                      className="px-2.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
                    >
                      <option value="2W">2-Wheeler</option>
                      <option value="4W">4-Wheeler</option>
                      <option value="HCV">Heavy (HCV)</option>
                    </select>
                    <select
                      value={vForm.parking_type}
                      onChange={(e) => setVForm({ ...vForm, parking_type: e.target.value })}
                      className="px-2.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
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
                      className="px-2.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
                    >
                      <option value="WHITELIST">WHITELIST</option>
                      <option value="BLACKLIST">BLACKLIST</option>
                    </select>
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2.5 bg-[#A62626] hover:bg-[#8B1E1E] text-white text-xs font-bold rounded-xl shadow-sm flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Plus className="w-4 h-4" /> Save Vehicle Profile
                  </button>
                </form>
              </div>

              <div className="lg:col-span-8 bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-base font-bold text-slate-900">
                    Registered Vehicles ({vehicles.length})
                  </h3>
                  <input
                    type="text"
                    placeholder="Search plate, owner, unit..."
                    value={vehSearch}
                    onChange={(e) => setVehSearch(e.target.value)}
                    className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
                  />
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500 bg-slate-50/70">
                        <th className="py-2.5 px-3">Plate</th>
                        <th className="py-2.5 px-3">Owner &amp; Unit</th>
                        <th className="py-2.5 px-3">Category</th>
                        <th className="py-2.5 px-3">Access</th>
                        <th className="py-2.5 px-3 text-right">Remove</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {vehicles.map((v) => (
                        <tr key={v.id} className="hover:bg-slate-50/90">
                          <td className="py-2.5 px-3">
                            <IndianPlateBadge plate={v.plate_number} size="sm" />
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-slate-900">{v.owner_name}</div>
                            <div className="text-[11px] text-slate-500">
                              {v.flat_or_unit} {v.phone_number ? `• ${v.phone_number}` : ""}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-slate-700 font-medium">
                            {v.vehicle_type} • {v.parking_type}
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                v.access_status === "WHITELIST"
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  : "bg-rose-50 text-rose-700 border border-rose-200"
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
                              className="text-slate-400 hover:text-rose-600"
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

          {/* 5. RATE CONFIGURATOR PAGE */}
          {subTab === "rates" && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-4 bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-4">
                <h3 className="text-base font-bold text-slate-900">Configure Tariff Rule</h3>
                <form onSubmit={handleSaveRate} className="space-y-3 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Vehicle Type</label>
                      <select
                        value={rForm.vehicle_type}
                        onChange={(e) => setRForm({ ...rForm, vehicle_type: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
                      >
                        <option value="2W">2-Wheeler (2W)</option>
                        <option value="4W">4-Wheeler (4W)</option>
                        <option value="HCV">Heavy Vehicle (HCV)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Parking Type</label>
                      <select
                        value={rForm.parking_type}
                        onChange={(e) => setRForm({ ...rForm, parking_type: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
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
                      <label className="block font-semibold text-slate-700 mb-1">Free Grace (mins)</label>
                      <input
                        type="number"
                        value={rForm.grace_period_mins}
                        onChange={(e) => setRForm({ ...rForm, grace_period_mins: Number(e.target.value) })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Base Slab (hours)</label>
                      <input
                        type="number"
                        value={rForm.base_hours}
                        onChange={(e) => setRForm({ ...rForm, base_hours: Number(e.target.value) })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Base Fee (₹)</label>
                      <input
                        type="number"
                        value={rForm.base_fee_inr}
                        onChange={(e) => setRForm({ ...rForm, base_fee_inr: Number(e.target.value) })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Extra / Hr (₹)</label>
                      <input
                        type="number"
                        value={rForm.extra_hourly_rate_inr}
                        onChange={(e) => setRForm({ ...rForm, extra_hourly_rate_inr: Number(e.target.value) })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Daily Cap (₹)</label>
                      <input
                        type="number"
                        value={rForm.daily_max_cap_inr}
                        onChange={(e) => setRForm({ ...rForm, daily_max_cap_inr: Number(e.target.value) })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
                      />
                    </div>
                  </div>

                  <label className="flex items-center space-x-2 text-slate-700 pt-1">
                    <input
                      type="checkbox"
                      checked={rForm.is_free_for_whitelist}
                      onChange={(e) => setRForm({ ...rForm, is_free_for_whitelist: e.target.checked })}
                      className="accent-[#A62626]"
                    />
                    <span>Zero tariff (₹0) for Whitelisted vehicles</span>
                  </label>

                  <button
                    type="submit"
                    className="w-full py-2.5 bg-[#A62626] hover:bg-[#8B1E1E] text-white font-bold rounded-xl shadow-sm transition-colors"
                  >
                    Save Tariff Rule
                  </button>
                </form>
              </div>

              <div className="lg:col-span-8 bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs">
                <h3 className="text-base font-bold text-slate-900 mb-4">Active Rate Matrix ({rates.length})</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500 bg-slate-50/70">
                        <th className="py-2.5 px-3">Vehicle</th>
                        <th className="py-2.5 px-3">Parking Type</th>
                        <th className="py-2.5 px-3">Grace</th>
                        <th className="py-2.5 px-3">Base Slab</th>
                        <th className="py-2.5 px-3">Extra / Hr</th>
                        <th className="py-2.5 px-3">Daily Cap</th>
                        <th className="py-2.5 px-3 text-right">Delete</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rates.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-50/90">
                          <td className="py-2.5 px-3 font-bold text-slate-900">{r.vehicle_type}</td>
                          <td className="py-2.5 px-3 text-[#A62626] font-bold">{r.parking_type}</td>
                          <td className="py-2.5 px-3 text-slate-700">{r.grace_period_mins} mins</td>
                          <td className="py-2.5 px-3 text-emerald-700 font-bold">
                            ₹{r.base_fee_inr} ({r.base_hours}h)
                          </td>
                          <td className="py-2.5 px-3 text-slate-700">₹{r.extra_hourly_rate_inr}/hr</td>
                          <td className="py-2.5 px-3 text-[#D97706] font-bold">₹{r.daily_max_cap_inr}</td>
                          <td className="py-2.5 px-3 text-right">
                            <button
                              onClick={async () => {
                                await fetch(`${API_BASE}/v1/parking/rates/${r.id}`, { method: "DELETE" })
                                fetchRates()
                              }}
                              className="text-slate-400 hover:text-rose-600"
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

          {/* 6. ORGANIZATION & CAPACITY CONFIGURATION PAGE */}
          {subTab === "org" && (
            <form onSubmit={handleSaveOrg} className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-5 bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-4">
                <h3 className="text-base font-bold text-slate-900">Organization Details</h3>
                <div className="space-y-3 text-xs">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Organization / Site Name
                    </label>
                    <input
                      type="text"
                      required
                      value={orgForm.org_name}
                      onChange={(e) => setOrgForm({ ...orgForm, org_name: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Site Address</label>
                    <input
                      type="text"
                      value={orgForm.address}
                      onChange={(e) => setOrgForm({ ...orgForm, address: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Contact Phone</label>
                      <input
                        type="text"
                        value={orgForm.contact_phone}
                        onChange={(e) => setOrgForm({ ...orgForm, contact_phone: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">GSTIN (Optional)</label>
                      <input
                        type="text"
                        value={orgForm.gst_number}
                        onChange={(e) => setOrgForm({ ...orgForm, gst_number: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 space-y-2">
                  <label className="block text-xs font-bold text-slate-700">Parking Zones / Types</label>
                  <div className="flex flex-wrap gap-1.5">
                    {orgForm.parking_types.map((pt) => (
                      <span
                        key={pt}
                        className="px-2.5 py-1 rounded-lg bg-[#FDF2F2] border border-[#F5C6C6] text-xs font-bold text-[#A62626] flex items-center gap-1.5"
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
                            className="text-[#A62626]/60 hover:text-rose-700"
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
                      className="flex-1 px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs uppercase text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
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
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-xl text-xs font-bold text-slate-800"
                    >
                      Add Type
                    </button>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-7 bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-4">
                <h3 className="text-base font-bold text-slate-900">
                  Slot Capacity Matrix (Vehicle Type × Parking Type)
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500 bg-slate-50/70">
                        <th className="py-2.5 px-3">Vehicle Category</th>
                        {orgForm.parking_types.map((pt) => (
                          <th key={pt} className="py-2.5 px-3">
                            {pt} Slots
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(["2W", "4W", "HCV"] as const).map((vt) => (
                        <tr key={vt}>
                          <td className="py-3 px-3 font-bold text-slate-900">
                            {vt === "2W"
                              ? "2-Wheeler (2W)"
                              : vt === "4W"
                              ? "4-Wheeler (4W)"
                              : "Heavy Vehicle (HCV)"}
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
                                className="w-20 px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-mono focus:bg-white focus:outline-none focus:border-[#A62626]"
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
                  className="px-5 py-2.5 bg-[#A62626] hover:bg-[#8B1E1E] text-white text-xs font-bold rounded-xl shadow-sm transition-colors"
                >
                  Save Organization &amp; Slot Capacity
                </button>
              </div>
            </form>
          )}
        </main>

        {/* FOOTER */}
        <footer className="py-4 px-8 border-t border-slate-200 bg-white text-xs text-slate-500 flex flex-wrap items-center justify-between gap-2">
          <span>© {new Date().getFullYear()} Sigma eSolution Pvt Ltd • All Rights Reserved</span>
          <span className="text-[11px] text-slate-400">Smart Parking &amp; Access Control • Vision AI Engine</span>
        </footer>
      </div>
    </div>
  )
}