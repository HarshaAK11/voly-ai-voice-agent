import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy REST API calls to Express backend
      '/token': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/debug': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/refresh-slots': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      // Proxy Socket.IO WebSocket connections to Express backend
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})

