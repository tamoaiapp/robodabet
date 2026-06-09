// Federated learning client: troca calibrações com VPS.
//
// Envia apostas settled (sem identificar usuário) e baixa o JSON
// agregado com λ por liga e blacklist global.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const VPS_BASE = process.env.BRIDGE_URL?.replace(/\/+$/, '') || 'http://76.13.125.78:8901'
const TOKEN = process.env.BRIDGE_TOKEN || 'a2eBwScxoKbr6Ilni1XxAfMF1iejQR1WAXMH99JL'
const DATA_DIR = process.env.BOT_DATA_DIR || 'data'

const NET_CACHE = join(DATA_DIR, 'network-calibrations.json')
const SENT_TRACKER = join(DATA_DIR, 'federated-sent.json')

function loadSent() {
  if (!existsSync(SENT_TRACKER)) return new Set()
  try { return new Set(JSON.parse(readFileSync(SENT_TRACKER, 'utf8'))) } catch { return new Set() }
}
function saveSent(set) {
  try { writeFileSync(SENT_TRACKER, JSON.stringify([...set].slice(-2000))) } catch {}
}

function makeKey(item) {
  return `${item.evt_id || ''}|${item.market || 'corners'}|${item.side || ''}|${item.line || ''}`
}

/**
 * Envia batch de apostas settled pra rede. Idempotente — usa tracker
 * local pra não reenviar a mesma aposta.
 *
 * @param {Array<{evt_id, league, market, side, line, odd, result}>} items
 */
export async function submitToFederated(items) {
  if (!Array.isArray(items) || !items.length) return { sent: 0 }
  const sent = loadSent()
  const fresh = items.filter(i => {
    const k = makeKey(i)
    if (sent.has(k)) return false
    return ['won', 'lost', 'void'].includes(i.result)
  })
  if (!fresh.length) return { sent: 0, skipped: items.length }

  try {
    const r = await fetch(`${VPS_BASE}/robodabet/learn`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ items: fresh.slice(0, 500) }),
      signal: AbortSignal.timeout(15000),
    })
    if (!r.ok) {
      console.log(`[federated] submit ${r.status}`)
      return { sent: 0, error: `http_${r.status}` }
    }
    const data = await r.json()
    for (const i of fresh) sent.add(makeKey(i))
    saveSent(sent)
    console.log(`[federated] enviou ${data.added}/${fresh.length} apostas pra rede`)
    return { sent: data.added, skipped: data.skipped }
  } catch (e) {
    console.log(`[federated] submit erro: ${e.message}`)
    return { sent: 0, error: e.message }
  }
}

/**
 * Baixa calibrações agregadas da rede. Cache local 6h em network-calibrations.json.
 */
export async function fetchFederatedCalibrations({ force = false } = {}) {
  // Cache 6h
  if (!force && existsSync(NET_CACHE)) {
    try {
      const data = JSON.parse(readFileSync(NET_CACHE, 'utf8'))
      const age = Date.now() - new Date(data.fetched_at || 0).getTime()
      if (age < 6 * 3600 * 1000) return data
    } catch {}
  }

  try {
    const r = await fetch(`${VPS_BASE}/robodabet/calibrations`, {
      signal: AbortSignal.timeout(10000),
    })
    if (!r.ok) return loadCachedCalibrations()
    const data = await r.json()
    data.fetched_at = new Date().toISOString()
    try { writeFileSync(NET_CACHE, JSON.stringify(data, null, 2)) } catch {}
    return data
  } catch (e) {
    console.log(`[federated] fetch erro: ${e.message}`)
    return loadCachedCalibrations()
  }
}

export function loadCachedCalibrations() {
  if (!existsSync(NET_CACHE)) return { leagues: {}, n_total: 0 }
  try { return JSON.parse(readFileSync(NET_CACHE, 'utf8')) } catch { return { leagues: {}, n_total: 0 } }
}
