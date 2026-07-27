-- Migration: 006_add_disconnected_at
ALTER TABLE whatsapp_sessions
  ADD COLUMN disconnected_at DATETIME DEFAULT NULL AFTER updated_at;
