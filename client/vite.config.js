import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // the browser only ever talks to this dev server, so the API stays same-origin
      '/stats': 'http://localhost:3000',
    },
  },
})
