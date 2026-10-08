CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(30)  NOT NULL UNIQUE,
  email         VARCHAR(120) NOT NULL,
  phone         VARCHAR(20),
  password_hash TEXT         NOT NULL,
  role          VARCHAR(10)  NOT NULL CHECK (role IN ('admin','student')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS courses (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  image       VARCHAR(100)
);
CREATE TABLE IF NOT EXISTS admissions (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  email      VARCHAR(120) NOT NULL,
  phone      VARCHAR(20),
  message    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS results (
  id         SERIAL PRIMARY KEY,
  student_id INT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  course_id  INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  marks      INT NOT NULL CHECK (marks BETWEEN 0 AND 100),
  UNIQUE (student_id, course_id)
);
INSERT INTO courses (title, description, image) VALUES
 ('Web Development','HTML, CSS, JavaScript, Node.js and databases with real projects.','web_development.png'),
 ('Graphic Design','Branding, layout and visual communication with modern tools.','graphic_design.png'),
 ('Digital Marketing','SEO, social media marketing and online advertising.','digital_marketing.png')
ON CONFLICT (title) DO NOTHING;

-- v3 additions (safe to re-run)
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending','accepted','rejected'));
CREATE TABLE IF NOT EXISTS announcements (
  id         SERIAL PRIMARY KEY,
  title      VARCHAR(120) NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- v5 additions (safe to re-run)
ALTER TABLE admissions DROP CONSTRAINT IF EXISTS admissions_status_check;
ALTER TABLE admissions ADD CONSTRAINT admissions_status_check CHECK (status IN ('pending','accepted','rejected','enrolled'));
CREATE TABLE IF NOT EXISTS attendance (
  id         SERIAL PRIMARY KEY,
  student_id INT  NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  course_id  INT  NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  day        DATE NOT NULL,
  present    BOOLEAN NOT NULL,
  UNIQUE (student_id, course_id, day)
);

-- v6: teacher role + signup approval (safe to re-run)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','student','teacher'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT true;
