-- Backs "Save the report" on the Text to Pet summary screen (see
-- pet-chat-summary, pet-chat-save-report, pet-chat-list-reports,
-- app/mistakes/page.tsx's new "Conversations" tab). A learner who wants to
-- review a past conversation's recap later shouldn't need the AI to
-- regenerate it -- pet-chat-summary already computes the full recap once;
-- this just persists that same JSON onto the session row so a later list
-- view can read it straight back, cheaply, with no second AI call.
-- report_saved is a separate, explicit boolean (not inferred from summary
-- being non-null) because computing the summary happens automatically the
-- moment a session ends, but SAVING it into the learner's notebook is a
-- deliberate action they take on the summary screen -- most concluded
-- sessions will have a summary but never get saved.
alter table public.pet_chat_sessions add column if not exists summary jsonb;
alter table public.pet_chat_sessions add column if not exists report_saved boolean not null default false;
