-- Migration: 003_create_message_logs
CREATE TABLE IF NOT EXISTS message_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  session_id VARCHAR(100) NOT NULL,
  message_id VARCHAR(255) NOT NULL,
  direction ENUM('IN', 'OUT') NOT NULL,
  sender VARCHAR(50) DEFAULT NULL,
  receiver VARCHAR(50) DEFAULT NULL,
  message_type VARCHAR(50) NOT NULL,
  message_text LONGTEXT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session_id (session_id),
  INDEX idx_message_id (message_id),
  INDEX idx_direction (direction),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
