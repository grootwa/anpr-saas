import { useState, useRef } from "react"
import { Upload, Loader2, FileImage, CheckCircle2, AlertCircle } from "lucide-react"

export default function App() {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'uploading' | 'processing' | 'success' | 'error'>('idle')
  const [result, setResult] = useState<{ plate: string; confidence: number; category?: string } | null>(null)
  
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0]
      setFile(selectedFile)
      setPreview(URL.createObjectURL(selectedFile))
      setStatus('idle')
      setResult(null)
    }
  }

  const pollStatus = async (taskId: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`http://localhost:8000/v1/status/${taskId}`)
        const data = await res.json()

        if (data.status === 'completed') {
          clearInterval(interval)
          setResult({ 
            plate: data.result.plate, 
            confidence: data.result.confidence,
            category: data.result.category
          })
          setStatus('success')
        } else if (data.status === 'failed') {
          clearInterval(interval)
          setStatus('error')
        }
      } catch (err) {
        clearInterval(interval)
        setStatus('error')
      }
    }, 1000)
  }

  const handleUpload = async () => {
    if (!file) return
    setStatus('uploading')
    
    const formData = new FormData()
    formData.append("file", file)

    try {
      const response = await fetch("http://localhost:8000/v1/snapshot", {
        method: "POST",
        body: formData,
      })
      
      if (!response.ok) throw new Error("Upload failed")
      const data = await response.json()
      
      setStatus('processing')
      pollStatus(data.task_id)
    } catch (err) {
      console.error(err)
      setStatus('error')
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans text-slate-900">
      <div className="w-full max-w-lg bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        
        <div className="p-6 border-b border-slate-100">
          <h1 className="text-xl font-semibold">ANPR Snapshot</h1>
          <p className="text-sm text-slate-500 mt-1">Upload a vehicle image for background OCR processing.</p>
        </div>
        
        <div className="p-6 space-y-6">
          <div 
            className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:bg-slate-50 transition-colors cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            {/* The "multiple" attribute is removed. It strictly accepts one file. */}
            <input type="file" className="hidden" ref={fileInputRef} accept="image/*" onChange={handleFileSelect} />
            
            {preview ? (
              <div className="relative w-full aspect-video rounded-lg overflow-hidden border border-slate-200 shadow-sm">
                <img src={preview} alt="Preview" className="object-cover w-full h-full" />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center space-y-3 text-slate-500">
                <div className="p-3 bg-slate-100 rounded-full">
                  <Upload className="w-6 h-6 text-slate-600" />
                </div>
                <p className="font-medium text-slate-700">Click to upload image</p>
                <p className="text-sm">JPG, PNG up to 5MB</p>
              </div>
            )}
          </div>

          <button 
            className={`w-full flex items-center justify-center py-3 px-4 rounded-lg font-medium text-sm transition-all ${
              !file || status === 'uploading' || status === 'processing' 
              ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
              : 'bg-slate-900 text-white hover:bg-slate-800 shadow-sm'
            }`}
            disabled={!file || status === 'uploading' || status === 'processing'}
            onClick={handleUpload}
          >
            {status === 'idle' && <><FileImage className="w-4 h-4 mr-2" /> Process Image</>}
            {status === 'uploading' && <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading...</>}
            {status === 'processing' && <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Worker Analyzing...</>}
            {status === 'success' && <><CheckCircle2 className="w-4 h-4 mr-2" /> Processed</>}
            {status === 'error' && <><AlertCircle className="w-4 h-4 mr-2" /> Error</>}
          </button>

          {status === 'success' && result && (
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between animate-pulse">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  Detected Plate {result.category && `• ${result.category}`}
                </p>
                <p className="text-2xl font-bold text-slate-900">{result.plate || "NO TEXT DETECTED"}</p>
              </div>
              <div className={`px-3 py-1 text-xs font-semibold rounded-full ${
                result.confidence > 80 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
              }`}>
                {result.confidence}% Conf
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}