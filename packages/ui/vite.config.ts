import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  base: './',
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          ui: ['@radix-ui/react-collapsible', '@radix-ui/react-dialog', '@radix-ui/react-scroll-area'],
          terminal: ['xterm', '@xterm/addon-fit'],
          markdown: ['react-markdown', 'remark-gfm', 'rehype-highlight'],
        },
      },
    },
  },
})
