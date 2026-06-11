import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const source = fileURLToPath(new URL('../src-tauri/assets/dmg-background.svg', import.meta.url))
const output = fileURLToPath(new URL('../src-tauri/assets/dmg-background.png', import.meta.url))

const logicalWidth = 660
const logicalHeight = 400
const retinaScale = 2

const svg = await readFile(source)

await sharp(svg, { density: 288 })
  .resize(logicalWidth * retinaScale, logicalHeight * retinaScale, {
    fit: 'fill',
    kernel: sharp.kernel.lanczos3,
  })
  .png({
    compressionLevel: 9,
    adaptiveFiltering: true,
    palette: false,
  })
  .toFile(output)

console.log(`Rendered ${output}`)
