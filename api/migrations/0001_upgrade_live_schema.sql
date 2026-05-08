-- Migration history note:
-- 0000_init.sql was rebased to include the schema additions that 0001 originally
-- introduced for the first hosted rollout. Keeping 0001 as a no-op preserves the
-- existing remote migration journal while allowing fresh local databases to apply
-- the full chain without duplicate-column failures.
SELECT 1;
