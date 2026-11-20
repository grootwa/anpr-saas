import { useState, useEffect, useRef, useCallback } from "react"
import { Video, Play, Square, Trash2, Plus, Save, Crosshair, CheckCircle2, Layers } from "lucide-react"

export interface CameraDevice {
  id: number
  gate_no: string
  gate_name: string
  source_url: string
  gate_type: "ENTRY" | "EXIT"
  line_x1: number
  line_y1: number
  line_x2: number
  line_y2: number
  is_active: boolean
  burst_frames: number
  connected: boolean
  status_text: string
}

interface Props {
  userId: number
  apiBase: string
  onNotify: (type: "success" | "error", text: string) => void
}

export default function CameraManagerSection({ userId, apiBase, onNotify }: Props) {
  const [cameras, setCameras] = useState<CameraDevice[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)

  // Form state (Top-Right)
  const [gateNo, setGateNo] = useState("")
  const [gateName, setGateName] = useState("")
  const [sourceUrl, setSourceUrl] = useState("")
  const [gateType, setGateType] = useState<"ENTRY" | "EXIT">("ENTRY")
  const [burstFrames, setBurstFrames] = useState<number>(1)
  const [isActive, setIsActive] = useState(true)

  // Slant line normalized state (Top-Left Canvas)
  const [lineCoords, setLineCoords] = useState({ x1: 0.15, y1: 0.65, x2: 0.85, y2: 0.65 })
  const [draggingHandle, setDraggingHandle] = useState<"p1" | "p2" | null>(null)
  const [frameUrl, setFrameUrl] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)

  const selectedCam = cameras.find((c) => c.id === selectedId) || null

  const loadCameras = useCallback(async () => {
    const res = await fetch(`${apiBase}/v1/cameras/list?user_id=${userId}`)
    if (res.ok) {
      const list: CameraDevice[] = await res.json()
      setCameras(list)
    }
  }, [apiBase, userId])

  useEffect(() => {
    loadCameras()
  }, [loadCameras])

  // Select camera from bottom table -> load feed & populate form
  const handleSelectCamera = (cam: CameraDevice) => {
    setSelectedId(cam.id)
    setGateNo(cam.gate_no)
    setGateName(cam.gate_name)
    setSourceUrl(cam.source_url)
    setGateType(cam.gate_type)
    setBurstFrames(cam.burst_frames ?? 3)
    setIsActive(cam.is_active)
    setLineCoords({ x1: cam.line_x1, y1: cam.line_y1, x2: cam.line_x2, y2: cam.line_y2 })
  }

  const handleResetNewForm = () => {
    setSelectedId(null)
    setGateNo("")
    setGateName("")
    setSourceUrl("")
    setGateType("ENTRY")
    setBurstFrames(3)
    setIsActive(true)
    setLineCoords({ x1: 0.15, y1: 0.65, x2: 0.85, y2: 0.65 })
    setFrameUrl(null)
  }

  // Poll single latest frame ONLY for the currently selected active camera
  useEffect(() => {
    if (!selectedCam || !selectedCam.is_active) {
      setFrameUrl(null)
      return
    }
    let cancelled = false
    let timer: number | undefined

    const fetchFrame = () => {
      if (cancelled) return
      if (document.visibilityState !== "visible") {
        timer = window.setTimeout(fetchFrame, 500)
        return
      }
      const url = `${apiBase}/v1/cameras/${selectedCam.id}/latest-frame?t=${Date.now()}`
      const img = new Image()
      img.onload = () => {
        if (!cancelled) {
          setFrameUrl(url)
          timer = window.setTimeout(fetchFrame, 160)
        }
      }
      img.onerror = () => {
        if (!cancelled) timer = window.setTimeout(fetchFrame, 600)
      }
      img.src = url
    }

    fetchFrame()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [apiBase, selectedCam])

  // Draw interactive slant line overlay on HTML5 canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height
    ctx.clearRect(0, 0, w, h)

    const x1 = lineCoords.x1 * w
    const y1 = lineCoords.y1 * h
    const x2 = lineCoords.x2 * w
    const y2 = lineCoords.y2 * h

    ctx.strokeStyle = gateType === "ENTRY" ? "#16a34a" : "#f59e0b"
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()

    ;[
      { x: x1, y: y1 },
      { x: x2, y: y2 },
    ].forEach((pt) => {
      ctx.fillStyle = "#ffffff"
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, 7, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = "#A62626"
      ctx.lineWidth = 2.5
      ctx.stroke()
    })
  }, [lineCoords, gateType])

  const getNormCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      nx: Math.max(0.02, Math.min(0.98, (e.clientX - rect.left) / rect.width)),
      ny: Math.max(0.02, Math.min(0.98, (e.clientY - rect.top) / rect.height)),
    }
  }

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { nx, ny } = getNormCoords(e)
    const d1 = Math.hypot(nx - lineCoords.x1, ny - lineCoords.y1)
    const d2 = Math.hypot(nx - lineCoords.x2, ny - lineCoords.y2)
    if (d1 < 0.08) setDraggingHandle("p1")
    else if (d2 < 0.08) setDraggingHandle("p2")
  }

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!draggingHandle) return
    const { nx, ny } = getNormCoords(e)
    setLineCoords((prev) =>
      draggingHandle === "p1" ? { ...prev, x1: nx, y1: ny } : { ...prev, x2: nx, y2: ny }
    )
  }

  const handleSaveSlantLine = async () => {
    if (!selectedCam) return
    const res = await fetch(`${apiBase}/v1/cameras/${selectedCam.id}/line`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        line_x1: lineCoords.x1,
        line_y1: lineCoords.y1,
        line_x2: lineCoords.x2,
        line_y2: lineCoords.y2,
      }),
    })
    if (res.ok) {
      onNotify("success", `Slant tripwire saved for ${selectedCam.gate_no}`)
      loadCameras()
    }
  }

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!gateNo.trim() || !gateName.trim() || !sourceUrl.trim()) return

    const safeBurst = Math.max(1, Math.min(10, Number(burstFrames) || 3))
    const payload = {
      user_id: userId,
      gate_no: gateNo,
      gate_name: gateName,
      source_url: sourceUrl,
      gate_type: gateType,
      burst_frames: safeBurst,
      line_x1: lineCoords.x1,
      line_y1: lineCoords.y1,
      line_x2: lineCoords.x2,
      line_y2: lineCoords.y2,
      is_active: isActive,
    }

    const url = selectedCam ? `${apiBase}/v1/cameras/${selectedCam.id}` : `${apiBase}/v1/cameras/create`
    const method = selectedCam ? "PUT" : "POST"

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      const saved: CameraDevice = await res.json()
      onNotify(
        "success",
        selectedCam
          ? `Camera updated (${safeBurst} frame${safeBurst > 1 ? "s" : ""}/vehicle)`
          : `New camera configured (${safeBurst} frame${safeBurst > 1 ? "s" : ""}/vehicle)`
      )
      await loadCameras()
      setSelectedId(saved.id)
    }
  }

  const handleToggleStream = async (camId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    const res = await fetch(`${apiBase}/v1/cameras/${camId}/toggle`, { method: "POST" })
    if (res.ok) loadCameras()
  }

  const handleDeleteCamera = async (camId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    const res = await fetch(`${apiBase}/v1/cameras/${camId}`, { method: "DELETE" })
    if (res.ok) {
      if (selectedId === camId) handleResetNewForm()
      onNotify("success", "Camera removed")
      loadCameras()
    }
  }

  return (
    <div className="space-y-6">
      {/* TOP SPLIT: LEFT = VIDEO FEED + SLANT LINE DRAWER | RIGHT = CAMERA SETUP FORM */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* TOP-LEFT: VIDEO FEED & SLANT TRIPWIRE CANVAS */}
        <div className="lg:col-span-6 bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <div className="p-2 rounded-xl bg-[#FDF2F2] text-[#A62626] border border-[#F5C6C6]">
                <Video className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">
                {selectedCam ? `${selectedCam.gate_no} — ${selectedCam.gate_name}` : "Camera Preview & Tripwire"}
              </h3>
            </div>
            {selectedCam && (
              <button
                onClick={handleSaveSlantLine}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-2xs transition-colors"
              >
                <Crosshair className="w-3.5 h-3.5" /> Save Slant Line
              </button>
            )}
          </div>

          <div className="relative w-full aspect-video bg-slate-900 rounded-xl overflow-hidden border border-slate-300 flex items-center justify-center shadow-inner">
            {selectedCam && selectedCam.is_active && frameUrl ? (
              <img src={frameUrl} alt="Selected Camera Feed" className="w-full h-full object-contain select-none" />
            ) : (
              <div className="text-center space-y-1.5 text-slate-400 px-6">
                <p className="text-xs font-semibold text-slate-200">
                  {selectedCam ? "Camera Stream Stopped" : "Select a configured camera below"}
                </p>
                <p className="text-[11px] text-slate-400">
                  Drag the two white handles on the preview to set any horizontal or slanted tripwire line.
                </p>
              </div>
            )}

            <canvas
              ref={canvasRef}
              width={640}
              height={360}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={() => setDraggingHandle(null)}
              onMouseLeave={() => setDraggingHandle(null)}
              className="absolute inset-0 w-full h-full cursor-crosshair"
            />
          </div>

          <p className="text-[11px] text-slate-500">
            Drag <strong className="text-slate-900">P1</strong> and <strong className="text-slate-900">P2</strong> circles to draw a slanted or horizontal line. Detection triggers when the <strong className="text-emerald-700">bottom edge</strong> of a vehicle crosses this line.
          </p>
        </div>

        {/* TOP-RIGHT: FORM FOR NEW / EDIT CAMERA SETUP */}
        <div className="lg:col-span-6 bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">
              {selectedCam ? `Edit Camera (#${selectedCam.id})` : "Configure New Camera"}
            </h3>
            {selectedCam && (
              <button
                type="button"
                onClick={handleResetNewForm}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 border border-slate-200 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> New Camera
              </button>
            )}
          </div>

          <form onSubmit={handleSubmitForm} className="space-y-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Gate No</label>
                <input
                  type="text"
                  required
                  placeholder="Gate-01"
                  value={gateNo}
                  onChange={(e) => setGateNo(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Gate Name</label>
                <input
                  type="text"
                  required
                  placeholder="Main North Entry"
                  value={gateName}
                  onChange={(e) => setGateName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                RTSP URL / Video File Path / Webcam Index
              </label>
              <input
                type="text"
                required
                placeholder="rtsp://admin:pass@192.168.1.50:554/stream1 or /videos/gate1.mp4 or 0"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Gate Type</label>
                <select
                  value={gateType}
                  onChange={(e) => setGateType(e.target.value as "ENTRY" | "EXIT")}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
                >
                  <option value="ENTRY">ENTRY GATE</option>
                  <option value="EXIT">EXIT GATE</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Consecutive OCR Frames / Vehicle
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={burstFrames}
                    onChange={(e) => setBurstFrames(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:bg-white focus:outline-none focus:border-[#A62626]"
                  >
                  <option value={1}>1 Frame (Default / Fastest)</option>
                  <option value={2}>2 Consecutive Frames</option>
                  <option value={3}>3 Consecutive Frames</option>
                  <option value={4}>4 Consecutive Frames</option>
                  <option value={5}>5 Consecutive Frames (High Consensus)</option>
                  </select>
                </div>
              </div>
            </div>

            <label className="flex items-center space-x-2 pt-1 cursor-pointer text-xs font-medium text-slate-700">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="rounded accent-[#A62626]"
              />
              <span>Run background vehicle inference immediately</span>
            </label>

            <button
              type="submit"
              className="w-full py-2.5 rounded-xl bg-[#A62626] hover:bg-[#8B1E1E] text-white text-xs font-bold shadow-sm flex items-center justify-center gap-1.5 transition-colors"
            >
              <Save className="w-4 h-4" />
              {selectedCam ? "Update Camera Configuration" : "Save & Start Camera"}
            </button>
          </form>
        </div>
      </div>

      {/* BOTTOM FULL-WIDTH: CONFIGURED DEVICES LIST */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900">Configured Gate Cameras ({cameras.length})</h3>
          <span className="text-[11px] text-slate-500">
            Click any camera row to open live preview &amp; adjust tripwire
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500 bg-slate-50/70">
                <th className="py-2.5 px-3">Gate No</th>
                <th className="py-2.5 px-3">Gate Name</th>
                <th className="py-2.5 px-3">Direction</th>
                <th className="py-2.5 px-3">OCR Burst</th>
                <th className="py-2.5 px-3">Source URL / Index</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {cameras.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    No cameras configured yet. Use the form above to add an Entry or Exit camera.
                  </td>
                </tr>
              ) : (
                cameras.map((cam) => (
                  <tr
                    key={cam.id}
                    onClick={() => handleSelectCamera(cam)}
                    className={`cursor-pointer transition-colors ${
                      selectedId === cam.id ? "bg-[#FDF2F2]" : "hover:bg-slate-50/90"
                    }`}
                  >
                    <td className="py-3 px-3 font-bold text-slate-900">{cam.gate_no}</td>
                    <td className="py-3 px-3 font-medium text-slate-700">{cam.gate_name}</td>
                    <td className="py-3 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          cam.gate_type === "ENTRY"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-amber-50 text-amber-800 border border-amber-200"
                        }`}
                      >
                        {cam.gate_type}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 font-mono text-[11px] font-semibold text-slate-700">
                        <Layers className="w-3 h-3 text-[#A62626]" />
                        {cam.burst_frames ?? 1}f
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-600 max-w-xs truncate">{cam.source_url}</td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          cam.is_active
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-slate-100 text-slate-500 border border-slate-200"
                        }`}
                      >
                        {cam.is_active && <CheckCircle2 className="w-3 h-3" />}
                        {cam.is_active ? cam.status_text : "Offline"}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right space-x-2">
                      <button
                        onClick={(e) => handleToggleStream(cam.id, e)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                          cam.is_active
                            ? "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"
                            : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                        }`}
                      >
                        {cam.is_active ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                        {cam.is_active ? "Stop" : "Start"}
                      </button>
                      <button
                        onClick={(e) => handleDeleteCamera(cam.id, e)}
                        className="p-1 text-slate-400 hover:text-rose-600 transition-colors"
                      >
                        <Trash2 className="w-4 h-4 inline" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}