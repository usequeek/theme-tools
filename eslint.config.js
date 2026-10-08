// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.queek/**', '**/.next/**', 'packages/*/templates/**', 'fixtures/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // The guard's test matches the literal two-space separator of its report lines.
    files: ['scripts/check-public-text.test.mjs'],
    rules: { 'no-regex-spaces': 'off' },
  },
);
