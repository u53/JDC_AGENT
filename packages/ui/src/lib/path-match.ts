export function isSameOrChildPath(childPath: string, parentPath: string): boolean {
  const child = normalizePath(childPath)
  const parent = normalizePath(parentPath)
  if (!child || !parent) return false
  if (child === parent) return true
  return child.startsWith(parent.endsWith('/') ? parent : `${parent}/`)
}

function normalizePath(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase()
}
