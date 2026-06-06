/**
 * Cliente do bridge HTTP de suporte (VPS iaempresa.app).
 * Coleta contexto do bot (versão, settings, últimas N apostas)
 * e manda pra TamoIA Suporte (Claude Code rodando no VPS).
 */
import { readFileSync, existsSync } from 'fs'
import path from 'path'
import os from 'os'

const DEFAULT_URL = 'http://76.13.125.78:8901/support'
const DEFAULT_NOTIFY_URL = 'http://76.13.125.78:8901/notify'
const DEFAULT_TOKEN = 'a2eBwScxoKbr6Ilni1XxAfMF1iejQR1WAXMH99JL'
const TIMEOUT_MS = 90_000

function readAppVersion(appDir) {
  try {
    const pkg = JSON.parse(readFileSync(path.join(appDir, 'package.json'), 'utf-8'))
    return pkg.version || 'unknown'
  } catch { return 'unknown' }
}

function readConfig(dataDir) {
  try {
    const file = path.join(dataDir, 'config.json')
    if (!existsSync(file)) return {}
    return JSON.parse(readFileSync(file, 'utf-8'))
  } catch { return {} }
}

function readStats(dataDir) {
  try {
    const dbPath = path.join(dataDir, 'bot.db')
    if (!existsSync(dbPath)) return null
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(dbPath)
    const sum = db.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN result='won' THEN 1 ELSE 0 END) wins,
      SUM(CASE WHEN result='lost' THEN 1 ELSE 0 END) losses,
      SUM(CASE WHEN result='open' THEN 1 ELSE 0 END) open_,
      SUM(CASE WHEN result IN ('won','lost') THEN stake ELSE 0 END) stake_settled,
      COALESCE(SUM(pnl), 0) pnl
      FROM bet_clv WHERE market='corners'`).get()
    const recent = db.prepare(`SELECT match, side, line, odd_taken, stake, result, pnl, taken_at
      FROM bet_clv WHERE market='corners' ORDER BY taken_at DESC LIMIT 10`).all()
    db.close()
    return { ...sum, roi: sum.stake_settled > 0 ? sum.pnl / sum.stake_settled * 100 : null, recent }
  } catch { return null }
}

function buildContext({ appDir, dataDir, recentLogs, appUptime }) {
  return {
    appInfo: {
      name: 'Robô da Bet',
      version: readAppVersion(appDir),
      os: `${os.type()} ${os.release()}`,
      platform: os.platform(),
      totalMemoryMB: Math.round(os.totalmem() / 1e6),
      appUptime: appUptime,
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron,
    },
    config: readConfig(dataDir),
    botStats: readStats(dataDir),
    recentLogs: Array.isArray(recentLogs) ? recentLogs.slice(-100) : [],
  }
}

export async function chatWithSupport({ messages, appDir, dataDir, recentLogs, appUptime }) {
  const url = (process.env.SUPPORT_BRIDGE_URL || DEFAULT_URL).trim()
  const token = (process.env.SUPPORT_BRIDGE_TOKEN || DEFAULT_TOKEN).trim()
  const ctx = buildContext({ appDir, dataDir, recentLogs, appUptime })
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages, context: ctx, product: 'robodabet' }),
      signal: ctl.signal,
    })
    clearTimeout(t)
    if (!res.ok) {
      const errText = (await res.text()).slice(0, 200)
      throw new Error(`bridge_${res.status}: ${errText}`)
    }
    return await res.json()
  } catch (e) {
    clearTimeout(t)
    return {
      role: 'assistant',
      content: `Tô sem conseguir falar com o time agora (${e.message?.slice(0, 80) || 'erro'}).\n\nSe for urgente, manda WhatsApp pra **+55 11 96724-5795** que respondemos direto.`,
      error: true,
    }
  }
}

export async function registerError({ kind, summary, context = {} }) {
  const url = (process.env.SUPPORT_NOTIFY_URL || DEFAULT_NOTIFY_URL).trim()
  const token = (process.env.SUPPORT_BRIDGE_TOKEN || DEFAULT_TOKEN).trim()
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 15_000)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind, summary, context, product: 'robodabet' }),
      signal: ctl.signal,
    })
    clearTimeout(t)
    return await res.json()
  } catch (e) {
    return { error: e?.message || String(e), skipped: true }
  }
}
