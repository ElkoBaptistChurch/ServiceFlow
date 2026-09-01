import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/renderer',
  // The packaged app opens the renderer with `loadFile`, i.e. over file://, where a
  // root-absolute `/assets/...` URL resolves against the filesystem root rather than
  // the app directory and fails with ERR_FILE_NOT_FOUND. Emitting relative asset URLs
  // is what makes the built index.html work both under the dev server and from disk.
  base: './',
  plugins: [react()],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
});
