-- Removes the handful of rows inserted while manually verifying the
-- bug_reports table/RLS policy right after creating it.
delete from public.bug_reports
where message like '%safe to delete%' or page_path = '/test';
