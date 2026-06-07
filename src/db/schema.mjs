// Schema do CLV tracking — cria tabela bet_clv se não existir
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const DATA_DIR = process.env.BOT_DATA_DIR || 'data';
const db = new DatabaseSync(join(DATA_DIR, 'bot.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS bet_clv (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evt_id INTEGER NOT NULL,
  match TEXT NOT NULL,
  league TEXT,
  market TEXT NOT NULL,         -- 'corners', 'goals', '1x2', etc
  side TEXT NOT NULL,            -- 'OVER'/'UNDER'/'HOME'/'DRAW'/'AWAY'
  line REAL,                     -- 8.5, 9.5, etc (null pra 1X2)
  outcome_id TEXT,               -- ID Kambi do outcome
  stake REAL NOT NULL,
  odd_taken REAL NOT NULL,
  prob_real REAL,                -- prob estimada pelo nosso modelo
  ev_pct_estimated REAL,         -- EV estimado no momento
  taken_at TEXT NOT NULL,        -- ISO timestamp
  kickoff_at TEXT,
  odd_closing REAL,              -- preenchido por snapshot-closing T-5min
  closing_captured_at TEXT,
  clv_pct REAL,                  -- (odd_closing - odd_taken) / odd_taken * 100
  result TEXT DEFAULT 'open',    -- 'open'/'won'/'lost'/'push'/'void'
  pnl REAL,
  settled_at TEXT,
  cupom_id TEXT,                 -- ID Cupom KTO (pra reconciliação)
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_bet_clv_evt ON bet_clv(evt_id);
CREATE INDEX IF NOT EXISTS idx_bet_clv_result ON bet_clv(result);
CREATE INDEX IF NOT EXISTS idx_bet_clv_kickoff ON bet_clv(kickoff_at);
`);

console.log('Schema bet_clv pronto.');

// Mostrar contagem
const n = db.prepare('SELECT COUNT(*) as n FROM bet_clv').get();
console.log(`Rows existentes: ${n.n}`);

db.close();
