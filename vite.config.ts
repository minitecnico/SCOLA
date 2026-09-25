import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'SCOLA — Gestão Escolar',
        short_name: 'SCOLA',
        description: 'Chamadas, notas, boletins e comunicação escolar.',
        theme_color: '#0A0A0A',
        background_color: '#FFFFFF',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        lang: 'pt-BR',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api/],
        cleanupOutdatedCaches: true,
        // Dados sempre da rede (sessão/permissões precisam estar atualizadas).
        runtimeCaching: [{ urlPattern: ({ url }) => url.pathname.startsWith('/api/'), handler: 'NetworkOnly' }],
      },
    }),
  ],
  server: {
    port: 5173,
    // Em desenvolvimento, a API roda no `wrangler dev` (porta 8787).
    proxy: { '/api': 'http://localhost:8787' },
  },
});
