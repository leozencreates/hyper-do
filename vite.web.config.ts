import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Web / PWA yapılandırması (iPhone, iPad, Mac Safari, herhangi bir tarayıcı)
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist-web' },
  server: { host: true, port: 5180 },
})
