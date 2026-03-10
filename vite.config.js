import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const cesiumSource  = 'node_modules/cesium/Build/Cesium';
const cesiumBaseUrl = 'cesiumStatic';

export default defineConfig({
  define: {
    CESIUM_BASE_URL: JSON.stringify(`/${cesiumBaseUrl}/`),
  },

  plugins: [
    viteStaticCopy({
      targets: [
        { src: `${cesiumSource}/ThirdParty`, dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Workers`,    dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Assets`,     dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Widgets`,    dest: cesiumBaseUrl },
      ],
    }),
  ],

  server: {
    port: 5173,
    fs: { allow: ['..'] },
    middlewareMode: false,
    proxy: {
      // ── Flight data providers ───────────────────────────────────────────
      '/api/localproxy': {
        target:      'http://localhost:3001',
        changeOrigin: true,
        rewrite:     path => path.replace(/^\/api\/localproxy/, ''),
      },
      '/api/airplaneslive': {
        target:      'https://api.airplanes.live',
        changeOrigin: true,
        rewrite:     path => path.replace(/^\/api\/airplaneslive/, ''),
      },
      '/api/adsbool': {
        target:      'https://api.adsb.lol',
        changeOrigin: true,
        rewrite:     path => path.replace(/^\/api\/adsbool/, ''),
      },
      '/api/opensky': {
        target:      'https://opensky-network.org',
        changeOrigin: true,
        rewrite:     path => path.replace(/^\/api\/opensky/, ''),
      },
      // ── Satellite TLE providers ─────────────────────────────────────────
      '/api/celestrak': {
        target:       'https://celestrak.org',
        changeOrigin: true,
        timeout:      30000,
        proxyTimeout: 30000,
        rewrite:      path => path.replace(/^\/api\/celestrak/, ''),
        onError:      (err, req, res) => {
          console.error('[proxy] CelesTrak error:', err.message);
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('CelesTrak proxy timeout or unavailable');
        },
      },
      '/api/spacetrack': {
        target:      'https://www.space-track.org',
        changeOrigin: true,
        rewrite:     path => path.replace(/^\/api\/spacetrack/, ''),
      },
    },
  },

  optimizeDeps: {
    include: ['cesium'],
  },

  build: {
    chunkSizeWarningLimit: 10000,
    rollupOptions: {
      output: {
        manualChunks: { cesium: ['cesium'] },
      },
    },
  },
});
