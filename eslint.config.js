const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

module.exports = [
  {
    ignores: ['node_modules/**', 'coverage/**', 'uploads/**', '.sessions/**', '*.db'],
  },

  js.configs.recommended,

  // Backend and tooling: CommonJS on Node.
  {
    files: ['backend/**/*.js', 'tests/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      // Unused catch bindings are a deliberate idiom here: several migrations
      // and cleanup paths swallow an expected error.
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
          varsIgnorePattern: '^_',
        },
      ],
      // The additive migrations in database.js throw when the column already
      // exists, and the cleanup helpers must never let a failed unlink surface.
      // Swallowing those is the intent, not an oversight.
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // Frontend: browser globals, ES5-flavoured vanilla JS served straight to the
  // page with no build step, so `var` and function expressions stay.
  {
    files: ['frontend/public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2018,
      sourceType: 'script',
      globals: { ...globals.browser, module: 'writable' },
    },
    rules: {
      'no-var': 'off',
      'prefer-const': 'off',
      'no-unused-vars': ['error', { args: 'none' }],
    },
  },

  // Tests reach for node:test globals.
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  prettier,
];
