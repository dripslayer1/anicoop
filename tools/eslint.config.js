// ESLint for app.js (catches undefined names, duplicate keys, dead variables): from an empty folder with
// { "type": "module" } in package.json: npm i eslint@9 globals@15, copy app.js next to this file, npx eslint app.js
import globals from 'globals';
import js from '@eslint/js';
export default [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.browser, Vue: 'readonly', supabase: 'readonly' },
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-empty': 'off',
      'no-useless-escape': 'off',
      'no-cond-assign': 'warn',
      'no-prototype-builtins': 'off',
      'no-inner-declarations': 'off',
      'no-fallthrough': 'warn',
      'no-self-compare': 'warn',
      'no-unmodified-loop-condition': 'warn',
      'no-unreachable-loop': 'warn',
      'no-use-before-define': ['warn', { functions: false, classes: false, variables: false }],
      'no-template-curly-in-string': 'warn',
      'no-dupe-keys': 'error',
      'no-dupe-else-if': 'error',
      'no-duplicate-case': 'error',
      'no-self-assign': 'warn',
      'array-callback-return': 'warn',
      'no-constant-binary-expression': 'warn',
      'no-unsafe-optional-chaining': 'warn',
      'no-loss-of-precision': 'warn',
      'no-async-promise-executor': 'warn',
      'require-atomic-updates': 'off',
    },
  },
];
