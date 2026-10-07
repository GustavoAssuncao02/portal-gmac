import { networkInterfaces } from 'node:os'

export function networkUrls(port, interfaces = networkInterfaces()) {
  const addresses = Object.values(interfaces).flat().filter((entry) =>
    entry && !entry.internal && (entry.family === 'IPv4' || entry.family === 4),
  ).map((entry) => entry.address)
  return [...new Set(addresses)].map((address) => `http://${address}:${port}`)
}

export default function devNetworkPlugin() {
  return {
    name: 'gmac-dev-network',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const address = server.httpServer.address()
        if (!address || typeof address === 'string') return
        const urls = networkUrls(address.port)
        server.config.logger.info([
          '',
          'PORTAL GMAC - acesso ao sistema',
          `  Neste computador: http://localhost:${address.port}`,
          ...urls.map((url) => `  Na rede local:    ${url}`),
          ...(urls.length ? ['  Use o endereco da rede nos computadores conectados ao mesmo Wi-Fi.'] :
            ['  Nenhum IP de rede local detectado. Confira sua conexao Wi-Fi ou Ethernet.']),
          '',
        ].join('\n'))
      })
    },
  }
}
