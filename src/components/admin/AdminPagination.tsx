export function AdminPagination({
  page,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const first = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, totalCount);

  return (
    <div className="flex flex-col gap-3 border-t border-gray-100 px-4 py-4 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400 sm:flex-row sm:items-center sm:justify-between">
      <span>{first}–{last} of {totalCount}</span>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          Rows
          <select
            aria-label="Rows per page"
            value={pageSize}
            onChange={event => onPageSizeChange(Number(event.target.value))}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-gray-700 dark:border-gray-700 dark:bg-surface-dark dark:text-gray-200"
          >
            {[10, 25, 50].map(size => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="rounded-lg border border-gray-200 px-3 py-1.5 font-medium text-gray-700 disabled:opacity-40 dark:border-gray-700 dark:text-gray-200"
        >
          Previous
        </button>
        <span className="min-w-20 text-center">{page} / {totalPages}</span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="rounded-lg border border-gray-200 px-3 py-1.5 font-medium text-gray-700 disabled:opacity-40 dark:border-gray-700 dark:text-gray-200"
        >
          Next
        </button>
      </div>
    </div>
  );
}
