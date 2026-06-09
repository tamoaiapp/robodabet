// Kambi API wrapper — fetch direto, sem Playwright/Chrome.
// KTO usa motor Kambi (mesma engine de Unibet, LeoVegas, etc).
// Endpoints públicos, mesma fonte que o site do KTO consome internamente.

const BASE = 'https://us.offering-api.kambicdn.com/offering/v2018/ktobr'
const HEADERS = {
  Accept: 'application/json',
  Origin: 'https://www.kto.bet.br',
  Referer: 'https://www.kto.bet.br/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
}

async function kambiFetch(path, { timeout = 10000 } = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`
  const ctl = AbortSignal.timeout(timeout)
  const r = await fetch(url, { headers: HEADERS, signal: ctl })
  if (!r.ok) throw new Error(`kambi_${r.status}: ${url}`)
  return r.json()
}

// Lista de jogos pre-game (todos esportes / só futebol)
export async function listFootballEvents() {
  const data = await kambiFetch('/listView/football.json?lang=pt_BR&market=BR&client_id=200&channel_id=1&useCombined=true&useCombinedLive=true')
  const events = data.events ?? []
  return events.filter(w => w.event?.state !== 'STARTED' && w.event?.tags?.includes('MATCH'))
}

// Detalhes de UM jogo: mercados + outcomes + odds
export async function getEventBetOffers(evtId) {
  const data = await kambiFetch(`/betoffer/event/${evtId}.json?lang=pt_BR&market=BR&client_id=200&channel_id=1&includeParticipants=true`)
  return data.betOffers ?? []
}

// Helper: extrai outcomes de "Total de escanteios" de UM jogo
export async function getCornerOutcomes(evtId) {
  const offers = await getEventBetOffers(evtId)
  const outcomes = []
  for (const o of offers) {
    if (!/^\s*(total de escanteios|total corners)\s*$/i.test(o.criterion?.label ?? '') &&
        !/^\s*total corners\s*$/i.test(o.criterion?.englishLabel ?? '')) continue
    for (const out of o.outcomes ?? []) {
      const isOver = out.type === 'OT_OVER' || /mais|over/i.test(out.label)
      const isUnder = out.type === 'OT_UNDER' || /menos|under/i.test(out.label)
      outcomes.push({
        side: isOver ? 'OVER' : isUnder ? 'UNDER' : null,
        line: out.line / 1000,
        odd: out.odds / 1000,
        outcomeId: out.id,
      })
    }
  }
  return outcomes
}

// Helper: outcomes de "Total de gols" (Mais/Menos 2.5 etc) de UM jogo
export async function getGoalOutcomes(evtId) {
  const offers = await getEventBetOffers(evtId)
  const outcomes = []
  for (const o of offers) {
    const lbl = (o.criterion?.label ?? '').toLowerCase()
    const elbl = (o.criterion?.englishLabel ?? '').toLowerCase()
    // "Total de gols" (BR) / "Total goals" (EN). Excluir totais por equipe ou por tempo.
    const isGoalTotal = (/^total de gols$/.test(lbl) || /^total goals$/.test(elbl)) ||
      (/total.*gols/.test(lbl) && !/casa|fora|tempo|primeiro|segundo/.test(lbl))
    if (!isGoalTotal) continue
    for (const out of o.outcomes ?? []) {
      const isOver = out.type === 'OT_OVER' || /mais|over/i.test(out.label)
      const isUnder = out.type === 'OT_UNDER' || /menos|under/i.test(out.label)
      outcomes.push({
        side: isOver ? 'OVER' : isUnder ? 'UNDER' : null,
        line: out.line / 1000,
        odd: out.odds / 1000,
        outcomeId: out.id,
      })
    }
  }
  return outcomes
}

// Helper: outcomes de "Resultado" (1X2) — vencedor do jogo
export async function getMatchOutcomes(evtId) {
  const offers = await getEventBetOffers(evtId)
  const outcomes = []
  for (const o of offers) {
    const lbl = (o.criterion?.label ?? '').toLowerCase()
    const elbl = (o.criterion?.englishLabel ?? '').toLowerCase()
    const isMatchResult = /^resultado(\s+do\s+jogo)?$/.test(lbl) || /^match.+result$/.test(elbl) || /^moneyline$/.test(elbl)
    if (!isMatchResult) continue
    for (const out of o.outcomes ?? []) {
      let pick = null
      if (out.type === 'OT_ONE' || /casa|home/i.test(out.label)) pick = 'HOME'
      else if (out.type === 'OT_CROSS' || /empate|draw/i.test(out.label)) pick = 'DRAW'
      else if (out.type === 'OT_TWO' || /fora|away/i.test(out.label)) pick = 'AWAY'
      if (!pick) continue
      outcomes.push({ side: pick, odd: out.odds / 1000, outcomeId: out.id })
    }
  }
  return outcomes
}
