import { useEffect } from "react"
import { X, Maximize2 } from "lucide-react"
import IndianPlateBadge from "./IndianPlateBadge"

interface ImageLightboxProps {
  imageUrl: string | null
  plateNumber?: string
  category?: string
  onClose: () => void
}

export default function ImageLightbox({ imageUrl, plateNumber, category, onClose }: ImageLightboxProps) {
  useEffect(() => {
    if (!imageUrl) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [imageUrl, onClose])

  if (!imageUrl) return null

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-slate-900/65 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white border border-slate-200 rounded-2xl max-w-3xl w-full overflow-hidden shadow-2xl"
      >
        <div className="h-1 w-full bg-gradient-to-r from-[#A62626] via-[#F59E1B] to-[#8F1D36]" />

        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {plateNumber ? (
              <IndianPlateBadge plate={plateNumber} category={category} size="sm" />
            ) : (
              <div className="p-1.5 rounded-lg bg-[#FDF2F2] text-[#A62626] border border-[#F5C6C6]">
                <Maximize2 className="w-3.5 h-3.5" />
              </div>
            )}
            <span className="text-xs font-semibold text-slate-600">Captured Frame Inspection</span>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-white hover:bg-[#FDF2F2] text-slate-600 hover:text-[#A62626] border border-slate-200 hover:border-[#F5C6C6] transition-colors"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-slate-950 flex items-center justify-center max-h-[75vh] overflow-hidden">
          <img
            src={imageUrl}
            alt={plateNumber || "Vehicle Capture"}
            className="max-h-[75vh] w-auto object-contain"
          />
        </div>
      </div>
    </div>
  )
}