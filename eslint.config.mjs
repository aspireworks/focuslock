import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'dist/**',
      'node_modules/**',
      'build/**',
      'preview/**',
      'design_handoff_focuslock_redesign/**',
      'vite.preview.config.ts'
    ]
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // v7 additions that flag long-standing working patterns here (stateRef
      // mirror, draft-init effect, challenge auto-submit). Revisit in the 5.1
      // App.tsx split rather than churning them under lint pressure.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off'
    }
  },
  {
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // ?asset imports and the preload Api type flow through `any` at the bridge.
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  }
)
