export function getPageCount(totalItems: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalItems / pageSize));
}

export function clampPageIndex(page: number, totalItems: number, pageSize: number): number {
  const maxPage = getPageCount(totalItems, pageSize) - 1;
  return Math.max(0, Math.min(maxPage, page));
}

export function slicePageItems<T>(items: readonly T[], page: number, pageSize: number): readonly T[] {
  const clampedPage = clampPageIndex(page, items.length, pageSize);
  return items.slice(clampedPage * pageSize, (clampedPage + 1) * pageSize);
}
