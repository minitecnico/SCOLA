import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

/**
 * Planilha (FortuneSheet) em português: a biblioteca não traz pt-BR, então
 * acrescentamos "pt" à tabela interna de idiomas — espanhol como base e a nossa
 * tradução por cima (src/lib/sheet-locale-pt.json). Vale no build e no dev.
 */
const ptOverlay = readFileSync(new URL('./src/lib/sheet-locale-pt.json', import.meta.url), 'utf8');
const addPortuguese = (code: string) =>
  code.replace(
    'var localeObj = {',
    `var __ptOv = ${ptOverlay};
var __ptMerge = function (base, ov) { var o = Object.assign({}, base); for (var k in ov) { o[k] = (ov[k] && typeof ov[k] === 'object' && !Array.isArray(ov[k])) ? Object.assign({}, base[k], ov[k]) : ov[k]; } return o; };
var localeObj = {
  pt: __ptMerge(es, __ptOv),`,
  );
const fortunePt = {
  name: 'fortune-sheet-pt',
  transform(code: string, id: string) {
    if (id.includes('@fortune-sheet/core') && code.includes('var localeObj = {')) return { code: addPortuguese(code), map: null };
  },
};

export default defineConfig({
  plugins: [
    fortunePt,
    react(),
    VitePWA({
      // "prompt": a versão nova só entra quando o professor tocar em "Atualizar"
      // (nunca recarrega sozinho no meio de uma chamada).
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'og-image.png', 'scola-mono-preta.svg'],
      manifest: {
        id: '/',
        name: 'SCOLA — Gestão Escolar',
        short_name: 'SCOLA',
        description: 'Chamada pelo celular, notas por trimestre, correção de provas pela câmera e boletins prontos.',
        lang: 'pt-BR',
        dir: 'ltr',
        start_url: '/?origem=app',
        scope: '/',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'any',
        theme_color: '#FFFFFF',
        background_color: '#FFFFFF',
        categories: ['education', 'productivity'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Atalhos ao segurar o ícone do app (Android / desktop).
        shortcuts: [
          { name: 'Fazer chamada', short_name: 'Chamada', url: '/chamadas', icons: [{ src: 'icon-192.png', sizes: '192x192' }] },
          { name: 'Lançar notas', short_name: 'Notas', url: '/notas', icons: [{ src: 'icon-192.png', sizes: '192x192' }] },
          { name: 'Corrigir provas com a câmera', short_name: 'Corrigir', url: '/provas?corrigir=1', icons: [{ src: 'icon-192.png', sizes: '192x192' }] },
        ],
        // Prévia mostrada na tela de instalação (Android/Chrome).
        screenshots: [
          { src: 'screenshots/celular-inicio.jpg', sizes: '780x1688', type: 'image/jpeg', form_factor: 'narrow', label: 'Início com alertas e calendário de chamadas' },
          { src: 'screenshots/celular-chamada.jpg', sizes: '780x1688', type: 'image/jpeg', form_factor: 'narrow', label: 'Chamada pelo celular em segundos' },
          { src: 'screenshots/computador-inicio.jpg', sizes: '1440x900', type: 'image/jpeg', form_factor: 'wide', label: 'Painel da escola' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,webmanifest,wasm}'],
        // Leitor de QR (ZXing, ~1 MB) entra no cache: a correção funciona sem internet.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // Pesados e raros no celular (Excel, PDF, ZIP): baixam só quando usados.
        globIgnores: ['screenshots/**', 'og-image.png', '**/xlsx-*.js', '**/pdf-*.js', '**/pdf.worker*', '**/jszip*', '**/PlanDocEditorPage-*.js', '**/docxConvert-*.js', '**/main-*.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/],
        cleanupOutdatedCaches: true,
        // Dados sempre da rede (sessão/permissões precisam estar atualizadas).
        runtimeCaching: [{ urlPattern: ({ url }) => url.pathname.startsWith('/api/'), handler: 'NetworkOnly' }],
      },
    }),
  ],
  // No dev, as dependências são pré-empacotadas pelo esbuild: aplica a mesma tradução lá.
  optimizeDeps: {
    esbuildOptions: {
      plugins: [
        {
          name: 'fortune-sheet-pt',
          setup(build) {
            build.onLoad({ filter: /@fortune-sheet[\\/]core[\\/]dist[\\/]index\.esm\.js$/ }, (args) => ({
              contents: addPortuguese(readFileSync(args.path, 'utf8')),
              loader: 'js',
            }));
          },
        },
      ],
    },
  },
  server: {
    port: 5173,
    // Em desenvolvimento, a API roda no `wrangler dev` (porta 8787).
    proxy: { '/api': { target: 'http://localhost:8787', ws: true } },
  },
});
