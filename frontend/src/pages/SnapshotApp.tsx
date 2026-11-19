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
  Maximize2
} from "lucide-react"
import type { UserSession } from "../App"
import IndianPlateBadge from "../components/IndianPlateBadge"
import ImageLightbox from "../components/ImageLightbox"
import PaginationBar from "../components/PaginationBar"

interface SnapshotAppProps {
  user: UserSession
  onBackToApps: () => void
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

const API_BASE = "http://localhost:8000"

export default function SnapshotApp({ user, onBackToApps }: SnapshotAppProps) {
  const [subTab, setSubTab] = useState<"workspace" | "history">(() => {
    const saved = localStorage.getItem("anpr_snapshot_subtab")
    return saved === "history" ? "history" : "workspace"
  })

  useEffect(() => {
    localStorage.setItem("anpr_snapshot_subtab", subTab)
  }, [subTab])

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

  const showToast = (type: "success" | "error", text: string) => {
    setToast({ type, text })
    setTimeout(() => setToast(null), 3500)
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
        page_size: String(pageSize)
      })
      if (searchQuery.trim()) params.append("search", searchQuery.trim())

      const [logsRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/v1/logs?${params.toString()}`),
        fetch(`${API_BASE}/v1/stats?user_id=${user.id}&app_source=snapshot`)
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
            category: data.result.category
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
    const rows = logs.map((l) => [l.id, l.plate_number, l.category, l.confidence, l.status, l.created_at])
    const csv = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n")
    const link = document.createElement("a")
    link.setAttribute("href", encodeURI(csv))
    link.setAttribute("download", `snapshot_anpr_page_${page}_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

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
        category={lightboxItem?.category}
        onClose={() => setLightboxItem(null)}
      />

      {/* HEADER */}
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
            <div className="p-2 bg-blue-600/20 text-blue-400 rounded-lg border border-blue-500/30">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-white">ANPR Snapshot Studio</h1>
              <p className="text-[11px] text-slate-400">Single-Frame OCR & Indian RTO Validation</p>
            </div>
          </div>
        </div>

        {/* PERSISTENT SUB-TABS */}
        <div className="flex items-center space-x-2 bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => setSubTab("workspace")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              subTab === "workspace" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            OCR Workspace
          </button>
          <button
            onClick={() => setSubTab("history")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              subTab === "history" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Full Scan Logs ({totalItems})
          </button>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={fetchSnapshotData}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium border border-slate-700"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingLogs ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
          <button
            onClick={exportCSV}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </header>

      <main className="flex-1 p-8 max-w-[1600px] w-full mx-auto space-y-6">
        {/* KPI ROW */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-xs text-slate-400 uppercase font-medium">Total Snapshots</p>
            <p className="text-2xl font-bold text-white mt-1">{stats.total_scans}</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-xs text-slate-400 uppercase font-medium">Verified RTO Plates</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">{stats.verified_scans}</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-xs text-slate-400 uppercase font-medium">Unreadable Frames</p>
            <p className="text-2xl font-bold text-amber-400 mt-1">{stats.failed_scans}</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-xs text-slate-400 uppercase font-medium">Avg Confidence</p>
            <p className="text-2xl font-bold text-blue-400 mt-1">{stats.avg_confidence}%</p>
          </div>
        </div>

        {/* SUB-TAB 1: WORKSPACE */}
        {subTab === "workspace" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-white">Single Image Input</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Click, drag & drop, or press <kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-300">Ctrl+V</kbd> to paste
                  </p>
                </div>
                {file && (
                  <button
                    onClick={handleReset}
                    className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 border border-slate-700"
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
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                  isDragging
                    ? "border-blue-400 bg-blue-950/20"
                    : "border-slate-700 hover:border-blue-500 bg-slate-950/60"
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
                    <img src={preview} alt="Preview" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="py-10 flex flex-col items-center space-y-2 text-slate-400">
                    <Upload className="w-7 h-7 text-blue-400" />
                    <p className="text-sm font-medium text-slate-200">Drop vehicle image here or click to browse</p>
                    <p className="text-xs text-slate-500">Single file • JPG, PNG, WEBP</p>
                  </div>
                )}
              </div>

              <button
                disabled={!file || status === "uploading" || status === "processing"}
                onClick={handleUpload}
                className={`w-full py-3 rounded-lg font-medium text-sm flex items-center justify-center transition-colors ${
                  !file || status === "uploading" || status === "processing"
                    ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                    : "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20"
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
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-semibold uppercase text-slate-400 block">
                      {result.category || "STANDARD"} SERIES
                    </span>
                    <IndianPlateBadge plate={result.plate} category={result.category} size="lg" />
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] text-slate-400 block">OCR Score</span>
                    <span
                      className={`text-xl font-bold ${
                        result.confidence >= 80 ? "text-emerald-400" : "text-amber-400"
                      }`}
                    >
                      {result.confidence}%
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-semibold text-white">Recent Snapshot Captures</h2>
                  <p className="text-xs text-slate-400">Click any thumbnail to inspect the full-resolution frame</p>
                </div>
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2" />
                  <input
                    type="text"
                    placeholder="Search plate..."
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    className="pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-[11px] font-semibold uppercase text-slate-400">
                      <th className="py-3 px-3">Frame</th>
                      <th className="py-3 px-3">Detected Plate</th>
                      <th className="py-3 px-3">Format</th>
                      <th className="py-3 px-3">Confidence</th>
                      <th className="py-3 px-3">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 text-xs">
                    {logs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-slate-500">
                          No snapshot records yet. Upload or paste a vehicle image to begin.
                        </td>
                      </tr>
                    ) : (
                      logs.slice(0, 8).map((item) => (
                        <tr key={item.id} className="hover:bg-slate-800/40">
                          <td className="py-2.5 px-3">
                            <button
                              onClick={() => setLightboxItem(item)}
                              className="relative group block rounded overflow-hidden border border-slate-700"
                            >
                              <img src={item.image_url} alt={item.plate_number} className="w-14 h-9 object-cover" />
                              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                <Maximize2 className="w-3.5 h-3.5 text-white" />
                              </div>
                            </button>
                          </td>
                          <td className="py-2.5 px-3">
                            <IndianPlateBadge plate={item.plate_number} category={item.category} size="sm" />
                          </td>
                          <td className="py-2.5 px-3 text-slate-300">{item.category}</td>
                          <td className="py-2.5 px-3 font-semibold text-emerald-400">
                            <span className="inline-flex items-center gap-1">
                              <Activity className="w-3 h-3" /> {item.confidence}%
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-400">
                            {item.created_at ? new Date(item.created_at).toLocaleString() : "-"}
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

        {/* SUB-TAB 2: FULL SCAN LOGS WITH SERVER-SIDE PAGINATION */}
        {subTab === "history" && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">Complete Snapshot Audit Repository</h2>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2" />
                <input
                  type="text"
                  placeholder="Filter by plate..."
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-xs font-semibold uppercase text-slate-400">
                    <th className="py-3 px-4">ID</th>
                    <th className="py-3 px-4">Frame</th>
                    <th className="py-3 px-4">Detected Plate</th>
                    <th className="py-3 px-4">Format</th>
                    <th className="py-3 px-4">Confidence</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-xs">
                  {logs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-500">
                        No matching records found.
                      </td>
                    </tr>
                  ) : (
                    logs.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-800/40">
                        <td className="py-3 px-4 text-slate-400">#{item.id}</td>
                        <td className="py-3 px-4">
                          <button
                            onClick={() => setLightboxItem(item)}
                            className="relative group block rounded overflow-hidden border border-slate-700"
                          >
                            <img src={item.image_url} alt={item.plate_number} className="w-16 h-10 object-cover" />
                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                              <Maximize2 className="w-3.5 h-3.5 text-white" />
                            </div>
                          </button>
                        </td>
                        <td className="py-3 px-4">
                          <IndianPlateBadge plate={item.plate_number} category={item.category} size="sm" />
                        </td>
                        <td className="py-3 px-4 text-slate-300">{item.category}</td>
                        <td className="py-3 px-4 font-semibold text-emerald-400">{item.confidence}%</td>
                        <td className="py-3 px-4 text-slate-300">{item.status}</td>
                        <td className="py-3 px-4 text-slate-400">
                          {item.created_at ? new Date(item.created_at).toLocaleString() : "-"}
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
      </main>
    </div>
  )
}