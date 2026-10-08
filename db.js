const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
pool.on('error', e => console.error('PG pool error:', e.message));
module.exports = pool;
