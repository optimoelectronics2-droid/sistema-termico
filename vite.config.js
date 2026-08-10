import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import process from 'node:process'

const appBase = process.env.npm_lifecycle_event === 'build:github' ? '/sistema-de-facturacion/' : '/'

export default defineConfig({
  base: appBase,
  server: {
    port: 5173,
    strictPort: false,
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: false,
      },
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Trifusion ERP Fiscal',
        short_name: 'Trifusion ERP',
        description: 'ERP + POS + facturacion fiscal RD para Trifusion Technologies',
        theme_color: '#0A0A0F',
        background_color: '#0A0A0F',
        display: 'standalone',
        start_url: appBase,
        scope: appBase,
        icons: [
          { src: `${appBase}trifusion-logo.png`, sizes: '192x192', type: 'image/png' },
          { src: `${appBase}trifusion-logo.png`, sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
    }),
  ],
})
