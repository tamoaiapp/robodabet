import { createRequire } from 'node:module'
const require = createRequire('C:/Users/Notebook/Workspace/postmaster-source-v1.0.30/')
const sharp = require('sharp')

// Compõe logo.png sobre fundo branco pra verificar transparência
await sharp({ create: { width: 1254, height: 1254, channels: 3, background: { r: 255, g: 255, b: 255 } } })
  .composite([{ input: 'renderer/logo.png' }])
  .png()
  .toFile('tools/verify-white.png')

// Conta pixels transparentes
const { data, info } = await sharp('renderer/logo.png').raw().toBuffer({ resolveWithObject: true })
let transp = 0, semi = 0, opaque = 0
for (let i = 0; i < data.length; i += 4) {
  if (data[i+3] === 0) transp++
  else if (data[i+3] < 255) semi++
  else opaque++
}
console.log(`Transparente: ${transp} (${(transp/info.width/info.height*100).toFixed(1)}%)`)
console.log(`Semi:         ${semi}`)
console.log(`Opaco:        ${opaque}`)
console.log('Verify: tools/verify-white.png')
