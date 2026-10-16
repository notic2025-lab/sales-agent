import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages（https://<user>.github.io/sales-agent/）で配信するため base を相対パスにする
export default defineConfig({
  base: './',
  plugins: [react()],
})
