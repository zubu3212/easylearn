require('dotenv').config();
const bcrypt = require('bcryptjs'), pool = require('../db');
(async () => {
  const hash = await bcrypt.hash('Student123!', 10);
  await pool.query(`INSERT INTO users (username,email,phone,password_hash,role) VALUES ('teacher1','teacher1@demo.local','01800000000',$1,'teacher') ON CONFLICT (username) DO NOTHING`, [hash]);
  const names = ['rahim', 'karim', 'nusrat', 'tania', 'sabbir', 'mitu'];
  for (const n of names) {
    const { rows } = await pool.query(`INSERT INTO users (username,email,phone,password_hash,role) VALUES ($1,$2,'01700000000',$3,'student')
      ON CONFLICT (username) DO UPDATE SET username=EXCLUDED.username RETURNING id`, [n, `${n}@demo.local`, hash]);
    for (const c of (await pool.query('SELECT id FROM courses')).rows)
      await pool.query(`INSERT INTO results (student_id,course_id,marks) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [rows[0].id, c.id, 35 + Math.floor(Math.random() * 65)]);
  }
  await pool.query(`INSERT INTO attendance (student_id,course_id,day,present) SELECT u.id,c.id,(current_date-g)::date,random()>0.2
    FROM users u CROSS JOIN courses c CROSS JOIN generate_series(0,6) g WHERE u.role='student' ON CONFLICT DO NOTHING`);
  await pool.query(`INSERT INTO announcements (title,body) VALUES ('Welcome to the new portal','Check your results and profile from the sidebar.')`);
  await pool.query(`INSERT INTO admissions (name,email,phone,message) VALUES ('Demo Applicant','demo@mail.com','01711111111','I want to join Web Development')`);
  console.log('Demo data added. Student: rahim / Student123! · Teacher: teacher1 / Student123!');
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
