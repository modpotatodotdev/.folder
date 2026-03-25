-- Migration: add nullable last_modified_at to namespaces
-- Stores unix timestamp (seconds) of last edit. NULL = never edited.
-- Nullable to avoid bloating rows that haven't been modified.
-- 2-week cooldown enforced at the API layer, not the DB.

ALTER TABLE namespaces ADD COLUMN last_modified_at INTEGER;
