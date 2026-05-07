import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist', 'node_modules', 'src/routeTree.gen.ts', 'src/shared/types/database.types.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.es2022 },
      parserOptions: {
        project: ['./tsconfig.app.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/shared/lib/supabase-client', '@/shared/lib/supabase-client/*'],
              message:
                'Do not import the Supabase client outside an adapter or feature api/ folder. Use the relevant port (authService / photoStorage / fxRateProvider / parseReceiptService) from @/shared/lib/dependencies.',
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      'src/shared/lib/**/supabase-*.ts',
      'src/shared/lib/supabase-client.ts',
      'src/features/**/api/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['vite.config.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
