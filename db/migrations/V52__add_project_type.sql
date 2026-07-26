-- migrations/xxxx_normalize_upload_schedule_type.sql
--
-- UPLOAD is no longer stored as a distinct schedule_type — it's now just
-- SCHEDULE (populated from a file instead of typed by hand). Normalize
-- any existing rows so schedule_type only ever contains 'SCHEDULE' or
-- 'MILESTONE' going forward.

UPDATE projects SET schedule_type = 'SCHEDULE' WHERE schedule_type = 'UPLOAD';