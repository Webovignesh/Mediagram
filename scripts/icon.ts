// Renders assets/icon.svg to assets/icon.png (256 px) and assets/icon.ico (16/32/48/256, PNG-compressed entries).
// Run manually after editing the SVG: npm run icon (needs `npx playwright install chromium` once).
import fs from 'node:fs'
import { chromium } from '@playwright/test'

const sizes = [16, 32, 48, 256]
const svg = fs.readFileSync('assets/icon.svg').toString('base64')

const browser = await chromium.launch()
const page = await browser.newPage()
const pngs: Buffer[] = []
for (const size of sizes) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<body style="margin:0"><img style="display:block" width="${size}" height="${size}" src="data:image/svg+xml;base64,${svg}">`)
  pngs.push(await page.screenshot({ omitBackground: true }))
}
await browser.close()

// ICO = 6-byte header + one 16-byte entry per image, then the PNG bytes. A size byte of 0 means 256.
const head = Buffer.alloc(6 + 16 * pngs.length)
head.writeUInt16LE(1, 2) // type: icon
head.writeUInt16LE(pngs.length, 4)
let offset = head.length
pngs.forEach((png, i) => {
  const at = 6 + 16 * i
  head.writeUInt8(sizes[i] % 256, at)
  head.writeUInt8(sizes[i] % 256, at + 1)
  head.writeUInt16LE(1, at + 4) // planes
  head.writeUInt16LE(32, at + 6) // bits per pixel
  head.writeUInt32LE(png.length, at + 8)
  head.writeUInt32LE(offset, at + 12)
  offset += png.length
})
fs.writeFileSync('assets/icon.ico', Buffer.concat([head, ...pngs]))
fs.writeFileSync('assets/icon.png', pngs.at(-1)!)
console.log(`assets/icon.ico (${sizes.join(', ')} px) and assets/icon.png written`)
