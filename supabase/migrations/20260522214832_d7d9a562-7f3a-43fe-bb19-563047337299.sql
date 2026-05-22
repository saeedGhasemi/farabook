ALTER TABLE public.highlights
  ADD COLUMN IF NOT EXISTS block_index INTEGER,
  ADD COLUMN IF NOT EXISTS occurrence INTEGER;

ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS cover_focus jsonb DEFAULT '{"x":50,"y":50}'::jsonb;