// Flood fill a partir dos 4 cantos — remove SÓ o fundo preto contínuo
// Preserva pretos internos do robô (sombras, contornos)
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/Notebook/Workspace/postmaster-source-v1.0.30/')
const sharp = require('sharp')

const INPUT = process.argv[2] || 'C:/Users/Notebook/Downloads/b8a6eec5-b81b-4250-996d-b134ee6ab587.png'
const OUTPUT = process.argv[3] || 'renderer/logo.png'
const THRESHOLD = 35 // soma RGB < 35 = preto suficiente pra ser fundo

const { data, info } = await sharp(INPUT).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const W = info.width, H = info.height
console.log(`Input: ${W}x${H}`)

const newData = Buffer.from(data)
const visited = new Uint8Array(W * H)

function isBg(i) {
  const r = newData[i*4], g = newData[i*4+1], b = newData[i*4+2]
  return (r + g + b) < THRESHOLD
}

// Stack de pixels (index linear)
const stack = []
const seed = (x, y) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return
  const i = y * W + x
  if (!visited[i] && isBg(i)) stack.push(i)
}

// Sementes nas 4 bordas
for (let x = 0; x < W; x++) { seed(x, 0); seed(x, H - 1) }
for (let y = 0; y < H; y++) { seed(0, y); seed(W - 1, y) }

console.log(`Sementes nas bordas: ${stack.length}`)

let removed = 0
while (stack.length) {
  const i = stack.pop()
  if (visited[i]) continue
  visited[i] = 1
  if (!isBg(i)) continue
  newData[i*4 + 3] = 0 // alpha = 0
  removed++
  const x = i % W, y = (i / W) | 0
  // 4-vizinhos
  if (x > 0)     stack.push(i - 1)
  if (x < W-1)   stack.push(i + 1)
  if (y > 0)     stack.push(i - W)
  if (y < H-1)   stack.push(i + W)
}

await sharp(newData, { raw: { width: W, height: H, channels: 4 } })
  .png()
  .toFile(OUTPUT)

console.log(`Pixels removidos: ${removed} (${(removed / (W*H) * 100).toFixed(1)}%)`)
console.log(`Salvo: ${OUTPUT}`)
