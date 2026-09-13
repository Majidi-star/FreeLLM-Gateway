import tseslint from 'typescript-eslint';

export default tseslint.config({
  files: ['src/**/*.ts', 'src/**/*.tsx'],
  rules: {
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'off',
  },
});
