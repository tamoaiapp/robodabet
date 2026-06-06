// Gera ícone "RB" verde neon pra taskbar do Windows
// (a logo full fica ilegível em 16/32px, "RB" é simples e identifica)
import { createRequire } from 'node:module'
const require = createRequire('C:/Users/Notebook/Workspace/postmaster-source-v1.0.30/')
const sharp = require('sharp')

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#00ff88"/>
      <stop offset="1" stop-color="#00f0d0"/>
    </linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="4"/>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <!-- fundo redondo -->
  <rect x="14" y="14" width="228" height="228" rx="52" fill="#000"
        stroke="url(#g)" stroke-width="6" filter="url(#glow)"/>
  <!-- RB text -->
  <text x="128" y="172" text-anchor="middle"
        font-family="'Segoe UI', Arial, sans-serif"
        font-weight="900" font-size="135"
        fill="url(#g)" filter="url(#glow)"
        letter-spacing="-6">RB</text>
</svg>`

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512]
for (const s of SIZES) {
  await sharp(Buffer.from(SVG))
    .resize(s, s)
    .png()
    .toFile(`build/icon-${s}.png`)
  console.log(`build/icon-${s}.png`)
}

// Principal (Electron)
await sharp(Buffer.from(SVG)).resize(256, 256).png().toFile('build/icon.png')
console.log('build/icon.png (principal)')

// Favicon do app (usado pelo <link rel=icon> — mostra na taskbar Windows também)
await sharp(Buffer.from(SVG)).resize(64, 64).png().toFile('renderer/favicon.png')
console.log('renderer/favicon.png (RB)')

// NÃO toca em renderer/logo.png — essa fica como a logo full pra sidebar e titlebar
