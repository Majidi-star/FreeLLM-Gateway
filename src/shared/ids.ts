import { ulid } from 'ulid';

export function generateId(prefix?: string): string {
  const id = ulid();
  return prefix ? `${prefix}_${id}` : id;
}
