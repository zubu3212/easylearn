require('dotenv').config();
const fs = require('fs'), path = require('path'), bcrypt = require('bcryptjs');
const pool = require('../db');
const reset = process.argv.includes('--reset');
(async () => {
  await pool.query(fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8'));
  const u = process.env.ADMIN_USERNAME || 'admin', p = process.env.ADMIN_PASSWORD || 'admin';
  if (p.length < 8) console.warn('\n⚠  Admin password is weak. Fine for local testing; change it (Profile page) before going live.\n');
  const hash = await bcrypt.hash(p, 12);
  await pool.query(
    `INSERT INTO users (username,email,password_hash,role,approved) VALUES ($1,$2,$3,'admin',true)
     ON CONFLICT (username) DO ${reset ? `UPDATE SET password_hash=EXCLUDED.password_hash, role='admin', approved=true` : 'NOTHING'}`,
    [u, `${u}@easylearn.local`, hash]);
  console.log(`Database ready. Admin login → username: ${u}  password: ${reset || true ? p : '(unchanged)'}${reset ? '  (reset)' : ''}`);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
