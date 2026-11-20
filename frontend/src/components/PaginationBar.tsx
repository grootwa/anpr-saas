import { ChevronLeft, ChevronRight } from "lucide-react"

interface PaginationBarProps {
  page: number
  totalPages: number
  totalItems: number
  pageSize: number
  onPageChange: (newPage: number) => void
  onPageSizeChange?: (newSize: number) => void
}

export default function PaginationBar({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: PaginationBarProps) {
  const startItem = totalItems === 0 ? 0 : (page - 1) * pageSize + 1
  const endItem = Math.min(page * pageSize, totalItems)

  return (
    <div className="pt-4 mt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
      <div className="flex items-center space-x-3">
        <span>
          Showing <strong className="text-slate-900">{startItem}</strong>–
          <strong className="text-slate-900">{endItem}</strong> of{" "}
          <strong className="text-slate-900">{totalItems}</strong> records
        </span>

        {onPageSizeChange && (
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-800 font-medium focus:bg-white focus:outline-none focus:border-[#A62626] transition-colors"
          >
            <option value={10}>10 / page</option>
            <option value={15}>15 / page</option>
            <option value={25}>25 / page</option>
            <option value={50}>50 / page</option>
          </select>
        )}
      </div>

      <div className="flex items-center space-x-2">
        <button
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="flex items-center px-3 py-1.5 rounded-xl bg-white hover:bg-[#FDF2F2] hover:text-[#A62626] hover:border-[#F5C6C6] disabled:opacity-40 disabled:pointer-events-none text-slate-700 font-semibold border border-slate-300 shadow-2xs transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5 mr-1" /> Prev
        </button>

        <span className="px-3.5 py-1.5 rounded-xl bg-[#FDF2F2] border border-[#F5C6C6] font-bold text-[#A62626]">
          Page {page} of {totalPages}
        </span>

        <button
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="flex items-center px-3 py-1.5 rounded-xl bg-white hover:bg-[#FDF2F2] hover:text-[#A62626] hover:border-[#F5C6C6] disabled:opacity-40 disabled:pointer-events-none text-slate-700 font-semibold border border-slate-300 shadow-2xs transition-colors"
        >
          Next <ChevronRight className="w-3.5 h-3.5 ml-1" />
        </button>
      </div>
    </div>
  )
}