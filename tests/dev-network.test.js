import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import devNetworkPlugin, { networkUrls } from '../scripts/dev-network.mjs'

test('LAN URLs use external IPv4 addresses, without duplicates or loopback', () => {
  assert.deepEqual(networkUrls(5174, {
    loopback: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    wifi: [
      { family: 'IPv4', address: '192.168.1.50', internal: false },
      { family: 'IPv6', address: 'fe80::123', internal: false },
    ],
    ethernet: [{ family: 4, address: '10.0.0.5', internal: false }],
    duplicate: [{ family: 'IPv4', address: '192.168.1.50', internal: false }],
    disconnected: undefined,
  }), ['http://192.168.1.50:5174', 'http://10.0.0.5:5174'])
  assert.deepEqual(networkUrls(5174, {}), [])
})

test('startup banner prints once after listening and uses the actual frontend port', () => {
  const httpServer = new EventEmitter()
  httpServer.address = () => ({ port: 55174 })
  const messages = []
  const plugin = devNetworkPlugin()
  assert.equal(plugin.apply, 'serve')
  plugin.configureServer({ httpServer, config: { logger: { info: (message) => messages.push(message) } } })
  assert.equal(messages.length, 0)
  httpServer.emit('listening')
  httpServer.emit('listening')
  assert.equal(messages.length, 1)
  assert.match(messages[0], /http:\/\/localhost:55174/)
  assert.match(messages[0], /PORTAL GMAC/)
})
