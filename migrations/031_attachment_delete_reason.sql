ALTER TABLE file_attachments ADD COLUMN deleted_at TEXT;
ALTER TABLE file_attachments ADD COLUMN deleted_by TEXT;
ALTER TABLE file_attachments ADD COLUMN delete_reason TEXT;
