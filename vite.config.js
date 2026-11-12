import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// servidor só neste computador (localhost): os dados das lojas não ficam acessíveis a outros na rede
export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1500 },   // a biblioteca de Excel (SheetJS) é grande; a app corre localmente
  server: { host: '127.0.0.1', port: 5173, open: true },
  preview: { host: '127.0.0.1', port: 4173, open: true },
});
