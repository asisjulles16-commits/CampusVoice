-- CampusVoice database schema
-- 1) Create an empty database first (phpMyAdmin > New > "campusvoice", utf8mb4_unicode_ci)
-- 2) Select it, open the Import tab (or the SQL tab) and run this file.

CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(80)  NOT NULL,
  student_id    VARCHAR(40)  NOT NULL,
  email         VARCHAR(120) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('student','admin') NOT NULL DEFAULT 'student',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_student_id (student_id),
  UNIQUE KEY uq_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ideas (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  author_id        INT NOT NULL,
  title            VARCHAR(100) NOT NULL,
  category         ENUM('Event','Canteen','Library','Facilities','Academics','Other') NOT NULL,
  description      TEXT NOT NULL,
  photo            VARCHAR(255) NOT NULL DEFAULT '',
  anonymous        TINYINT(1) NOT NULL DEFAULT 0,
  status           ENUM('Open','Under Review','Approved','Rejected','Implemented') NOT NULL DEFAULT 'Open',
  rejection_reason TEXT NULL,
  admin_note       TEXT NULL,
  internal_note    TEXT NULL,
  priority         TINYINT(1) NOT NULL DEFAULT 0,
  proof_photo      VARCHAR(255) NOT NULL DEFAULT '',
  implemented_date DATE NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_status (status),
  KEY idx_category (category),
  CONSTRAINT fk_ideas_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS votes (
  idea_id INT NOT NULL,
  user_id INT NOT NULL,
  choice  ENUM('Agree','Disagree') NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (idea_id, user_id),
  CONSTRAINT fk_votes_idea FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE CASCADE,
  CONSTRAINT fk_votes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS comments (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  idea_id    INT NOT NULL,
  user_id    INT NOT NULL,
  text       VARCHAR(500) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_comment_idea (idea_id),
  CONSTRAINT fk_comments_idea FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  message    TEXT NOT NULL,
  idea_id    INT NULL,
  is_read    TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_notif_user (user_id, is_read),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notif_idea FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The admin account (admin@school.edu / Admin123!) is created automatically
-- the first time the site is opened. Change the password in config.php BEFORE that.
