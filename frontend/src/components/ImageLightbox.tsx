import { X } from "lucide-react"
import IndianPlateBadge from "./IndianPlateBadge"

interface ImageLightboxProps {
  imageUrl: string | null
  plateNumber?: string
  category?: string
  onClose: () => void
}

export default function ImageLightbox({ imageUrl, plateNumber, category, onClose }: ImageLightboxProps) {
  if (!imageUrl) return null

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-900 border border-slate-700 rounded-2xl max-w-3xl w-full overflow-hidden shadow-2xl"
      >
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {plateNumber && <IndianPlateBadge plate={plateNumber} category={category} size="sm" />}
            <span className="text-xs text-slate-400">Captured Frame Inspection</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-slate-950 flex items-center justify-center max-h-[75vh] overflow-hidden">
          <img src={imageUrl} alt={plateNumber || "Vehicle Capture"} className="max-h-[75vh] w-auto object-contain" />
        </div>
      </div>
    </div>
  )
}