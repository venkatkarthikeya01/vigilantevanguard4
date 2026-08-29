import axios from 'axios'
import { useAuthStore } from '@/store/auth'

// Always use a relative base URL so the Vite dev-server proxy (port 3000 → 8000)
// handles the request. An absolute URL like http://localhost:8000 causes network
// errors when the browser security model blocks cross-origin requests, or when
// VITE_API_URL is not set in the .env file.
const BASE_URL = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL           // explicit override (e.g. production)
  : '/api/v1'                               // relative — always works via Vite proxy

export const apiClient = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

// Attach Catalyst Auth token to every request
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Auto-logout on 401 — only for auth endpoints, not general API failures
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const url: string = error.config?.url || ''
      // Only force logout if it's an auth/session check, not a feature endpoint
      const isAuthEndpoint = url.includes('/auth/') || url.includes('/auth/me')
      if (isAuthEndpoint) {
        useAuthStore.getState().logout()
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)
