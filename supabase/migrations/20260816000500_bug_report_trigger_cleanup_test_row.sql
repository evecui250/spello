-- Removes the row inserted while manually verifying the
-- on_bug_report_insert trigger right after creating it.
delete from public.bug_reports where page_path = '/test-trigger';
