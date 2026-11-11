-- Password change logs out every device: tokens issued before this time are refused
-- (middleware/auth.ts). Set by POST /auth/change-password and by an admin password reset.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
