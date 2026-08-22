-- Removes rows written by this session's own verification testing (real
-- Playwright/local-build runs against the live project -- same reasoning
-- as the earlier "cleanup_playwright_e2e_test_row"/"cleanup_dev_testing_
-- usage_pings" migrations): a fake usage_pings row seeded with a
-- deliberately-impossible ping_date, and a game_plays row from an actual
-- end-to-end game-completion test.
delete from public.usage_pings where device_id = '00000000-0000-0000-0000-00000000dead';
delete from public.game_plays where device_id in ('00000000-0000-0000-0000-00000000dead', '4d12c5d5-c855-4119-9956-6d7afedf0322');
