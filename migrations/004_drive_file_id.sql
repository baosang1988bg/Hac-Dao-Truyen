-- Legacy databases only. Prefer tools/migrate_schema.py preflight for databases
-- where this column may already have been added manually.
ALTER TABLE novels ADD COLUMN drive_file_id TEXT DEFAULT '';
