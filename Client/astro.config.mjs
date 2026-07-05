import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  outDir: './build',
  integrations: [react()],
  server: {
    port: 4321
  }
});