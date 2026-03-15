import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: 'all',
    hmr: process.env.DISABLE_HMR === 'true' ? false : {
      clientPort: 443,
      protocol: 'wss',
    },
  },
});
