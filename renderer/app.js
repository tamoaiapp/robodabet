// ── Onboarding (1ª abertura) ─────────────────────────────────
;(async () => {
  const s = await window.settings.get()
  if (!s.acceptedTerms) {
    const modal = document.getElementById('onboarding')
    modal.hidden = false
    document.getElementById('onb-accept').onchange = (e) => {
      document.getElementById('onb-continue').disabled = !e.target.checked
    }
    document.getElementById('onb-continue').onclick = async () => {
      await window.settings.set({ acceptedTerms: true, acceptedAt: new Date().toISOString() })
      modal.hidden = true
    }
    document.getElementById('onb-close').onclick = () => window.winApi.close()
  }
})()

// ── Titlebar custom ──────────────────────────────────────────
document.getElementById('tb-min').onclick = () => window.winApi.minimize()
document.getElementById('tb-max').onclick = () => window.winApi.maximize()
document.getElementById('tb-close').onclick = () => window.winApi.close()

// ── Router simples (3 páginas) ────────────────────────────────
const $ = (s) => document.querySelector(s)
const $$ = (s) => document.querySelectorAll(s)

function go(page) {
  $$('.page').forEach((p) => (p.hidden = true))
  $('#page-' + page).hidden = false
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.page === page))
}
$$('.nav-item').forEach((b) => (b.onclick = () => go(b.dataset.page)))

// ── Log helper ────────────────────────────────────────────────
const log = $('#log')
function append(line, kind = '') {
  if (!log) return
  const div = document.createElement('div')
  div.textContent = line
  div.className = 'line ' + kind
  log.appendChild(div)
  log.scrollTop = log.scrollHeight
}
window.bot.onLog(({ line, kind }) => append(line, kind === 'err' ? 'err' : ''))

// ── Versão app ────────────────────────────────────────────────
window.appApi.info().then((info) => {
  const v = $('#version')
  if (v) v.textContent = 'v' + info.version
})

// ── DASHBOARD: métricas + lista (via bot:stats) ────────────────
function fmt(v, prefix = '') {
  if (v == null || isNaN(v)) return '—'
  return prefix + (Math.abs(v) < 100 ? v.toFixed(2) : v.toFixed(0))
}
function fmtPct(v) {
  if (v == null || isNaN(v)) return '—'
  const sign = v >= 0 ? '+' : ''
  return sign + v.toFixed(1) + '%'
}
async function loadDashboard() {
  const s = await window.bot.stats()
  if (!s.exists) {
    $('#m-roi').textContent = '—'
    return
  }
  $('#m-roi').textContent = fmtPct(s.roi)
  $('#m-roi').className = 'metric-value ' + (s.roi >= 0 ? 'gain' : 'loss')
  $('#m-wins').textContent = s.wins ?? 0
  $('#m-losses').textContent = s.losses ?? 0
  $('#m-open').textContent = s.open ?? 0
  $('#m-pnl').textContent = fmt(s.pnl, 'R$ ')
  $('#m-pnl').className = 'metric-value ' + (s.pnl >= 0 ? 'gain' : 'loss')

  // Hero
  if ($('#hero-today')) {
    $('#hero-today').textContent = fmt(s.pnlToday, 'R$ ')
    $('#hero-today').className = 'gain'
    if (s.pnlToday < 0) $('#hero-today').className = 'loss'
  }

  // Lista de apostas recentes
  const list = $('#bets-list')
  if (s.recent && s.recent.length && list) {
    list.innerHTML = s.recent.map(b => {
      const ico = b.result === 'won' ? '✓' : b.result === 'lost' ? '✗' : '⌛'
      const cls = b.result === 'won' ? 'won' : b.result === 'lost' ? 'lost' : 'open'
      const pnl = b.pnl != null ? `R$${b.pnl.toFixed(2)}` : '—'
      return `<div class="bet ${cls}">
        <div>
          <div class="match">${ico} ${b.match}</div>
          <div class="meta">${b.side} ${b.line} · R$${b.stake.toFixed(2)}</div>
        </div>
        <div class="odd">${b.odd_taken?.toFixed(2)}</div>
        <div class="status">${b.result === 'open' ? 'aberta' : pnl}</div>
        <div class="meta">${(b.kickoff_at || '').substring(11, 16)}</div>
      </div>`
    }).join('')
  }
}

$('#btn-refresh').onclick = loadDashboard

// ── CONTA ─────────────────────────────────────────────────────
$('#btn-conta-login').onclick = async () => {
  $('#conta-status').textContent = 'logando…'
  const r = await window.bot.ktoLogin()
  $('#conta-status').textContent = r.code === 0 ? 'conectado' : 'erro'
  $('#conta-last').textContent = new Date().toLocaleString('pt-BR')
}
$('#btn-conta-status').onclick = () => loadDashboard()

// ── APOSTA ───────────────────────────────────────────────────
const CFG_KEY = 'robodabet-cfg'

// Toggle PAPER/REAL
$$('.exec-btn').forEach(b => {
  b.onclick = () => {
    $$('.exec-btn').forEach(x => x.classList.remove('active'))
    b.classList.add('active')
    if (b.dataset.exec === 'real') {
      const ok = confirm('⚠️ MODO REAL\n\nO bot vai apostar com SEU DINHEIRO em cada pick.\nTem stop-loss diário (-10% bankroll) mas perdas reais ainda acontecem.\n\nConfirma?')
      if (!ok) {
        b.classList.remove('active')
        $$('.exec-btn[data-exec=paper]').forEach(x => x.classList.add('active'))
        return
      }
    }
    saveCfg()
  }
})

// Steppers (+/-)
$$('.step-btn').forEach(b => {
  b.onclick = () => {
    const inp = $('#' + b.dataset.target)
    const d = +b.dataset.delta
    const min = +(inp.min || 0)
    const max = +(inp.max || 999)
    const step = +(inp.step || 1)
    inp.value = Math.min(max, Math.max(min, +inp.value + d * step))
    inp.dispatchEvent(new Event('input', { bubbles: true }))
  }
})

// Risk slider — tag dinâmico + bloqueia ev mínimo
const riskInput = $('#cfg-risk')
const riskTag = $('#risk-tag')
const RISK_LABELS = [
  { max: 3,  label: 'Conservador', class: '' },
  { max: 6,  label: 'Equilibrado', class: 'medium' },
  { max: 10, label: 'Agressivo',   class: 'high' },
]
function updateRisk() {
  const v = +riskInput.value
  const r = RISK_LABELS.find(x => v <= x.max)
  riskTag.textContent = r.label
  riskTag.className = 'risk-tag ' + r.class
}
riskInput.addEventListener('input', updateRisk)
updateRisk()

// Casa cards (só KTO clickable)
$$('.casa-card:not(.disabled)').forEach(c => {
  c.onclick = () => {
    $$('.casa-card').forEach(x => x.classList.remove('active'))
    c.classList.add('active')
  }
})

// Mode toggle (Auto vs Manual)
$$('.mode-btn').forEach(b => {
  b.onclick = () => {
    $$('.mode-btn').forEach(x => x.classList.remove('active'))
    b.classList.add('active')
    const auto = b.dataset.mode === 'auto'
    $('#panel-auto').hidden = !auto
    $('#panel-manual').hidden = auto
  }
})

function getCfg() {
  return {
    stake: +$('#cfg-stake').value,
    max: +$('#cfg-max').value,
    risk: +$('#cfg-risk').value,
    bankroll: +$('#cfg-bankroll').value,
    mode: document.querySelector('.exec-btn.active')?.dataset.exec || 'paper',
    casa: document.querySelector('.casa-card.active')?.dataset.casa || 'kto',
    auto: document.querySelector('.mode-btn.active')?.dataset.mode || 'auto',
    mercados: [...document.querySelectorAll('[data-mkt]:checked')].map(i => i.dataset.mkt),
    ligas: [...document.querySelectorAll('[data-lg]:checked')].map(i => i.dataset.lg),
  }
}
function saveCfg() {
  const cfg = getCfg()
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg))
  // Sincroniza com main process (que usa pra spawn dos scripts)
  if (window.settings) window.settings.set(cfg).catch(() => {})
  return cfg
}
function loadCfg() {
  try {
    const cfg = JSON.parse(localStorage.getItem(CFG_KEY) || '{}')
    if (cfg.stake) $('#cfg-stake').value = cfg.stake
    if (cfg.max) $('#cfg-max').value = cfg.max
    if (cfg.bankroll) $('#cfg-bankroll').value = cfg.bankroll
    if (cfg.risk) { $('#cfg-risk').value = cfg.risk; updateRisk() }
    if (cfg.mode) {
      $$('.exec-btn').forEach(b => b.classList.toggle('active', b.dataset.exec === cfg.mode))
    }
    if (cfg.auto) {
      $$('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === cfg.auto))
      $('#panel-auto').hidden = cfg.auto !== 'auto'
      $('#panel-manual').hidden = cfg.auto === 'auto'
    }
    if (cfg.mercados) document.querySelectorAll('[data-mkt]').forEach(i => i.checked = cfg.mercados.includes(i.dataset.mkt))
    if (cfg.ligas) document.querySelectorAll('[data-lg]').forEach(i => i.checked = cfg.ligas.includes(i.dataset.lg))
  } catch {}
}
loadCfg()

$('#btn-cfg-save').onclick = () => {
  saveCfg()
  append('✓ Configuração salva.', 'ok')
}

$('#btn-cfg-disparar').onclick = async () => {
  const cfg = saveCfg()
  const msg = `Vai apostar ${cfg.max}× R$${cfg.stake} no ${cfg.casa.toUpperCase()} (${cfg.mode}). Total R$${cfg.max * cfg.stake}. Confirma?`
  if (!confirm(msg)) return
  append(`── Disparando batch (${cfg.max}× R$${cfg.stake}) ──`)
  const sel = await window.bot.select()
  append(`Select: exit ${sel.code}`, sel.code === 0 ? 'ok' : 'err')
  if (sel.code !== 0) return
  const r = await window.bot.place()
  append(`Place: exit ${r.code}`, r.code === 0 ? 'ok' : 'err')
  loadDashboard()
}

// ── TamoIA chat ──────────────────────────────────────────────
const tamoModal = document.getElementById('tamoai-modal')
const tamoBody = document.getElementById('tamoai-body')
const tamoInput = document.getElementById('tamoai-input')
const tamoHistory = []

function tamoMsg(role, content) {
  const div = document.createElement('div')
  div.className = 'tamoai-msg ' + (role === 'user' ? 'user' : 'bot')
  div.innerHTML = content.replace(/\n/g, '<br>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  tamoBody.appendChild(div)
  tamoBody.scrollTop = tamoBody.scrollHeight
}

document.getElementById('tamoai-open').onclick = () => {
  tamoModal.hidden = false
  if (tamoHistory.length === 0) {
    tamoMsg('bot', '👋 Sou a **TamoIA**. Posso te ajudar a entender o bot, configurar risco, interpretar resultados, ou resolver bugs.\n\nPergunta aí.')
  }
  tamoInput.focus()
}
document.getElementById('tamoai-close').onclick = () => { tamoModal.hidden = true }

document.getElementById('tamoai-form').onsubmit = async (e) => {
  e.preventDefault()
  const text = tamoInput.value.trim()
  if (!text) return
  tamoInput.value = ''
  tamoMsg('user', text)
  tamoHistory.push({ role: 'user', content: text })
  const thinking = document.createElement('div')
  thinking.className = 'tamoai-msg bot'
  thinking.textContent = '...'
  tamoBody.appendChild(thinking)
  try {
    const r = await window.support.chat(tamoHistory)
    thinking.remove()
    tamoMsg('bot', r.content || '(sem resposta)')
    tamoHistory.push({ role: 'assistant', content: r.content })
  } catch (err) {
    thinking.remove()
    tamoMsg('bot', '❌ Erro: ' + err.message)
  }
}

// ── Power switch + Bot state ─────────────────────────────────
const powerBtn = document.getElementById('power-btn')
const powerLabel = document.getElementById('power-label')
const powerSub = document.getElementById('power-sub')
const infoLast = document.getElementById('info-last')
const infoPicks = document.getElementById('info-picks')
const infoNext = document.getElementById('info-next')

function fmtAgo(ts) {
  if (!ts) return '—'
  const ago = Math.floor((Date.now() - ts) / 60000)
  if (ago < 1) return 'agora'
  if (ago < 60) return ago + ' min atrás'
  const h = Math.floor(ago / 60)
  return h + 'h atrás'
}
function fmtIn(ts) {
  if (!ts) return '—'
  const ms = ts - Date.now()
  if (ms < 0) return 'em breve'
  const min = Math.floor(ms / 60000)
  if (min < 60) return 'em ' + min + ' min'
  return 'em ' + Math.floor(min / 60) + 'h ' + (min % 60) + 'm'
}
function applyState(s) {
  if (!s) return
  powerBtn.dataset.state = s.running ? 'on' : 'off'
  powerLabel.textContent = s.running ? (s.cycleInProgress ? 'EM CICLO' : 'LIGADO') : 'DESLIGADO'
  powerSub.textContent = s.running ? 'robô apostando sozinho' : 'clique pra ligar o robô'
  infoLast.textContent = fmtAgo(s.lastPlace || s.lastSelect)
  infoPicks.textContent = s.picksToday || 0
  const nextMs = (s.lastSelect || Date.now()) + 2 * 60 * 60 * 1000
  infoNext.textContent = s.running ? fmtIn(nextMs) : '—'
}

powerBtn.onclick = async () => {
  const on = powerBtn.dataset.state === 'on'
  if (on) {
    if (!confirm('Desligar o robô? Ele para de operar e não vai mais apostar até você ligar de novo.')) return
    await window.bot.stop()
  } else {
    if (!confirm('Ligar o robô?\n\nEle vai entrar em ciclo automático:\n• A cada 2h: seleciona picks + aposta\n• A cada 30min: captura odd de fechamento\n• A cada 4h: settle das apostas concluídas\n\nFunciona com seu Chrome aberto + KTO logado.')) return
    await window.bot.start()
  }
}

// Estado inicial + atualização contínua
window.bot.getState().then(applyState)
window.bot.onState(applyState)
setInterval(() => window.bot.getState().then(applyState), 30000)

// Toast de notificação
window.bot.onNotify(({ title, body }) => {
  const stack = document.getElementById('toast-stack')
  const div = document.createElement('div')
  div.className = 'toast'
  div.innerHTML = `<strong>${title}</strong>${body}`
  stack.appendChild(div)
  setTimeout(() => div.remove(), 6000)
  // Reload dashboard se foi uma aposta/settle
  if (/aposta|vit|perda/i.test(title + ' ' + body)) loadDashboard().catch(() => {})
})

// ── Inicialização ─────────────────────────────────────────────
loadDashboard().catch(() => {})
