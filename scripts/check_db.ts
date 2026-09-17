import { getDatabase } from '../src/infra/db/client.js';

const db = getDatabase();
const count = db.prepare('SELECT count(*) as c FROM providers').get() as { c: number };
const antigravity = db.prepare("SELECT * FROM providers WHERE slug = 'antigravity'").get();

console.log('DB providers count:', count.c);
console.log('Antigravity in DB:', antigravity ? 'FOUND' : 'NOT FOUND');
