// Local/Docker: DATABASE_URL (pg). Netlify: managed Netlify Database (NETLIFY_DB_URL, set automatically).
let pool;
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
} else {
  pool = require('@netlify/database').getDatabase().pool;
}
pool.on('error', e => console.error('PG pool error:', e.message));
module.exports = pool;
