const js = require('@eslint/js');
const tseslint = require('@typescript-eslint/eslint-plugin');
const tsparser = require('@typescript-eslint/parser');
const importPlugin = require('eslint-plugin-import');

module.exports = [
  js.configs.recommended,
  // Configuration for source files with TypeScript project references
  {
    files: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.tsx'],
    ignores: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.spec.ts', 'packages/*/src/**/*.test.tsx', 'packages/*/src/**/*.spec.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: ['packages/*/tsconfig.json'],
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'import': importPlugin,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      
      // Import rules
      'import/extensions': ['error', 'ignorePackages', { 'ts': 'never', 'tsx': 'never', 'js': 'always' }],
      
      // Disable strict rules that are too restrictive for this codebase
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-var-requires': 'error',
      '@typescript-eslint/no-require-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      
      // General rules
      'prefer-const': 'error',
      'no-var': 'error',
      'no-debugger': 'error',
      'no-undef': 'off', // TypeScript handles this
      'no-ex-assign': 'error',
      'no-console': 'warn',
    },
  },
  // Override for atxp CLI package (allows console statements)
  {
    files: ['packages/atxp/src/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  // Configuration for test files and config files without TypeScript project references
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/*.test.tsx', '**/*.spec.tsx', '**/vitest.config.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'import': importPlugin,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      
      // Import rules
      'import/extensions': ['error', 'ignorePackages', { 'ts': 'never', 'tsx': 'never', 'js': 'always' }],
      
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      'no-debugger': 'error',
      'no-undef': 'off',
    },
  },
  {
    ignores: [
      'packages/*/dist/**',
      'packages/*/dist-cjs/**',
      'dist/**',
      'node_modules/**',
      'examples/**',
      '.mastra/**',
      '*.config.js',
    ],
  },
]; 
