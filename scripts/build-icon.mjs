// 将 src/assets/logo.png(应用 Logo)渲染为多尺寸 PNG,打包成 build/icon.ico
// 供 electron-builder 使用,并生成 512px 的 build/icon-preview.png 预览图。
// 运行:node scripts/build-icon.mjs
import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const source = join(root, 'src/assets/logo.png')
const sizes = [16, 32, 48, 64, 128, 256]

const pngs = []
for (const size of sizes) {
  pngs.push(await sharp(source).resize(size, size).png().toBuffer())
}

const ico = await pngToIco(pngs)
await writeFile(join(root, 'build/icon.ico'), ico)

const preview = await sharp(source).resize(512, 512).png().toBuffer()
await writeFile(join(root, 'build/icon-preview.png'), preview)

console.log(`✓ build/icon.ico 生成成功，尺寸：${sizes.join(', ')}`)
console.log('✓ build/icon-preview.png 生成成功，尺寸：512')
