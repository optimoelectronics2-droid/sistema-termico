import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const appBase = (process.env.npm_lifecycle_event === 'build:github' ? '/sistema-de-facturacion/' : '/')

export default defineConfig({
  base: appBase,
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    chunkSizeWarningLimit: 650,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router-dom')) return 'vendor'
          if (id.includes('node_modules/zustand')) return 'store'
          if (id.includes('node_modules/firebase')) return 'firebase'
          if (id.includes('node_modules/framer-motion') || id.includes('node_modules/lucide-react') || id.includes('node_modules/motion-dom')) return 'ui'
          if (id.includes('node_modules/chart.js') || id.includes('node_modules/react-chartjs-2')) return 'chart'
          if (id.includes('node_modules/jspdf') || id.includes('node_modules/html2canvas') || id.includes('node_modules/qrcode')) return 'pdf'
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: false,
      },
      includeAssets: ['favicon.svg', 'trifusion-logo.png', 'sello-real.png'],
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
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/firestore\.googleapis\.com\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'firestore-cache', networkTimeoutSeconds: 5 },
          },
        ],
      },
    }),
  ],
})
