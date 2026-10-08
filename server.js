require('dotenv').config();
const express = require('express'), session = require('express-session'), helmet = require('helmet'),
  rateLimit = require('express-rate-limit'), bcrypt = require('bcryptjs'), crypto = require('crypto'),
  path = require('path'), PgStore = require('connect-pg-simple')(session), pool = require('./db');

const onNetlify = !process.env.DATABASE_URL;
const app = express(), prod = process.env.NODE_ENV === 'production' || onNetlify;
if (!process.env.SESSION_SECRET && !onNetlify) throw new Error('SESSION_SECRET is required');
if (prod) app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:'], styleSrc: ["'self'"], scriptSrc: ["'self'"], formAction: ["'self'"] } } }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: prod ? '7d' : 0 }));
// One-time startup: session secret (env or auto-generated + stored in DB) and default admin account.
let sessionMw, ready;
async function init() {
  let secret = process.env.SESSION_SECRET;
  if (!secret) {
    await pool.query(`INSERT INTO settings (key,value) VALUES ('session_secret',$1) ON CONFLICT (key) DO NOTHING`, [crypto.randomBytes(48).toString('hex')]);
    secret = (await pool.query(`SELECT value FROM settings WHERE key='session_secret'`)).rows[0].value;
  }
  const { rows } = await pool.query(`SELECT 1 FROM users WHERE role='admin' LIMIT 1`);
  if (!rows.length) {
    const u = process.env.ADMIN_USERNAME || 'admin', p = process.env.ADMIN_PASSWORD || 'admin';
    await pool.query(`INSERT INTO users (username,email,password_hash,role,approved) VALUES ($1,$2,$3,'admin',true) ON CONFLICT (username) DO NOTHING`,
      [u, `${u}@easylearn.local`, await bcrypt.hash(p, 12)]);
  }
  sessionMw = session({
    store: new PgStore({ pool, createTableIfMissing: !onNetlify }),
    secret, resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: onNetlify ? 'auto' : prod, maxAge: 24 * 3600 * 1000 }
  });
}
app.use((req, res, next) => {
  ready = ready || init().catch(e => { ready = null; throw e; });
  ready.then(() => sessionMw(req, res, next), next);
});

// ---------- helpers ----------
const flash = (req, type, msg) => { req.session.flash = { type, msg }; };
const grade = m => m >= 80 ? 'A+' : m >= 70 ? 'A' : m >= 60 ? 'A-' : m >= 50 ? 'B' : m >= 40 ? 'C' : m >= 33 ? 'D' : 'F';
const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 120;
const isPhone = s => !s || /^[0-9+\-\s]{7,20}$/.test(s);
const str = v => (typeof v === 'string' ? v.trim() : '');
const toId = v => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const need = role => (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  if (![].concat(role).includes(req.session.user.role)) return res.status(403).render('error', { msg: 'Access denied' });
  next();
};
app.locals.grade = grade;
Object.assign(app.locals, { csrf: '', user: null, flash: null, path: '', shell: false }); // defaults so error pages render before session setup
const homeOf = r => ({ admin: '/admin', teacher: '/teacher', student: '/student' }[r] || '/');
app.locals.homeOf = homeOf;
const E = process.env;
app.locals.brand = E.INSTITUTE_NAME || 'EasyLearn Hub';
app.locals.site = { tagline: E.TAGLINE || 'Learn practical IT skills with real projects', owner: E.CONTACT_NAME || '', phone: E.CONTACT_PHONE || '', email: E.CONTACT_EMAIL || '', address: E.CONTACT_ADDRESS || '' };

// ---------- session locals + CSRF ----------
app.use((req, res, next) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrf = req.session.csrf;
  res.locals.user = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.path = req.path;
  res.locals.shell = !!req.session.user && /^\/(admin|student|teacher)/.test(req.path);
  next();
});
app.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  const a = Buffer.from(str(req.body._csrf)), b = Buffer.from(req.session.csrf);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
    return res.status(403).render('error', { msg: 'Invalid or expired form. Please go back and retry.' });
  next();
});

// ---------- public ----------
app.get('/', async (req, res) => {
  const [c, st] = await Promise.all([pool.query('SELECT * FROM courses ORDER BY id LIMIT 3'),
    pool.query(`SELECT (SELECT count(*) FROM users WHERE role='student')::int AS students, (SELECT count(*) FROM courses)::int AS courses`)]);
  res.render('index', { title: 'Home', courses: c.rows, stats: st.rows[0] });
});
app.get('/healthz', async (req, res) => { await pool.query('SELECT 1'); res.json({ ok: true }); });
app.get('/about', (req, res) => res.render('about', { title: 'About' }));
app.get('/teachers', (req, res) => res.render('teachers', { title: 'Teachers' }));
app.get('/admission', (req, res) => res.render('admission', { title: 'Admission' }));
app.get('/contact', (req, res) => res.render('contact', { title: 'Contact' }));
app.get('/courses', async (req, res) => {
  const { rows: courses } = await pool.query('SELECT * FROM courses ORDER BY id');
  res.render('courses', { title: 'Courses', courses });
});

app.post('/apply', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10 }), async (req, res) => {
  const f = { name: str(req.body.name), email: str(req.body.email), phone: str(req.body.phone), message: str(req.body.message).slice(0, 1000) };
  if (f.name.length < 2 || f.name.length > 100 || !isEmail(f.email) || !isPhone(f.phone)) {
    flash(req, 'error', 'Please provide a valid name, email and phone number.');
  } else {
    await pool.query('INSERT INTO admissions (name,email,phone,message) VALUES ($1,$2,$3,$4)', [f.name, f.email, f.phone, f.message]);
    flash(req, 'success', 'Application submitted! We will contact you soon.');
  }
  res.redirect('/admission');
});

// ---------- auth ----------
const DUMMY = bcrypt.hashSync('dummy-password', 12);
app.get('/login', (req, res) => req.session.user ? res.redirect(homeOf(req.session.user.role)) : res.render('login'));
app.post('/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true }), async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE username=$1', [str(req.body.username)]);
  const u = rows[0];
  const ok = await bcrypt.compare(String(req.body.password || ''), u ? u.password_hash : DUMMY);
  if (!u || !ok) { flash(req, 'error', 'Username or password is incorrect.'); return res.redirect('/login'); }
  if (!u.approved) { flash(req, 'error', 'Your account is awaiting admin approval.'); return res.redirect('/login'); }
  req.session.regenerate(err => {
    if (err) throw err;
    req.session.user = { id: u.id, username: u.username, role: u.role };
    req.session.save(() => res.redirect(homeOf(u.role)));
  });
});
app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

// ---------- signup ----------
app.get('/signup', (req, res) => req.session.user ? res.redirect(homeOf(req.session.user.role)) : res.render('signup', { title: 'Sign up', f: {} }));
app.post('/signup', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10 }), async (req, res) => {
  const role = req.body.role === 'teacher' ? 'teacher' : 'student'; // never trust any other value
  if (/^(admin|administrator|root|teacher|staff|support)$/i.test(str(req.body.username))) return res.render('signup', { title: 'Sign up', f: { role }, flash: { type: 'error', msg: 'That username is reserved.' } });
  const { d, err } = validateStudent(req.body, true);
  const f = { username: d.username, email: d.email, phone: d.phone, role };
  const fail = msg => res.render('signup', { title: 'Sign up', f, flash: { type: 'error', msg } });
  if (err) return fail(err);
  if (d.password !== String(req.body.confirm || '')) return fail('Passwords do not match.');
  try {
    await pool.query(`INSERT INTO users (username,email,phone,password_hash,role,approved) VALUES ($1,$2,$3,$4,$5,$6)`,
      [d.username, d.email, d.phone || null, await bcrypt.hash(d.password, 12), role, role === 'student']);
  } catch (e) { if (e.code === '23505') return fail('Username already taken.'); throw e; }
  flash(req, 'success', role === 'teacher'
    ? 'Registration received! An admin must approve your teacher account before you can log in.'
    : 'Account created! You can log in now.');
  res.redirect('/login');
});

// ---------- admin ----------
const admin = express.Router();
const TEACHER_OK = /^\/(attendance|results|announcements)(\.csv|\/|$)/;
admin.use((req, res, next) => need(req.session.user && req.session.user.role === 'teacher' && TEACHER_OK.test(req.path) ? 'teacher' : 'admin')(req, res, next));

admin.get('/', async (req, res) => {
  const q = sql => pool.query(sql).then(r => r.rows);
  const [[s], week, marks, top, courses, recent] = await Promise.all([
    q(`SELECT (SELECT count(*) FROM users WHERE role='student')::int AS students,
       (SELECT count(*) FROM admissions)::int AS admissions,
       (SELECT count(*) FROM admissions WHERE status='pending')::int AS pending,
       (SELECT count(*) FROM courses)::int AS courses,
       (SELECT count(*) FROM users WHERE role='teacher' AND NOT approved)::int AS pending_teachers,
       (SELECT round(avg(marks),1) FROM results) AS avg_marks`),
    q(`SELECT to_char(d,'Dy') AS lbl, count(a.id)::int AS n
       FROM generate_series(current_date-6, current_date, interval '1 day') d
       LEFT JOIN admissions a ON a.created_at::date = d::date GROUP BY d ORDER BY d`),
    q('SELECT marks, count(*)::int AS n FROM results GROUP BY marks'),
    q(`SELECT u.username, round(avg(r.marks),1) AS avg FROM results r JOIN users u ON u.id=r.student_id
       GROUP BY u.id ORDER BY avg DESC LIMIT 5`),
    q(`SELECT c.title, round(avg(r.marks),1) AS avg, count(r.id)::int AS n FROM courses c
       LEFT JOIN results r ON r.course_id=c.id GROUP BY c.id ORDER BY c.title`),
    q('SELECT * FROM admissions ORDER BY created_at DESC LIMIT 5')]);
  const dist = {}; ['A+', 'A', 'A-', 'B', 'C', 'D', 'F'].forEach(g => dist[g] = 0);
  marks.forEach(m => { dist[grade(m.marks)] += m.n; });
  res.render('admin/dashboard', { s, week, dist, top, courses, recent });
});

const STATUSES = ['pending', 'accepted', 'rejected', 'enrolled'];
admin.get('/admissions', async (req, res) => {
  const st = STATUSES.includes(req.query.status) ? req.query.status : '';
  const { rows } = await pool.query(`SELECT * FROM admissions WHERE ($1='' OR status=$1) ORDER BY created_at DESC`, [st]);
  res.render('admin/admissions', { rows, st });
});
admin.post('/admissions/:id/status', async (req, res) => {
  const st = str(req.body.status);
  if (STATUSES.includes(st)) await pool.query('UPDATE admissions SET status=$1 WHERE id=$2', [st, toId(req.params.id)]);
  res.redirect('/admin/admissions' + (STATUSES.includes(req.body.back) ? '?status=' + req.body.back : ''));
});
admin.post('/admissions/:id/delete', async (req, res) => {
  const id = toId(req.params.id);
  if (id) await pool.query('DELETE FROM admissions WHERE id=$1', [id]);
  flash(req, 'success', 'Admission deleted.');
  res.redirect('/admin/admissions');
});

admin.post('/admissions/:id/enroll', async (req, res) => {
  const { rows: [a] } = await pool.query(`SELECT * FROM admissions WHERE id=$1 AND status IN ('pending','accepted')`, [toId(req.params.id)]);
  if (!a) { flash(req, 'error', 'Application not found or already enrolled.'); return res.redirect('/admin/admissions'); }
  const base = a.name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'student';
  const pw = crypto.randomBytes(7).toString('base64url'), hash = await bcrypt.hash(pw, 12);
  for (let i = 0; i < 5; i++) {
    const uname = base + (100 + crypto.randomInt(900));
    try {
      await pool.query(`INSERT INTO users (username,email,phone,password_hash,role) VALUES ($1,$2,$3,$4,'student')`, [uname, a.email, a.phone || null, hash]);
      await pool.query(`UPDATE admissions SET status='enrolled' WHERE id=$1`, [a.id]);
      flash(req, 'success', `Enrolled! Username: ${uname} · Temporary password: ${pw} — share it with the student now (shown once).`);
      return res.redirect('/admin/admissions');
    } catch (e) { if (e.code !== '23505') throw e; }
  }
  flash(req, 'error', 'Could not generate a unique username, try again.');
  res.redirect('/admin/admissions');
});

const PAGE = 10;
const csv = (res, name, head, rows) => {
  const esc = v => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` });
  res.send('\ufeff' + [head, ...rows].map(r => r.map(esc).join(',')).join('\r\n'));
};
const STU_WHERE = `u.role='student' AND ($1='' OR u.username ILIKE '%'||$1||'%' OR u.email ILIKE '%'||$1||'%')`;

admin.get('/students.csv', async (req, res) => {
  const { rows } = await pool.query(`SELECT u.username,u.email,u.phone,u.created_at,round(avg(r.marks),1) AS avg
    FROM users u LEFT JOIN results r ON r.student_id=u.id WHERE ${STU_WHERE} GROUP BY u.id ORDER BY u.id`, [str(req.query.q).slice(0, 50)]);
  csv(res, 'students.csv', ['Username', 'Email', 'Phone', 'Joined', 'Average marks'],
    rows.map(r => [r.username, r.email, r.phone, r.created_at.toISOString().slice(0, 10), r.avg]));
});

admin.get('/students', async (req, res) => {
  const q = str(req.query.q).slice(0, 50), page = Math.max(1, toId(req.query.page) || 1);
  const { rows: [{ n }] } = await pool.query(`SELECT count(*)::int AS n FROM users u WHERE ${STU_WHERE}`, [q]);
  const { rows } = await pool.query(
    `SELECT u.id,u.username,u.email,u.phone,u.created_at,round(avg(r.marks),1) AS avg
     FROM users u LEFT JOIN results r ON r.student_id=u.id WHERE ${STU_WHERE}
     GROUP BY u.id ORDER BY u.id DESC LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`, [q]);
  res.render('admin/students', { rows, q, page, pages: Math.max(1, Math.ceil(n / PAGE)), total: n });
});

function validateStudent(b, creating) {
  const d = { username: str(b.username), email: str(b.email), phone: str(b.phone), password: String(b.password || '') };
  let err = null;
  if (!/^[a-zA-Z0-9_.]{3,30}$/.test(d.username)) err = 'Username: 3-30 letters, numbers, _ or .';
  else if (!isEmail(d.email)) err = 'Enter a valid email.';
  else if (!isPhone(d.phone)) err = 'Enter a valid phone number.';
  else if ((creating || d.password) && d.password.length < 8) err = 'Password must be at least 8 characters.';
  return { d, err };
}
const formErr = (res, s, editing, msg) => res.render('admin/student_form', { s, editing, flash: { type: 'error', msg } });

admin.get('/students/new', (req, res) => res.render('admin/student_form', { s: {}, editing: false }));
admin.post('/students/new', async (req, res) => {
  const { d, err } = validateStudent(req.body, true);
  if (err) return formErr(res, d, false, err);
  try {
    await pool.query(`INSERT INTO users (username,email,phone,password_hash,role) VALUES ($1,$2,$3,$4,'student')`,
      [d.username, d.email, d.phone || null, await bcrypt.hash(d.password, 12)]);
  } catch (e) {
    if (e.code === '23505') return formErr(res, d, false, 'Username already exists.');
    throw e;
  }
  flash(req, 'success', 'Student added.');
  res.redirect('/admin/students');
});

admin.get('/students/:id/edit', async (req, res) => {
  const { rows } = await pool.query(`SELECT id,username,email,phone FROM users WHERE id=$1 AND role='student'`, [toId(req.params.id)]);
  if (!rows[0]) return res.status(404).render('error', { msg: 'Student not found' });
  res.render('admin/student_form', { s: rows[0], editing: true });
});
admin.post('/students/:id/edit', async (req, res) => {
  const id = toId(req.params.id), { d, err } = validateStudent(req.body, false);
  if (err) return formErr(res, { ...d, id }, true, err);
  try {
    const r = await pool.query(
      `UPDATE users SET username=$1,email=$2,phone=$3,password_hash=COALESCE($4,password_hash) WHERE id=$5 AND role='student'`,
      [d.username, d.email, d.phone || null, d.password ? await bcrypt.hash(d.password, 12) : null, id]);
    if (!r.rowCount) return res.status(404).render('error', { msg: 'Student not found' });
  } catch (e) {
    if (e.code === '23505') return formErr(res, { ...d, id }, true, 'Username already exists.');
    throw e;
  }
  flash(req, 'success', 'Student updated.');
  res.redirect('/admin/students');
});
admin.post('/students/:id/delete', async (req, res) => {
  await pool.query(`DELETE FROM users WHERE id=$1 AND role='student'`, [toId(req.params.id)]);
  flash(req, 'success', 'Student deleted.');
  res.redirect('/admin/students');
});

admin.get('/results.csv', async (req, res) => {
  const { rows } = await pool.query(`SELECT u.username,c.title,r.marks FROM results r JOIN users u ON u.id=r.student_id
    JOIN courses c ON c.id=r.course_id ORDER BY u.username,c.title`);
  csv(res, 'results.csv', ['Student', 'Course', 'Marks', 'Grade'], rows.map(r => [r.username, r.title, r.marks, grade(r.marks)]));
});
admin.get('/results', async (req, res) => {
  const [students, courses, rows] = await Promise.all([
    pool.query(`SELECT id,username FROM users WHERE role='student' ORDER BY username`),
    pool.query('SELECT id,title FROM courses ORDER BY title'),
    pool.query(`SELECT r.id,r.marks,u.username,c.title FROM results r JOIN users u ON u.id=r.student_id
                JOIN courses c ON c.id=r.course_id ORDER BY u.username,c.title`)]);
  res.render('admin/results', { students: students.rows, courses: courses.rows, rows: rows.rows });
});
admin.post('/results', async (req, res) => {
  const sid = toId(req.body.student_id), cid = toId(req.body.course_id), m = Number(req.body.marks);
  if (!sid || !cid || !Number.isInteger(m) || m < 0 || m > 100) flash(req, 'error', 'Select student, course and marks (0-100).');
  else {
    await pool.query(`INSERT INTO results (student_id,course_id,marks) VALUES ($1,$2,$3)
      ON CONFLICT (student_id,course_id) DO UPDATE SET marks=EXCLUDED.marks`, [sid, cid, m]);
    flash(req, 'success', 'Result saved.');
  }
  res.redirect('/admin/results');
});
admin.post('/results/:id/delete', async (req, res) => {
  await pool.query('DELETE FROM results WHERE id=$1', [toId(req.params.id)]);
  flash(req, 'success', 'Result deleted.');
  res.redirect('/admin/results');
});
// ----- attendance -----
const validDay = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d;
admin.get('/attendance', async (req, res) => {
  const { rows: courses } = await pool.query('SELECT id,title FROM courses ORDER BY title');
  const cid = toId(req.query.course) || (courses[0] && courses[0].id) || null;
  const day = validDay(req.query.date) ? req.query.date : new Date().toISOString().slice(0, 10);
  const students = cid ? (await pool.query(
    `SELECT u.id,u.username,a.present FROM users u LEFT JOIN attendance a ON a.student_id=u.id AND a.course_id=$1 AND a.day=$2
     WHERE u.role='student' ORDER BY u.username`, [cid, day])).rows : [];
  res.render('admin/attendance', { title: 'Attendance', courses, cid, day, students });
});
admin.post('/attendance', async (req, res) => {
  const cid = toId(req.body.course_id), day = req.body.date;
  if (!cid || !validDay(day)) { flash(req, 'error', 'Choose a course and a valid date.'); return res.redirect('/admin/attendance'); }
  const present = [].concat(req.body.present || []).map(Number).filter(Number.isInteger);
  const { rows } = await pool.query(`SELECT id FROM users WHERE role='student'`);
  await pool.query(`INSERT INTO attendance (student_id,course_id,day,present)
    SELECT s, $1, $2::date, s = ANY($3::int[]) FROM unnest($4::int[]) s
    ON CONFLICT (student_id,course_id,day) DO UPDATE SET present=EXCLUDED.present`, [cid, day, present, rows.map(r => r.id)]);
  flash(req, 'success', `Attendance saved for ${day}.`);
  res.redirect(`/admin/attendance?course=${cid}&date=${day}`);
});

// ----- teachers (admin only) -----
admin.get('/teachers', async (req, res) => {
  const { rows } = await pool.query(`SELECT id,username,email,phone,approved,created_at FROM users WHERE role='teacher' ORDER BY approved, id DESC`);
  res.render('admin/teachers', { title: 'Teachers', rows });
});
admin.post('/teachers/:id/approve', async (req, res) => {
  await pool.query(`UPDATE users SET approved=true WHERE id=$1 AND role='teacher'`, [toId(req.params.id)]);
  flash(req, 'success', 'Teacher approved.');
  res.redirect('/admin/teachers');
});
admin.post('/teachers/:id/delete', async (req, res) => {
  await pool.query(`DELETE FROM users WHERE id=$1 AND role='teacher'`, [toId(req.params.id)]);
  flash(req, 'success', 'Teacher removed.');
  res.redirect('/admin/teachers');
});

// ----- courses -----
admin.get('/courses', async (req, res) => {
  const { rows } = await pool.query(`SELECT c.*, count(r.id)::int AS n FROM courses c LEFT JOIN results r ON r.course_id=c.id GROUP BY c.id ORDER BY c.id`);
  res.render('admin/courses', { rows });
});
const saveCourse = async (req, res, id) => {
  const t = str(req.body.title).slice(0, 100), d = str(req.body.description).slice(0, 500);
  if (t.length < 2) flash(req, 'error', 'Course title is too short.');
  else try {
    if (id) await pool.query('UPDATE courses SET title=$1,description=$2 WHERE id=$3', [t, d, id]);
    else await pool.query('INSERT INTO courses (title,description) VALUES ($1,$2)', [t, d]);
    flash(req, 'success', id ? 'Course updated.' : 'Course added.');
  } catch (e) { if (e.code === '23505') flash(req, 'error', 'A course with this title exists.'); else throw e; }
  res.redirect('/admin/courses');
};
admin.post('/courses', (req, res) => saveCourse(req, res, null));
admin.post('/courses/:id/update', (req, res) => saveCourse(req, res, toId(req.params.id)));
admin.post('/courses/:id/delete', async (req, res) => {
  await pool.query('DELETE FROM courses WHERE id=$1', [toId(req.params.id)]);
  flash(req, 'success', 'Course deleted.');
  res.redirect('/admin/courses');
});

// ----- announcements -----
admin.get('/announcements', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC');
  res.render('admin/announcements', { rows });
});
admin.post('/announcements', async (req, res) => {
  const t = str(req.body.title).slice(0, 120), b = str(req.body.body).slice(0, 2000);
  if (t.length < 3 || b.length < 3) flash(req, 'error', 'Title and message are required.');
  else { await pool.query('INSERT INTO announcements (title,body) VALUES ($1,$2)', [t, b]); flash(req, 'success', 'Announcement published.'); }
  res.redirect('/admin/announcements');
});
admin.post('/announcements/:id/delete', async (req, res) => {
  await pool.query('DELETE FROM announcements WHERE id=$1', [toId(req.params.id)]);
  res.redirect('/admin/announcements');
});
app.use('/admin', admin);

// ---------- teacher ----------
app.get('/teacher', need('teacher'), async (req, res) => {
  const [c, news] = await Promise.all([
    pool.query(`SELECT (SELECT count(*) FROM users WHERE role='student')::int AS students,
      (SELECT count(*) FROM courses)::int AS courses, (SELECT count(*) FROM results)::int AS results`),
    pool.query('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 5')]);
  res.render('teacher/home', { title: 'Teacher', s: c.rows[0], news: news.rows });
});

// ---------- student ----------
const GP = { 'A+': 4, A: 3.75, 'A-': 3.5, B: 3, C: 2, D: 1, F: 0 };
const me = need('student'), prof = need(['student', 'teacher', 'admin']);
app.get('/student', me, async (req, res) => {
  const id = req.session.user.id;
  const [courses, results, news, rk] = await Promise.all([
    pool.query('SELECT * FROM courses ORDER BY id'),
    pool.query(`SELECT c.title,r.marks FROM results r JOIN courses c ON c.id=r.course_id WHERE r.student_id=$1 ORDER BY c.title`, [id]),
    pool.query('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 5'),
    pool.query(`SELECT pos::int, total::int FROM (SELECT student_id, rank() OVER (ORDER BY avg(marks) DESC) AS pos,
      count(*) OVER () AS total FROM results GROUP BY student_id) t WHERE student_id=$1`, [id])]);
  const att = (await pool.query(`SELECT c.title, count(*)::int AS total, count(*) FILTER (WHERE a.present)::int AS pres
    FROM attendance a JOIN courses c ON c.id=a.course_id WHERE a.student_id=$1 GROUP BY c.id ORDER BY c.title`, [id])).rows;
  const rows = results.rows.map(r => ({ ...r, grade: grade(r.marks) }));
  const avg = rows.length ? rows.reduce((a, r) => a + r.marks, 0) / rows.length : null;
  const gpa = rows.length ? rows.reduce((a, r) => a + GP[r.grade], 0) / rows.length : null;
  res.render('student/home', { att, courses: courses.rows, rows, avg, gpa, news: news.rows, rank: rk.rows[0] || null });
});
app.get('/student/profile', prof, async (req, res) => {
  const { rows } = await pool.query('SELECT username,email,phone,created_at FROM users WHERE id=$1', [req.session.user.id]);
  res.render('student/profile', { p: rows[0] });
});
app.post('/student/profile', prof, async (req, res) => {
  const email = str(req.body.email), phone = str(req.body.phone);
  if (!isEmail(email) || !isPhone(phone)) flash(req, 'error', 'Enter a valid email and phone.');
  else { await pool.query('UPDATE users SET email=$1,phone=$2 WHERE id=$3', [email, phone || null, req.session.user.id]); flash(req, 'success', 'Profile updated.'); }
  res.redirect('/student/profile');
});
app.post('/student/password', prof, async (req, res) => {
  const { current = '', next = '', confirm = '' } = req.body;
  const { rows: [u] } = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.session.user.id]);
  if (!(await bcrypt.compare(String(current), u.password_hash))) flash(req, 'error', 'Current password is wrong.');
  else if (String(next).length < 8) flash(req, 'error', 'New password must be at least 8 characters.');
  else if (next !== confirm) flash(req, 'error', 'Passwords do not match.');
  else { await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(String(next), 12), req.session.user.id]); flash(req, 'success', 'Password changed.'); }
  res.redirect('/student/profile');
});

// ---------- errors ----------
app.use((req, res) => res.status(404).render('error', { msg: 'Page not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { msg: 'Something went wrong. Please try again.' });
});

module.exports = app;
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`EasyLearn Hub running on http://localhost:${port}`));
}
