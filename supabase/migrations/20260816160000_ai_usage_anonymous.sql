-- Lets a signed-out learner use the AI translate exercise too (testing
-- phase — see correct-sentence/generate-sentence for the anonymous rate-
-- limiting this enables). user_id can no longer be NOT NULL now that a
-- row might represent an anonymous caller; ip_address is the rate-limit
-- key for that case (there's no user_id to count against).
alter table public.ai_usage alter column user_id drop not null;
alter table public.ai_usage add column if not exists ip_address inet;
