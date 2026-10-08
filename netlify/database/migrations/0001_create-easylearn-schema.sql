CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(30)  NOT NULL UNIQUE,
  email         VARCHAR(120) NOT NULL,
  phone         VARCHAR(20),
  password_hash TEXT         NOT NULL,
  role          VARCHAR(10)  NOT NULL CONSTRAINT users_role_check CHECK (role IN ('admin','student','teacher')),
  approved      BOOLEAN      NOT NULL DEFAULT true,
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
  status     VARCHAR(10) NOT NULL DEFAULT 'pending'
             CONSTRAINT admissions_status_check CHECK (status IN ('pending','accepted','rejected','enrolled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS results (
  id         SERIAL PRIMARY KEY,
  student_id INT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  course_id  INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  marks      INT NOT NULL CHECK (marks BETWEEN 0 AND 100),
  UNIQUE (student_id, course_id)
);
CREATE TABLE IF NOT EXISTS announcements (
  id         SERIAL PRIMARY KEY,
  title      VARCHAR(120) NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS attendance (
  id         SERIAL PRIMARY KEY,
  student_id INT  NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  course_id  INT  NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  day        DATE NOT NULL,
  present    BOOLEAN NOT NULL,
  UNIQUE (student_id, course_id, day)
);
-- login sessions (connect-pg-simple)
CREATE TABLE IF NOT EXISTS "session" (
  "sid"    VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  "sess"   JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
-- app settings (e.g. auto-generated session secret)
CREATE TABLE IF NOT EXISTS settings (
  key   VARCHAR(50) PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO courses (title, description, image) VALUES
 ('Web Development','HTML, CSS, JavaScript, Node.js and databases with real projects.','web_development.png'),
 ('Graphic Design','Branding, layout and visual communication with modern tools.','graphic_design.png'),
 ('Digital Marketing','SEO, social media marketing and online advertising.','digital_marketing.png')
ON CONFLICT (title) DO NOTHING;
