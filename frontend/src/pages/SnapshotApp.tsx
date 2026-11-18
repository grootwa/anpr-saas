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
  ShieldCheck
} from "lucide-react"
import type { UserSession } from "../App"

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
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [status, setStatus] = useState<"idle" | "uploading" | "processing" | "success" | "error">("idle")
  const [result, setResult] = useState<{ plate: string; confidence: number; category?: string } | null>(null)

  const [logs, setLogs] = useState<LogItem[]>([])
  const [stats, setStats] = useState({ total_scans: 0, verified_scans: 0, failed_scans: 0, avg_confidence: 0 })
  const [searchQuery, setSearchQuery] = useState("")
  const [loadingLogs, setLoadingLogs] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchSnapshotData = useCallback(async () => {
    setLoadingLogs(true)
    try {
      const params = new URLSearchParams({
        user_id: String(user.id),
        app_source: "snapshot",
        limit: "50"
      })
      if (searchQuery.trim()) params.append("search", searchQuery.trim())

      const [logsRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/v1/logs?${params.toString()}`),
        fetch(`${API_BASE}/v1/stats?user_id=${user.id}&app_source=snapshot`)
      ])
      if (logsRes.ok) setLogs(await logsRes.json())
      if (statsRes.ok) setStats(await statsRes.json())
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingLogs(false)
    }
  }, [user.id, searchQuery])

  useEffect(() => {
    fetchSnapshotData()
  }, [fetchSnapshotData])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0]
      setFile(selected)
      setPreview(URL.createObjectURL(selected))
      setStatus("idle")
      setResult(null)
    }
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
          fetchSnapshotData()
        } else if (data.status === "failed") {
          clearInterval(interval)
          setStatus("error")
        }
      } catch {
        clearInterval(interval)
        setStatus("error")
      }
    }, 800)
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
    }
  }

  const exportCSV = () => {
    const headers = ["ID", "Plate", "Category", "Confidence (%)", "Status", "Timestamp"]
    const rows = logs.map((l) => [l.id, l.plate_number, l.category, l.confidence, l.status, l.created_at])
    const csv = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n")
    const link = document.createElement("a")
    link.setAttribute("href", encodeURI(csv))
    link.setAttribute("download", `snapshot_anpr_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="min-h-screen w-screen bg-slate-950 text-slate-100 flex flex-col">
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

        {/* WORKSPACE GRID */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* LEFT: UPLOADER */}
          <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
            <div>
              <h2 className="text-base font-semibold text-white">Single Image Input</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Upload a vehicle frame to inspect YOLO localization and RapidOCR output.
              </p>
            </div>

            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-700 hover:border-blue-500 rounded-xl p-6 text-center cursor-pointer bg-slate-950/60 transition-colors"
            >
              <input type="file" className="hidden" ref={fileInputRef} accept="image/*" onChange={handleFileSelect} />
              {preview ? (
                <div className="w-full aspect-video rounded-lg overflow-hidden border border-slate-700">
                  <img src={preview} alt="Preview" className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="py-10 flex flex-col items-center space-y-2 text-slate-400">
                  <Upload className="w-7 h-7 text-blue-400" />
                  <p className="text-sm font-medium text-slate-200">Click to upload vehicle image</p>
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
                  : "bg-blue-600 hover:bg-blue-500 text-white"
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
                  <AlertCircle className="w-4 h-4 mr-2" /> Processing Error
                </>
              )}
            </button>

            {status === "success" && result && (
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-semibold uppercase text-slate-400 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    {result.category || "STANDARD"} SERIES
                  </span>
                  <p className="text-2xl font-mono font-bold text-white mt-1">{result.plate}</p>
                </div>
                <div className="text-right">
                  <span className="text-[11px] text-slate-400 block">Confidence</span>
                  <span className="text-lg font-bold text-emerald-400">{result.confidence}%</span>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: SCAN HISTORY */}
          <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-white">Snapshot History</h2>
                <p className="text-xs text-slate-400">Filtered to your account (`{user.email}`)</p>
              </div>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2" />
                <input
                  type="text"
                  placeholder="Search plate..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
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
                        No snapshot records yet. Upload a vehicle image to begin.
                      </td>
                    </tr>
                  ) : (
                    logs.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-800/40">
                        <td className="py-2.5 px-3">
                          <img
                            src={item.image_url}
                            alt={item.plate_number}
                            className="w-14 h-9 object-cover rounded border border-slate-700"
                          />
                        </td>
                        <td className="py-2.5 px-3 font-mono font-bold text-sm text-white">{item.plate_number}</td>
                        <td className="py-2.5 px-3 text-slate-300">{item.category}</td>
                        <td className="py-2.5 px-3 font-semibold text-emerald-400 flex items-center gap-1">
                          <Activity className="w-3 h-3" /> {item.confidence}%
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
      </main>
    </div>
  )
}