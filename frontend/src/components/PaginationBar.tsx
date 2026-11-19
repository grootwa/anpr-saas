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
  onPageSizeChange
}: PaginationBarProps) {
  const startItem = totalItems === 0 ? 0 : (page - 1) * pageSize + 1
  const endItem = Math.min(page * pageSize, totalItems)

  return (
    <div className="pt-4 mt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
      <div className="flex items-center space-x-3">
        <span>
          Showing <strong className="text-slate-200">{startItem}</strong>–
          <strong className="text-slate-200">{endItem}</strong> of{" "}
          <strong className="text-slate-200">{totalItems}</strong> records
        </span>

        {onPageSizeChange && (
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="px-2 py-1 bg-slate-950 border border-slate-700 rounded text-slate-200 focus:outline-none"
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
          className="flex items-center px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none text-slate-200 border border-slate-700"
        >
          <ChevronLeft className="w-3.5 h-3.5 mr-1" /> Prev
        </button>

        <span className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 font-medium text-slate-200">
          Page {page} of {totalPages}
        </span>

        <button
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="flex items-center px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none text-slate-200 border border-slate-700"
        >
          Next <ChevronRight className="w-3.5 h-3.5 ml-1" />
        </button>
      </div>
    </div>
  )
}