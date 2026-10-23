-- Run in zhixu_ai. Compatible with MySQL 5.7 and 8.0; preserves existing data.
USE zhixu_ai;

CREATE TABLE IF NOT EXISTS conversations (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  title VARCHAR(200) DEFAULT NULL,
  question TEXT NOT NULL,
  answer LONGTEXT NOT NULL,
  model VARCHAR(100) DEFAULT NULL,
  tokens INT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user_created (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
