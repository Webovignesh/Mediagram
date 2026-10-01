import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const readPkg = (file: string) => JSON.parse(readFileSync(file, 'utf8'))
const shipped = [...Object.keys(readPkg('package.json').dependencies), 'electron', 'react', 'react-dom', 'lucide-react']
const licenses = shipped.map((name) => {
  const { version, license } = readPkg(`node_modules/${name}/package.json`)
  return { name, version, license }
})

// Build only: dev HMR needs inline scripts (ARCHITECTURE > Security).
const csp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' teleflow: blob: data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

export default defineConfig({
  main: {
    define: { __LICENSES__: JSON.stringify(licenses) },
    build: { rollupOptions: { input: { index: resolve('electron/main.ts') } } },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { preload: resolve('electron/preload.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' }, // sandboxed preloads must be CommonJS
      },
    },
  },
  renderer: {
    root: 'web',
    build: { outDir: 'out/renderer', rollupOptions: { input: resolve('web/index.html') } },
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'teleflow-csp',
        apply: 'build',
        transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`),
      },
    ],
  },
})
