import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const cesiumSource  = 'node_modules/cesium/Build/Cesium';
const cesiumBaseUrl = 'cesiumStatic';

export default defineConfig({
  define: {
    // Tells CesiumJS where to find its static assets at runtime
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
    fs: {
      allow: ['..'],
    },
    proxy: {
      '/api/celestrak': {
        target: 'https://celestrak.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/celestrak/, ''),
      },
      '/api/spacetrack': {
        target: 'https://www.space-track.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/spacetrack/, ''),
      },
    },
  },

  // DO NOT exclude cesium here — it has CommonJS sub-deps (mersenne-twister etc.)
  // that need Vite's esbuild pre-bundler to convert them to ESM.
  // Instead let Vite pre-bundle everything normally.
  optimizeDeps: {
    include: ['cesium'],
  },

  build: {
    // Increase the chunk size warning limit — CesiumJS is intentionally large
    chunkSizeWarningLimit: 10000,
    rollupOptions: {
      output: {
        // Keep Cesium in its own chunk
        manualChunks: {
          cesium: ['cesium'],
        },
      },
    },
  },
});
