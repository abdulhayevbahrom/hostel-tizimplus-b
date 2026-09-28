const normalizeOrigin = (value) => String(value || '').trim().replace(/\/$/, '')

export const allowedOrigins = (process.env.FRONTEND_URL)
  .split(',')
  .map(normalizeOrigin)
  .filter(Boolean)

const allowedOriginSet = new Set(allowedOrigins)

// Requests without Origin are kept for health checks and trusted server-to-server
// clients. Browser frontends always send Origin for cross-origin API requests.
export const isAllowedOrigin = (origin) => !origin || allowedOriginSet.has(normalizeOrigin(origin))
