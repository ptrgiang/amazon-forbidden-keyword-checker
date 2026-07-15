import { defineConfig } from 'vite';
import { resolve } from 'path';

// Content scripts cannot be ES modules in MV3, so bundle as a single IIFE.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/content/index.ts'),
      name: 'AFKCContent',
      formats: ['iife'],
      fileName: () => 'content.js'
    },
    rollupOptions: {
      output: { extend: true }
    },
    target: 'es2022'
  }
});
