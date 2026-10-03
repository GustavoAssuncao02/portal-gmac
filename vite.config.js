import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3002',
        configure(proxy) {
          proxy.on('proxyReq', (proxyRequest, request) => {
            // Replace client-supplied forwarding headers with the real LAN address.
            proxyRequest.setHeader('X-Forwarded-For', request.socket.remoteAddress)
          })
        },
      },
    },
  },
})
