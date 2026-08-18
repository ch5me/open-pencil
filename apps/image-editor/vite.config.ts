import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom', 'three']
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react-wrapper', test: /node_modules\/(react|react-dom)\// },
            { name: 'compositor-core', test: /node_modules\/three\// },
            { name: 'psd-adapter', test: /node_modules\/ag-psd\// }
          ]
        }
      }
    }
  },
  server: {
    host: '127.0.0.1',
    allowedHosts: ['.tailfce65b.ts.net']
  }
});
