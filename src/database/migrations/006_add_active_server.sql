-- Migration: 006_add_active_server
ALTER TABLE whatsapp_sessions
  ADD COLUMN active_server VARCHAR(255) DEFAULT NULL AFTER pairing_code_enabled,
  ADD INDEX idx_active_server (active_server);
