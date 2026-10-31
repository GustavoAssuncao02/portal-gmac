import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import devNetworkPlugin from './scripts/dev-network.mjs'
import interfaceVersionPlugin from './scripts/interface-version.mjs'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'PORT')
  const apiPort = Number(process.env.PORT || env.PORT || 3002)
  return {
    plugins: [react(), devNetworkPlugin(), interfaceVersionPlugin()],
    build: {
      rollupOptions: {
        output: {
          // Libraries change far less often than the portal itself; in their own files they stay in the browser cache across deploys.
          manualChunks(id) {
            if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id) || id.includes('commonjsHelpers')) return 'react'
            if (id.includes('node_modules')) return 'interface'
          },
        },
      },
    },
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
