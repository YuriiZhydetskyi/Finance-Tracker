import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.googleappsscript,
        // Project-level cross-file namespaces (Apps Script shares one global scope)
        Config: 'readonly',
        Domain: 'readonly',
        Storage: 'readonly',
        Fx: 'readonly',
        Smoke: 'readonly',
        // Phase 2 placeholders — declared early to avoid future config churn
        AiClient: 'readonly',
        Gemini: 'readonly',
        OpenAi: 'readonly',
        Anthropic: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
];
