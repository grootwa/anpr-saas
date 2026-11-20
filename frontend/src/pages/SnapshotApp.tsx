import { useState, useRef, useEffect, useCallback } from "react"
import {
  Upload,
  Loader2,
  FileImage,
  CheckCircle2,
  AlertCircle,
  Camera,
  Search,
  Download,
  RefreshCw,
  ArrowLeft,
  Activity,
  RotateCcw,
  Maximize2,
  LogOut,
  FileSpreadsheet,
  ScanLine,
  Building2,
  Code2,
  Copy,
  Check,
  Terminal
} from "lucide-react"
import type { UserSession } from "../App"
import IndianPlateBadge from "../components/IndianPlateBadge"
import ImageLightbox from "../components/ImageLightbox"
import PaginationBar from "../components/PaginationBar"

interface SnapshotAppProps {
  user: UserSession
  onBackToApps: () => void
  onLogout?: () => void
}

interface LogItem {
  id: number
  task_id: string
  plate_number: string
  category: string
  confidence: number
  status: string
  image_url: string
  created_at: string
}

type SnapshotSubTab = "workspace" | "history" | "api"

const API_BASE = "http://localhost:8000"

export default function SnapshotApp({ user, onBackToApps, onLogout }: SnapshotAppProps) {
  const [subTab, setSubTab] = useState<SnapshotSubTab>(() => {
    const saved = localStorage.getItem("anpr_snapshot_subtab") as SnapshotSubTab
    return ["workspace", "history", "api"].includes(saved) ? saved : "workspace"
  })

  useEffect(() => {
    localStorage.setItem("anpr_snapshot_subtab", subTab)
  }, [subTab])

  const [logoFailed, setLogoFailed] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [orgName, setOrgName] = useState<string>(() => {
    try {
      const cached = localStorage.getItem(`anpr_org_config_${user.id}`)
      if (cached) {
        const parsed = JSON.parse(cached)
        if (parsed.org_name) return parsed.org_name
      }
    } catch {
      // Fallback
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
        // Keep cached value
      }
    }
    loadOrg()
    return () => {
      active = false
    }
  }, [user.id])

  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [status, setStatus] = useState<"idle" | "uploading" | "processing" | "success" | "error">("idle")
  const [result, setResult] = useState<{ plate: string; confidence: number; category?: string } | null>(null)
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null)

  const [logs, setLogs] = useState<LogItem[]>([])
  const [stats, setStats] = useState({ total_scans: 0, verified_scans: 0, failed_scans: 0, avg_confidence: 0 })
  const [searchQuery, setSearchQuery] = useState("")
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [lightboxItem, setLightboxItem] = useState<LogItem | null>(null)

  // Server-Side Pagination State
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(15)
  const [totalItems, setTotalItems] = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleLogoutClick = () => {
    if (onLogout) {
      onLogout()
    } else {
      localStorage.removeItem("anpr_token")
      localStorage.removeItem("anpr_user")
      window.location.reload()
    }
  }

  const showToast = (type: "success" | "error", text: string) => {
    setToast({ type, text })
    setTimeout(() => setToast(null), 3500)
  }

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      showToast("success", "Copied to clipboard")
      setTimeout(() => setCopiedKey(null), 2000)
    } catch {
      showToast("error", "Clipboard access blocked")
    }
  }

  const applySelectedFile = useCallback((selected: File) => {
    if (!selected.type.startsWith("image/")) {
      showToast("error", "Please provide a valid image file (JPG, PNG, WEBP).")
      return
    }
    setFile(selected)
    setPreview(URL.createObjectURL(selected))
    setStatus("idle")
    setResult(null)
  }, [])

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (subTab !== "workspace") return
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const pastedFile = item.getAsFile()
          if (pastedFile) {
            applySelectedFile(pastedFile)
            showToast("success", "Image pasted from clipboard")
          }
          break
        }
      }
    }
    window.addEventListener("paste", handlePaste)
    return () => window.removeEventListener("paste", handlePaste)
  }, [subTab, applySelectedFile])

  const fetchSnapshotData = useCallback(async () => {
    setLoadingLogs(true)
    try {
      const params = new URLSearchParams({
        user_id: String(user.id),
        app_source: "snapshot",
        page: String(page),
        page_size: String(pageSize),
      })
      if (searchQuery.trim()) params.append("search", searchQuery.trim())

      const [logsRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/v1/logs?${params.toString()}`),
        fetch(`${API_BASE}/v1/stats?user_id=${user.id}&app_source=snapshot`),
      ])

      if (logsRes.ok) {
        const data = await logsRes.json()
        setLogs(data.items || [])
        setTotalItems(data.total || 0)
        setTotalPages(data.total_pages || 1)
      }
      if (statsRes.ok) {
        setStats(await statsRes.json())
      }
    } catch {
      showToast("error", "Failed to sync logs from server.")
    } finally {
      setLoadingLogs(false)
    }
  }, [user.id, searchQuery, page, pageSize])

  useEffect(() => {
    fetchSnapshotData()
  }, [fetchSnapshotData])

  const handleSearchChange = (val: string) => {
    setSearchQuery(val)
    setPage(1)
  }

  const handleReset = () => {
    setFile(null)
    setPreview(null)
    setStatus("idle")
    setResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const pollStatus = (taskId: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/v1/status/${taskId}`)
        const data = await res.json()
        if (data.status === "completed") {
          clearInterval(interval)
          setResult({
            plate: data.result.plate,
            confidence: data.result.confidence,
            category: data.result.category,
          })
          setStatus("success")
          showToast("success", `Plate extracted: ${data.result.plate || "No text"}`)
          fetchSnapshotData()
        } else if (data.status === "failed") {
          clearInterval(interval)
          setStatus("error")
          showToast("error", "ANPR worker failed to process this frame.")
        }
      } catch {
        clearInterval(interval)
        setStatus("error")
      }
    }, 700)
  }

  const handleUpload = async () => {
    if (!file) return
    setStatus("uploading")
    const formData = new FormData()
    formData.append("file", file)
    formData.append("user_id", String(user.id))
    formData.append("app_source", "snapshot")

    try {
      const res = await fetch(`${API_BASE}/v1/snapshot`, { method: "POST", body: formData })
      if (!res.ok) throw new Error("Upload failed")
      const data = await res.json()
      setStatus("processing")
      pollStatus(data.task_id)
    } catch {
      setStatus("error")
      showToast("error", "Could not reach backend server.")
    }
  }

  const exportCSV = () => {
    const headers = ["ID", "Plate", "Category", "Confidence (%)", "Status", "Timestamp"]
    const rows = logs.map((l) => [
      l.id,
      l.plate_number,
      l.category,
      l.confidence,
      l.status,
      l.created_at ? new Date(l.created_at).toLocaleString("en-IN") : "",
    ])
    const csv = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n")
    const link = document.createElement("a")
    link.setAttribute("href", encodeURI(csv))
    link.setAttribute("download", `snapshot_anpr_page_${page}_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const curlSnippet = `curl -X POST "${API_BASE}/v1/snapshot" \\
  -F "file=@/path/to/vehicle.jpg" \\
  -F "user_id=${user.id}" \\
  -F "app_source=snapshot"`

  const pythonSnippet = `import time
import requests

API_BASE = "${API_BASE}"

# 1. Submit image frame for asynchronous ANPR extraction
with open("vehicle.jpg", "rb") as img:
    resp = requests.post(
        f"{API_BASE}/v1/snapshot",
        files={"file": img},
        data={"user_id": ${user.id}, "app_source": "snapshot"},
        timeout=15,
    )
resp.raise_for_status()
task_id = resp.json()["task_id"]

# 2. Poll task status until completed
while True:
    status_res = requests.get(f"{API_BASE}/v1/status/{task_id}", timeout=10).json()
    if status_res["status"] == "completed":
        print("Detected Plate:", status_res["result"])
        break
    if status_res["status"] == "failed":
        raise RuntimeError("ANPR extraction failed")
    time.sleep(0.5)`

  return (
    <div className="min-h-screen w-screen bg-slate-50 text-slate-900 flex">
      {/* TOAST NOTIFICATION */}
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

      <ImageLightbox
        imageUrl={lightboxItem?.image_url || null}
        plateNumber={lightboxItem?.plate_number}
        category={lightboxItem?.category}
        onClose={() => setLightboxItem(null)}
      />

      {/* LEFT VERTICAL SIDEBAR */}
      <aside className="w-64 shrink-0 bg-white border-r border-slate-200 flex flex-col justify-between sticky top-0 h-screen">
        <div>
          <div className="h-1.5 w-full bg-gradient-to-r from-[#A62626] via-[#F59E1B] to-[#8F1D36]" />

          {/* Brand & Org Info */}
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
              <span className="text-xs font-bold text-slate-800 truncate">{orgName}</span>
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
              ANPR Snapshot Studio
            </p>
          </div>

          {/* Vertical Navigation Items */}
          <nav className="px-4 space-y-1.5">
            <button
              onClick={() => setSubTab("workspace")}
              className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                subTab === "workspace"
                  ? "bg-[#FDF2F2] text-[#A62626] border border-[#F5C6C6] shadow-2xs"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <ScanLine
                className={`w-4 h-4 ${subTab === "workspace" ? "text-[#A62626]" : "text-slate-400"}`}
              />
              <span>OCR Workspace</span>
            </button>

            <button
              onClick={() => setSubTab("history")}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                subTab === "history"
                  ? "bg-[#FDF2F2] text-[#A62626] border border-[#F5C6C6] shadow-2xs"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <span className="flex items-center space-x-3">
                <FileSpreadsheet
                  className={`w-4 h-4 ${subTab === "history" ? "text-[#A62626]" : "text-slate-400"}`}
                />
                <span>Full Scan Logs</span>
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  subTab === "history" ? "bg-[#A62626] text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                {totalItems}
              </span>
            </button>

            <button
              onClick={() => setSubTab("api")}
              className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                subTab === "api"
                  ? "bg-[#FDF2F2] text-[#A62626] border border-[#F5C6C6] shadow-2xs"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <Code2
                className={`w-4 h-4 ${subTab === "api" ? "text-[#A62626]" : "text-slate-400"}`}
              />
              <span>API Integration</span>
            </button>
          </nav>
        </div>

        {/* Subtle Sidebar Status Badge */}
        <div className="p-4 border-t border-slate-100">
          <div className="px-3 py-2.5 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] text-[11px] text-amber-900">
            <p className="font-bold">REST API Ready</p>
            <p className="text-[10px] text-amber-700 mt-0.5">
              Tenant ID: <span className="font-mono font-bold">{user.id}</span> • Async OCR
            </p>
          </div>
        </div>
      </aside>

      {/* RIGHT CONTENT COLUMN */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* TOP HEADER WITH PROFILE & LOGOUT IN TOP-RIGHT CORNER */}
        <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between gap-4 sticky top-0 z-20">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-[#FFFBEB] text-[#D97706] border border-[#FDE68A]">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-900">ANPR Snapshot Studio</h1>
              <p className="text-[11px] text-slate-500">Single-Frame OCR &amp; Indian RTO Validation</p>
            </div>
          </div>

          {/* TOP-RIGHT USER PROFILE & LOGOUT */}
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2.5 pr-1">
              <div className="w-8 h-8 rounded-full bg-[#FDF2F2] border border-[#F5C6C6] text-[#A62626] font-bold text-xs flex items-center justify-center uppercase">
                {(user.full_name || "U").slice(0, 1)}
              </div>
              <div className="text-right hidden sm:block">
                <p className="text-xs font-bold text-slate-900 leading-tight">{user.full_name}</p>
                <p className="text-[11px] text-slate-500 leading-tight">{user.email}</p>
              </div>
            </div>

            <div className="h-6 w-px bg-slate-200" />

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

        {/* MAIN WORKSPACE */}
        <main className="flex-1 p-8 max-w-[1550px] w-full mx-auto space-y-6">
          {/* KPI ROW (Shown ONLY on OCR Workspace, removed from Full Scan Logs & API tabs) */}
          {subTab === "workspace" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs">
                <p className="text-[11px] text-slate-500 uppercase font-bold tracking-wider">
                  Total Snapshots
                </p>
                <p className="text-2xl font-extrabold text-slate-900 mt-1">{stats.total_scans}</p>
              </div>
              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs">
                <p className="text-[11px] text-slate-500 uppercase font-bold tracking-wider">
                  Verified RTO Plates
                </p>
                <p className="text-2xl font-extrabold text-emerald-600 mt-1">{stats.verified_scans}</p>
              </div>
              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs">
                <p className="text-[11px] text-slate-500 uppercase font-bold tracking-wider">
                  Unreadable Frames
                </p>
                <p className="text-2xl font-extrabold text-[#D97706] mt-1">{stats.failed_scans}</p>
              </div>
              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs">
                <p className="text-[11px] text-slate-500 uppercase font-bold tracking-wider">
                  Avg Confidence
                </p>
                <p className="text-2xl font-extrabold text-[#A62626] mt-1">{stats.avg_confidence}%</p>
              </div>
            </div>
          )}

          {/* SUB-TAB 1: WORKSPACE */}
          {subTab === "workspace" && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-5 bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">Single Image Input</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Click, drag &amp; drop, or press{" "}
                      <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-slate-700 font-mono text-[11px]">
                        Ctrl+V
                      </kbd>{" "}
                      to paste
                    </p>
                  </div>
                  {file && (
                    <button
                      onClick={handleReset}
                      className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 border border-slate-200"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Reset</span>
                    </button>
                  )}
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
                  className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
                    isDragging
                      ? "border-[#A62626] bg-[#FDF2F2]"
                      : "border-slate-300 hover:border-[#A62626]/60 bg-slate-50/70"
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
                    <div className="w-full aspect-video rounded-xl overflow-hidden border border-slate-200 shadow-xs">
                      <img src={preview} alt="Preview" className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="py-10 flex flex-col items-center space-y-2 text-slate-500">
                      <div className="p-3 rounded-2xl bg-[#FFFBEB] border border-[#FDE68A]">
                        <Upload className="w-6 h-6 text-[#D97706]" />
                      </div>
                      <p className="text-sm font-semibold text-slate-800">
                        Drop vehicle image here or click to browse
                      </p>
                      <p className="text-xs text-slate-400">Single file • JPG, PNG, WEBP</p>
                    </div>
                  )}
                </div>

                <button
                  disabled={!file || status === "uploading" || status === "processing"}
                  onClick={handleUpload}
                  className={`w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center transition-all ${
                    !file || status === "uploading" || status === "processing"
                      ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                      : "bg-[#A62626] hover:bg-[#8B1E1E] text-white shadow-md shadow-[#A62626]/20"
                  }`}
                >
                  {status === "idle" && (
                    <>
                      <FileImage className="w-4 h-4 mr-2" /> Run ANPR Inference
                    </>
                  )}
                  {status === "uploading" && (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading...
                    </>
                  )}
                  {status === "processing" && (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Extracting Plate...
                    </>
                  )}
                  {status === "success" && (
                    <>
                      <CheckCircle2 className="w-4 h-4 mr-2" /> Extraction Complete
                    </>
                  )}
                  {status === "error" && (
                    <>
                      <AlertCircle className="w-4 h-4 mr-2" /> Retry Inference
                    </>
                  )}
                </button>

                {status === "success" && result && (
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                    <div className="space-y-1.5">
                      <span className="text-[11px] font-bold uppercase text-slate-500 block">
                        {result.category || "STANDARD"} SERIES
                      </span>
                      <IndianPlateBadge plate={result.plate} category={result.category} size="lg" />
                    </div>
                    <div className="text-right">
                      <span className="text-[11px] font-semibold text-slate-500 block">OCR Score</span>
                      <span
                        className={`text-xl font-extrabold ${
                          result.confidence >= 80 ? "text-emerald-600" : "text-[#D97706]"
                        }`}
                      >
                        {result.confidence}%
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="lg:col-span-7 bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs flex flex-col">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">Recent Snapshot Captures</h2>
                    <p className="text-xs text-slate-500">
                      Click any thumbnail to inspect the full-resolution frame
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        placeholder="Search plate..."
                        value={searchQuery}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        className="pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
                      />
                    </div>
                    <button
                      onClick={fetchSnapshotData}
                      className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200"
                      title="Refresh captures"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingLogs ? "animate-spin text-[#A62626]" : ""}`} />
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto flex-1">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500 bg-slate-50/70">
                        <th className="py-3 px-3">Frame</th>
                        <th className="py-3 px-3">Detected Plate</th>
                        <th className="py-3 px-3">Format</th>
                        <th className="py-3 px-3">Confidence</th>
                        <th className="py-3 px-3">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {logs.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-12 text-center text-slate-400">
                            No snapshot records yet. Upload or paste a vehicle image to begin.
                          </td>
                        </tr>
                      ) : (
                        logs.slice(0, 8).map((item) => (
                          <tr key={item.id} className="hover:bg-slate-50/90 transition-colors">
                            <td className="py-2.5 px-3">
                              <button
                                onClick={() => setLightboxItem(item)}
                                className="relative group block rounded-lg overflow-hidden border border-slate-200"
                              >
                                <img
                                  src={item.image_url}
                                  alt={item.plate_number}
                                  className="w-14 h-9 object-cover"
                                />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                  <Maximize2 className="w-3.5 h-3.5 text-white" />
                                </div>
                              </button>
                            </td>
                            <td className="py-2.5 px-3">
                              <IndianPlateBadge plate={item.plate_number} category={item.category} size="sm" />
                            </td>
                            <td className="py-2.5 px-3 font-medium text-slate-700">{item.category}</td>
                            <td className="py-2.5 px-3 font-bold text-emerald-600">
                              <span className="inline-flex items-center gap-1">
                                <Activity className="w-3 h-3" /> {item.confidence}%
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-slate-500">
                              {item.created_at ? new Date(item.created_at).toLocaleString("en-IN") : "-"}
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

          {/* SUB-TAB 2: FULL SCAN LOGS (CLEAN DATATABLE + SEARCH + EXPORT ONLY, NO KPI CARDS) */}
          {subTab === "history" && (
            <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Complete Snapshot Audit Repository</h2>
                  <p className="text-xs text-slate-500">
                    Showing {totalItems} total recorded ANPR snapshot scans
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="Filter by plate..."
                      value={searchQuery}
                      onChange={(e) => handleSearchChange(e.target.value)}
                      className="pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
                    />
                  </div>

                  <button
                    onClick={exportCSV}
                    className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-[#A62626] hover:bg-[#8B1E1E] text-white text-xs font-semibold shadow-2xs transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export CSV</span>
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-bold uppercase text-slate-500 bg-slate-50/70">
                      <th className="py-3 px-4">ID</th>
                      <th className="py-3 px-4">Frame</th>
                      <th className="py-3 px-4">Detected Plate</th>
                      <th className="py-3 px-4">Format</th>
                      <th className="py-3 px-4">Confidence</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {logs.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-slate-400">
                          No matching records found.
                        </td>
                      </tr>
                    ) : (
                      logs.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50/90 transition-colors">
                          <td className="py-3 px-4 font-mono text-slate-500">#{item.id}</td>
                          <td className="py-3 px-4">
                            <button
                              onClick={() => setLightboxItem(item)}
                              className="relative group block rounded-lg overflow-hidden border border-slate-200"
                            >
                              <img
                                src={item.image_url}
                                alt={item.plate_number}
                                className="w-16 h-10 object-cover"
                              />
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                <Maximize2 className="w-3.5 h-3.5 text-white" />
                              </div>
                            </button>
                          </td>
                          <td className="py-3 px-4">
                            <IndianPlateBadge plate={item.plate_number} category={item.category} size="sm" />
                          </td>
                          <td className="py-3 px-4 font-medium text-slate-700">{item.category}</td>
                          <td className="py-3 px-4 font-bold text-emerald-600">{item.confidence}%</td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              {item.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-500">
                            {item.created_at ? new Date(item.created_at).toLocaleString("en-IN") : "-"}
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

          {/* SUB-TAB 3: REST API INTEGRATION GUIDE */}
          {subTab === "api" && (
            <div className="space-y-6">
              {/* Endpoint Summary Cards */}
              <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                  <div className="flex items-center space-x-3">
                    <div className="p-2.5 rounded-xl bg-[#FDF2F2] text-[#A62626] border border-[#F5C6C6]">
                      <Terminal className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-slate-900">
                        Snapshot ANPR REST API Reference
                      </h2>
                      <p className="text-xs text-slate-500">
                        Integrate external cameras, weighbridges, or third-party apps directly with your account
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                    <span className="text-slate-500">Your User ID:</span>
                    <span className="font-mono font-bold text-[#A62626]">{user.id}</span>
                  </div>
                </div>

                {/* Endpoint 1 & 2 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-bold">
                        POST
                      </span>
                      <span className="text-[11px] font-semibold text-slate-500">multipart/form-data</span>
                    </div>
                    <p className="font-mono text-xs font-bold text-slate-900">
                      {API_BASE}/v1/snapshot
                    </p>
                    <p className="text-xs text-slate-600">
                      Submits a vehicle image frame to the Celery OCR worker and returns a <code className="font-mono text-[#A62626]">task_id</code>.
                    </p>
                    <div className="pt-2 border-t border-slate-200/80 text-[11px] text-slate-600 space-y-1 font-mono">
                      <div>• <strong>file</strong>: Image binary (JPG / PNG / WEBP)</div>
                      <div>• <strong>user_id</strong>: {user.id}</div>
                      <div>• <strong>app_source</strong>: &quot;snapshot&quot;</div>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded bg-amber-600 text-white text-[10px] font-bold">
                        GET
                      </span>
                      <span className="text-[11px] font-semibold text-slate-500">application/json</span>
                    </div>
                    <p className="font-mono text-xs font-bold text-slate-900">
                      {API_BASE}/v1/status/&#123;task_id&#125;
                    </p>
                    <p className="text-xs text-slate-600">
                      Polls extraction status (<code className="font-mono">processing</code> / <code className="font-mono">completed</code>) and returns plate, confidence, and RTO format.
                    </p>
                    <pre className="mt-2 p-2.5 rounded-lg bg-white border border-slate-200 text-[11px] font-mono text-slate-800 overflow-x-auto">
{`{
  "status": "completed",
  "result": { "plate": "JH01FC5097", "confidence": 96.4, "category": "PRIVATE" }
}`}
                    </pre>
                  </div>
                </div>
              </div>

              {/* Code Examples */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* cURL Example */}
                <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900">cURL Quick Test</h3>
                    <button
                      onClick={() => handleCopy("curl", curlSnippet)}
                      className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-[#FDF2F2] text-slate-700 hover:text-[#A62626] border border-slate-200 text-xs font-semibold transition-colors"
                    >
                      {copiedKey === "curl" ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy cURL</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="p-4 rounded-xl bg-slate-900 text-slate-100 text-xs font-mono overflow-x-auto leading-relaxed">
                    {curlSnippet}
                  </pre>
                </div>

                {/* Python Example */}
                <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900">Python Integration Example</h3>
                    <button
                      onClick={() => handleCopy("python", pythonSnippet)}
                      className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-[#FDF2F2] text-slate-700 hover:text-[#A62626] border border-slate-200 text-xs font-semibold transition-colors"
                    >
                      {copiedKey === "python" ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy Python</span>
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="p-4 rounded-xl bg-slate-900 text-slate-100 text-xs font-mono overflow-x-auto leading-relaxed">
                    {pythonSnippet}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* FOOTER */}
        <footer className="py-4 px-8 border-t border-slate-200 bg-white text-xs text-slate-500 flex flex-wrap items-center justify-between gap-2">
          <span>© {new Date().getFullYear()} Sigma eSolution Pvt Ltd • All Rights Reserved</span>
          <span className="text-[11px] text-slate-400">ANPR Snapshot Studio • Vision AI Engine</span>
        </footer>
      </div>
    </div>
  )
}