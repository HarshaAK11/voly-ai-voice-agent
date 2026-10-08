/**
 * Backend URL configuration.
 * - In dev:        empty → Vite proxy handles all /socket.io and /token calls to localhost:5000
 * - In production: set VITE_BACKEND_URL in Vercel dashboard to your Railway URL
 *                  e.g. https://your-backend.railway.app
 */
export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || ''
