-- Migration: 004_create_webhook_logs
CREATE TABLE IF NOT EXISTS webhook_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  session_id VARCHAR(100) NOT NULL,
  event VARCHAR(100) NOT NULL,
  webhook_url TEXT NOT NULL,
  payload LONGTEXT NOT NULL,
  status ENUM('success', 'failed', 'pending') NOT NULL DEFAULT 'pending',
  response_code INT DEFAULT NULL,
  response_body TEXT DEFAULT NULL,
  attempts INT NOT NULL DEFAULT 1,
  error_message TEXT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session_id (session_id),
  INDEX idx_event (event),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
