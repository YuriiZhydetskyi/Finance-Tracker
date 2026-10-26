/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, './package.json'), 'utf8'),
) as { version: string };

// React Compiler is for the app source: tests, the generated route tree and workspace packages
// gain nothing from it. These replace the plugin's default exclusions, so those are repeated.
// Rolldown matches the filters against native paths, hence `[/\\]` separators (and no patterns
// built from the absolute project path, which never match on Windows).
const compilerExclude = [
  /[/\\]node_modules[/\\]|^\0rolldown\/runtime\.js$/,
  /[/\\]packages[/\\][^/\\]+[/\\]src[/\\]/,
  /[/\\]src[/\\]test[/\\]/,
  /\.(?:test|gen)\.[jt]sx?(?:$|\?)/,
];

export default defineConfig({
  plugins: [
    // Router plugin must come BEFORE react() per TanStack Router docs.
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    react(),
    babel({ presets: [reactCompilerPreset()], exclude: compilerExclude }),
    tailwindcss(),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    // Fits `heic-to` (~3.1 MB, the HEIC decoder fetched only when a HEIC file is picked) so the
    // build stays quiet; the side effect is that no other chunk warns at 500 kB, so eyeball the
    // build report after dependency bumps.
    chunkSizeWarningLimit: 3200,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Vendor code in its own chunks keeps their hashes stable across deploys that only
          // touch app code. `includeDependenciesRecursively: false` stops a group from pulling
          // its transitive deps in (react-chartjs-2 would drag `react` into `charts`).
          groups: [
            {
              name: 'charts',
              test: /node_modules[\\/](chart\.js|react-chartjs-2|@kurkle)[\\/]/,
              includeDependenciesRecursively: false,
            },
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              includeDependenciesRecursively: false,
            },
            {
              name: 'supabase',
              test: /node_modules[\\/]@supabase[\\/]/,
            },
            {
              name: 'forms',
              test: /node_modules[\\/](react-hook-form|@hookform|zod)[\\/]/,
              includeDependenciesRecursively: false,
            },
            {
              name: 'tanstack',
              test: /node_modules[\\/]@tanstack[\\/]/,
              includeDependenciesRecursively: false,
            },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
});
