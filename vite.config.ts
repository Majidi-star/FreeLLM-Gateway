import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 35173,
    strictPort: false, // Automatically changes port if 35173 is in use
  }
})
