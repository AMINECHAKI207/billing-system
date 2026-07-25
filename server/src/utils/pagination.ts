/**
 * Pagination Utilities
 *
 * Parses and validates page/limit query parameters.
 * Returns safe, bounded values to pass to Prisma's skip/take.
 */

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
}

export interface PaginationQuery {
  page?: string | number;
  limit?: string | number;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

/**
 * Parse pagination query params into safe numeric values.
 *
 * Usage:
 *   const { page, limit, skip } = parsePagination(req.query);
 *   const items = await prisma.customer.findMany({ skip, take: limit });
 */
export function parsePagination(query: PaginationQuery): PaginationParams {
  const page = Math.max(1, parseInt(String(query.page ?? DEFAULT_PAGE), 10) || DEFAULT_PAGE);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(String(query.limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
  );
  const skip = (page - 1) * limit;

  return { page, limit, skip };
}

/**
 * Parse sort parameters from query string.
 *
 * Usage:
 *   ?sortBy=createdAt&sortOrder=desc
 */
export interface SortParams {
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

export function parseSort(
  query: { sortBy?: string; sortOrder?: string },
  allowedFields: string[],
  defaultField = 'createdAt'
): SortParams {
  const sortBy = allowedFields.includes(query.sortBy ?? '') ? query.sortBy! : defaultField;
  const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';
  return { sortBy, sortOrder };
}
