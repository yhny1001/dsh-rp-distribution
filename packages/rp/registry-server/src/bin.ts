#!/usr/bin/env node
/** Standalone entry point for the MIT reference RP Registry server. */

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import {
  createRpRegistryNodeHandler,
  RpReferenceRegistry,
  type RpRegistryPublisherKey,
} from './index.ts'

const origin = new URL(process.env.DSH_RP_REGISTRY_ORIGIN ?? 'http://127.0.0.1:3090')
const root = resolve(process.env.DSH_RP_REGISTRY_ROOT ?? 'data/rp-registry')
const publisherKeys = await loadPublisherKeys(process.env.DSH_RP_REGISTRY_KEYS)
const registry = new RpReferenceRegistry({ root, publicOrigin: origin.origin, publisherKeys })
await registry.initialize()
const publishToken = process.env.DSH_RP_REGISTRY_PUBLISH_TOKEN

const server = createServer(createRpRegistryNodeHandler(registry, {
  ...(publishToken === undefined || publishToken === ''
    ? {}
    : { publishToken }),
}))
const listenHost = process.env.DSH_RP_REGISTRY_LISTEN_HOST ?? '127.0.0.1'
const listenPort = portNumber(process.env.DSH_RP_REGISTRY_LISTEN_PORT ?? (
  origin.hostname === '127.0.0.1' || origin.hostname === 'localhost'
    ? origin.port || '3090'
    : '3090'
))
server.listen(listenPort, listenHost, () => {
  process.stdout.write(`DSH RP Registry listening on ${listenHost}:${listenPort}; public origin ${origin.origin}; root ${root}\n`)
  if (publishToken === undefined || publishToken === '') {
    process.stdout.write('DSH RP Registry mutations are disabled; set DSH_RP_REGISTRY_PUBLISH_TOKEN to enable them.\n')
  }
})

function portNumber(value: string): number {
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('DSH_RP_REGISTRY_LISTEN_PORT must be an integer from 1 through 65535')
  }
  return port
}

async function loadPublisherKeys(path: string | undefined): Promise<readonly RpRegistryPublisherKey[]> {
  if (path === undefined) return []
  const value: unknown = JSON.parse(await readFile(resolve(path), 'utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('DSH_RP_REGISTRY_KEYS must name a JSON object mapping key ids to PEM public keys')
  }
  return Object.entries(value).map(([keyId, publicKey]) => {
    if (typeof publicKey !== 'string') throw new Error(`Publisher key ${keyId} must be PEM text`)
    return Object.freeze({ keyId, publicKey })
  })
}
