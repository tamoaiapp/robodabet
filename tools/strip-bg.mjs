// Remove fundo azul saturado da logo (chroma key)
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/Notebook/Workspace/postmaster-source-v1.0.30/')
const sharp = require('sharp')

const INPUT = process.argv[2] || 'C:/Users/Notebook/Downloads/f37b0b83-430a-4533-a424-c21217e69bb3.png'
const OUTPUT = process.argv[3] || 'renderer/logo.png'

const img = sharp(INPUT).ensureAlpha()
const meta = await img.metadata()
const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })

console.log(`Input: ${meta.width}x${meta.height} ${meta.format}`)

const newData = Buffer.from(data)
let removed = 0

for (let i = 0; i < newData.length; i += 4) {
  const r = newData[i], g = newData[i+1], b = newData[i+2]
  // Fundo azul saturado: B alto, R/G baixos
  // Detecta variações próximas de #0000FF, #0808E8, etc
  const isBlue = b > 150 && r < 80 && g < 80 && (b - Math.max(r, g)) > 60
  if (isBlue) {
    newData[i+3] = 0 // alpha = 0 transparente
    removed++
  }
}

await sharp(newData, { raw: { width: info.width, height: info.height, channels: 4 } })
  .png()
  .toFile(OUTPUT)

console.log(`Pixels removidos: ${removed} (${(removed / (info.width * info.height) * 100).toFixed(1)}%)`)
console.log(`Salvo: ${OUTPUT}`)
