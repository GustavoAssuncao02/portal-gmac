import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import devNetworkPlugin from './scripts/dev-network.mjs'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'PORT')
  const apiPort = Number(process.env.PORT || env.PORT || 3002)
  return {
    plugins: [react(), devNetworkPlugin()],
    server: {
      host: '0.0.0.0',
      port: 5174,
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${apiPort}`,
          configure(proxy) {
            proxy.on('proxyReq', (proxyRequest, request) => {
              // Replace client-supplied forwarding headers with the real LAN address.
              proxyRequest.setHeader('X-Forwarded-For', request.socket.remoteAddress)
            })
          },
        },
      },
    },
  }
})
