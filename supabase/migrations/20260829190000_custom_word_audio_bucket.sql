-- Public storage bucket for AI-generated pronunciation audio of learner-
-- added custom words (see lib/storage.ts's custom-words section and the
-- new generate-word-audio Edge Function). The static corpus's own audio
-- lives under /public/audio (baked into the app bundle at build time via
-- an offline batch script -- see the audio-pipeline memory) -- that
-- approach can't work for a word a learner adds at runtime, so this is a
-- real, separate Storage bucket instead, written only by the Edge
-- Function's service-role key (never directly by a client) and readable
-- by anyone via its public URL, same as the static files are.
insert into storage.buckets (id, name, public)
values ('custom-word-audio', 'custom-word-audio', true)
on conflict (id) do nothing;

create policy "Public read access for custom word audio"
  on storage.objects for select
  using (bucket_id = 'custom-word-audio');
