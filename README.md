# EasyLearn Hub (Node.js + PostgreSQL)

Rewrite of the PHP/MySQL Student Management System.

## Setup
1. Install Node 18+ and PostgreSQL. Create a DB: `createdb easylearn`
2. `cp .env.example .env` and edit `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_PASSWORD`
3. `npm install`
4. `npm run db:init`  (creates tables, 3 courses, and the admin user)
5. (optional) `npm run db:seed` → demo students/results (login `rahim` / `Student123!`)
6. `npm start` → http://localhost:3000  (login at `/login`)

## Fixed vs. old version
- SQL injection → parameterized queries · plain passwords → bcrypt hashes (never displayed)
- Auth guard on every admin/student route, role-based, delete via POST + CSRF token
- XSS-safe output (EJS escaping + CSP via helmet) · login rate-limit · session fixation protection
- Results linked by `student_id` (FK) not by name · working admission delete · server-side validation
- Login message now shows · single DB config · new: dashboard stats, student search, result entry with grades

## v3 features
- New glass/gradient theme, dark/light toggle, sidebar dashboards, print-friendly result card
- Admin: dashboard charts, admission accept/reject + filter, student pagination/search/avg marks, CSV export (students, results), course CRUD, announcements
- Student: GPA, rank, announcements, profile + password change
- Upgrading from v2: just run `npm run db:init` again (migration is idempotent)

## v5: sell-ready
- **Rebrand with `.env` only**: `INSTITUTE_NAME`, `TAGLINE`, `CONTACT_*` change the whole site (no code edits)
- **Docker**: `docker compose up --build` → http://localhost:3000 (db + app + auto-migrate)
- Attendance module (admin marks per course/day, students see % with 75% warning)
- One-click **Enroll** of an admission → student account with a one-time temporary password
- Landing page: stats, features, testimonials, FAQ, CTA · `/healthz` endpoint · favicon
- **Restart the server after updating** (`npm run dev` auto-restarts)

## v6: signup + teacher role
- `/signup` for students (instant access) and teachers (**admin must approve** in Admin → Teachers)
- Teacher portal: attendance, results, announcements, profile. Teachers cannot touch students, courses, admissions or other teachers
- The role is validated on the server, so tampering with the form cannot create an admin
- Upgrading: run `npm run db:init` once (idempotent migration), then restart the server

## Default admin
`admin` / `admin` (set by `.env`; see `.env.example`). Already have a database with a different admin password? Run `npm run admin:reset`.
**Change the password (Profile page) before giving the site to a customer.**
