-- The previous encryption configuration is no longer required. Legacy connections
-- must be authorized again; keep folder IDs so reconnecting reuses existing files.
UPDATE event_drive_connections
SET connection_status = 'reauth_required'
WHERE encrypted_refresh_token NOT LIKE 'v2.%';
