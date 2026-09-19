export type AuthKind = 'admin' | 'account' | 'anonymous';

export interface AuthContext {
  kind: AuthKind;
  accountId: string | null;
  accountName: string | null;
  apiKeyId: string | null;
  pinnedPoolId: string | null;      // from api_keys.pool_id
  defaultPoolId: string | null;     // from accounts.default_pool_id
  scopes: string[];
  rateLimitRpm: number | null;
  rateLimitTpm: number | null;
}

export const ADMIN_CONTEXT: AuthContext = {
  kind: 'admin',
  accountId: null,
  accountName: null,
  apiKeyId: null,
  pinnedPoolId: null,
  defaultPoolId: null,
  scopes: ['*'],
  rateLimitRpm: null,
  rateLimitTpm: null
};