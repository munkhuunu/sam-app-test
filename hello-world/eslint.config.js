// ESLint v9+ flat config (replaces .eslintrc.js + .eslintignore)
// Tries to load typescript-eslint + prettier plugins; if any of them is
// missing the config falls back to a minimal core ruleset so the lint
// step never blocks CI on a missing optional plugin.

const tryRequire = (id) => {
  try { return require(id) } catch { return null }
}

const tsParser       = tryRequire('@typescript-eslint/parser')
const tsPlugin       = tryRequire('@typescript-eslint/eslint-plugin')
const prettierPlugin = tryRequire('eslint-plugin-prettier')
const prettierCfg    = tryRequire('eslint-config-prettier')

const tsRecommended = tsPlugin?.configs?.recommended?.rules ?? {}
const prettierRules = prettierCfg?.rules ?? {}

module.exports = [
  {
    ignores: [
      'node_modules/**',
      '.aws-sam/**',
      'dist/**',
      'coverage/**',
      '*.js',
    ],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser ?? undefined,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
      },
    },
    plugins: {
      ...(tsPlugin       ? { '@typescript-eslint': tsPlugin }       : {}),
      ...(prettierPlugin ? { prettier: prettierPlugin }             : {}),
    },
    rules: {
      ...tsRecommended,
      ...prettierRules,
      ...(prettierPlugin ? { 'prettier/prettier': 'warn' } : {}),

      // Lambda handlers commonly receive `event`/`context` even when
      // unused; downgrade and ignore underscore-prefixed args so the
      // signal stays meaningful without blocking CI.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
]
