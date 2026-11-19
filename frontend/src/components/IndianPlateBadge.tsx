interface IndianPlateBadgeProps {
  plate: string
  category?: string
  size?: "sm" | "lg"
}

export default function IndianPlateBadge({ plate, category = "STANDARD", size = "lg" }: IndianPlateBadgeProps) {
  const clean = (plate || "NO PLATE").toUpperCase().trim()
  const isUnreadable = !plate || clean === "NOTEXTDETECTED" || clean === "NO TEXT DETECTED"

  if (isUnreadable) {
    return (
      <span className="inline-flex items-center px-3 py-1 rounded-md bg-rose-950/70 border border-rose-500/40 font-mono font-bold text-rose-300 text-sm">
        UNREADABLE / REVIEW
      </span>
    )
  }

  // Format JH01FW4809 -> JH 01 FW 4809 for readability
  const formatted = clean.replace(/^([A-Z]{2})(\d{2})([A-Z]{1,3})(\d{1,4})$/, "$1 $2 $3 $4")

  const cat = (category || "STANDARD").toUpperCase()
  const plateBg =
    cat.includes("COMM")
      ? "bg-amber-400 text-slate-950 border-slate-900"
      : cat.includes("EV")
      ? "bg-emerald-500 text-white border-emerald-950"
      : "bg-slate-100 text-slate-950 border-slate-900"

  const isLarge = size === "lg"

  return (
    <div
      className={`inline-flex items-stretch rounded-md border-2 overflow-hidden shadow-md select-all ${plateBg} ${
        isLarge ? "h-11" : "h-7"
      }`}
    >
      {/* Blue IND Strip */}
      <div
        className={`bg-blue-700 text-white flex flex-col items-center justify-center font-bold leading-none ${
          isLarge ? "px-1.5 text-[9px]" : "px-1 text-[7px]"
        }`}
      >
        <span className="w-2 h-2 rounded-full border border-blue-200 mb-0.5 opacity-80" />
        <span>IND</span>
      </div>

      {/* Plate Characters */}
      <div
        className={`flex items-center font-mono font-extrabold tracking-wider ${
          isLarge ? "px-3.5 text-xl" : "px-2 text-xs"
        }`}
      >
        {formatted}
      </div>
    </div>
  )
}