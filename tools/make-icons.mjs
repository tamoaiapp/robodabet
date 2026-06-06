// Gera ícones do Windows a partir da logo.png (já com fundo removido)
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
const require = createRequire('C:/Users/Notebook/Workspace/postmaster-source-v1.0.30/')
const sharp = require('sharp')

mkdirSync('build', { recursive: true })

const SRC = 'renderer/logo.png'
const SIZES = [16, 32, 48, 64, 128, 256, 512]

for (const s of SIZES) {
  await sharp(SRC)
    .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(`build/icon-${s}.png`)
  console.log(`build/icon-${s}.png`)
}

// Cópia principal como icon.png (256x256, padrão Electron)
await sharp(SRC)
  .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile('build/icon.png')
console.log('build/icon.png (principal)')

// Cópia favicon na renderer/
await sharp(SRC)
  .resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile('renderer/favicon.png')
console.log('renderer/favicon.png')
