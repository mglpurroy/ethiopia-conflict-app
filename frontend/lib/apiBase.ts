const configuredApiBase = (process.env.NEXT_PUBLIC_API_URL ?? '').trim();

function normalizeBase(base: string): string {
  return base.trim().replace(/\/+$/, '');
}

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = normalizeBase(configuredApiBase);

  // Default to same-origin /api calls. This works with nginx proxy in docker
  // and with Next rewrites in local dev.
  if (!base) {
    return normalizedPath;
  }

  // Support env values that already include `/api` (e.g. http://localhost/api).
  if (base.endsWith('/api') && normalizedPath.startsWith('/api/')) {
    return `${base}${normalizedPath.slice(4)}`;
  }
  return `${base}${normalizedPath}`;
}
