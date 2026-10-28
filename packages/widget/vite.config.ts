import { defineConfig } from 'vite';

// One self-contained ES module: <script type="module" src=".../lean-chat.js"></script>
export default defineConfig({
  build: {
    lib: {
      entry: 'src/lean-chat.ts',
      formats: ['es'],
      fileName: () => 'lean-chat.js',
    },
    target: 'es2022',
    minify: true,
    sourcemap: true,
  },
});
