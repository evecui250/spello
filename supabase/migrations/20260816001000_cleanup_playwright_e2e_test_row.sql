-- Removes the row inserted while confirming the on_bug_report_insert
-- trigger fires correctly via the real app UI (not just a raw SQL
-- insert) end to end.
delete from public.bug_reports where message like 'LIVE END-TO-END TEST from the real app UI%';
