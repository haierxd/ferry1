-- Run in MYSQL_DB (select the database through your client connection).
-- No DROP/TRUNCATE, compatible with the existing test2 login/conversation schema.
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(32) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  company VARCHAR(120) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS conversations (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  title VARCHAR(200) DEFAULT NULL,
  question TEXT NOT NULL,
  answer LONGTEXT NOT NULL,
  model VARCHAR(255) DEFAULT NULL,
  tokens INT DEFAULT NULL,
  citations JSON DEFAULT NULL,
  response_id TEXT DEFAULT NULL,
  response_model TEXT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user_created (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- For an existing conversations table, run: npm run migrate:mysql
-- CREATE TABLE IF NOT EXISTS does not add columns to an existing table.
