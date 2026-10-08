// One-off production packaging for the entry fix; omit the development inspector.
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
export default defineConfig({ base: './', plugins: [react()], resolve: {
  alias: { '@': path.resolve(import.meta.dirname, './src') }
} });
