import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig(
  {
    ignores: [
      '.output/',
      '.wxt/',
      '.claude/',
      'test-results/',
      'playwright-report/',
      'e2e/live/out/',
      'e2e/live/.profile*/',
      // A separate project with its own tooling: the website (Astro).
      'website/',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommendedTypeChecked,
  ...svelte.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: true,
        extraFileExtensions: ['.svelte'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: { parserOptions: { parser: ts.parser } },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true, argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description' },
      ],
      'no-empty': ['error', { allowEmptyCatch: false }],
      // Reddit content is untrusted. Render it as text ({expr} or textContent), never as HTML.
      'svelte/no-at-html-tags': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]',
          message: 'Reddit content is untrusted: use textContent.',
        },
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message: 'Reddit content is untrusted: use DOM APIs.',
        },
      ],
    },
  },
  {
    // Tests read JSON from exports all the time; typing every JSON.parse there buys nothing.
    files: ['**/*.test.ts', '**/*.spec.ts', 'tests/**/*.ts', 'e2e/**/*.ts', 'media/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    // Playwright reads fixture dependencies from the first parameter, which must
    // be a destructuring pattern even when empty: `async ({}, use) => ...`.
    files: ['e2e/**/*.ts'],
    rules: { 'no-empty-pattern': 'off' },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...ts.configs.disableTypeChecked,
  },
);
