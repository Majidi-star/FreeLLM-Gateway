// Provide required environment for unit tests so a fresh clone passes
// `npm ci && npm test` without a developer-local .env file.
process.env.ENCRYPTION_MASTER_KEY ??=
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
