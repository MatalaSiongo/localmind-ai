
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),

    VitePWA({
      registerType: 'autoUpdate',

      includeAssets: [
        'favicon.svg',
        'localmind-icon.svg',
      ],

      manifest: {
        name: 'LocalMind AI',
        short_name: 'LocalMind',
        description:
          'LocalMind AI - Your intelligent AI assistant for chat, web search, images and documents.',

        theme_color: '#151515',
        background_color: '#151515',
        display: 'standalone',
        start_url: '/',
        scope: '/',

        icons: [
          {
            src: '/localmind-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/localmind-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },

      workbox: {
        globPatterns: [
          '**/*.{js,css,html,ico,png,svg,woff2}',
        ],

        navigateFallback: '/index.html',

        navigateFallbackDenylist: [
          /^\/api\//,
        ],

        runtimeCaching: [],
      },

      devOptions: {
        enabled: false,
      },
    }),
  ],

  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:11434',
        changeOrigin: true,
      },
    },
  },
})
