import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const cesiumSource  = 'node_modules/cesium/Build/Cesium';
const cesiumBaseUrl = 'cesiumStatic';

export default defineConfig({
  define: {
    // Tells CesiumJS where to find its static assets at runtime.
    // During dev, Vite serves them from the root via the alias below.
    // During build, viteStaticCopy puts them at /cesiumStatic/.
    CESIUM_BASE_URL: JSON.stringify(`/${cesiumBaseUrl}/`),
  },

  plugins: [
    // Copies Cesium static assets into /dist at build time.
    // vite-plugin-static-copy also serves them in dev via its devServer option.
    viteStaticCopy({
      targets: [
        { src: `${cesiumSource}/ThirdParty`, dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Workers`,    dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Assets`,     dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Widgets`,    dest: cesiumBaseUrl },
      ],
    }),
  ],

  // Allow Vite's dev server to serve files from node_modules/cesium
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

  // Prevent Vite from trying to bundle the massive CesiumJS library —
  // let it load from its pre-built IIFE instead.
  optimizeDeps: {
    exclude: ['cesium'],
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          cesium: ['cesium'],
        },
      },
    },
  },
});
