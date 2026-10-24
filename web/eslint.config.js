import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The parser's whole job is control characters.
    files: ['src/term/sgr.ts'],
    rules: { 'no-control-regex': 'off' },
  },
  {
    // The worklet runs on the audio thread, with that scope's globals.
    files: ['public/mic-worklet.js'],
    languageOptions: {
      globals: {
        AudioWorkletProcessor: 'readonly',
        registerProcessor: 'readonly',
        sampleRate: 'readonly',
      },
    },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'e2e/**/*.ts'],
    rules: {
      // Pane content and names are hostile text; they go through React's escaping, never markup.
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Render text, not markup.',
        },
        {
          selector: "MemberExpression[property.name='innerHTML']",
          message: 'Render text, not markup.',
        },
      ],
    },
  },
);
