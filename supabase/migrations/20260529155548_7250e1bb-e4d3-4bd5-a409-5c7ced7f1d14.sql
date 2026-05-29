-- Create public bucket for user-uploaded ambient audio (max 20MB per file)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'user-ambient',
  'user-ambient',
  true,
  20971520,
  ARRAY['audio/mpeg','audio/mp3','audio/wav','audio/ogg','audio/x-wav','audio/webm','audio/mp4','audio/aac','audio/flac']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Anyone can read (so <audio> tag can fetch without signed URLs)
CREATE POLICY "user_ambient_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'user-ambient');

-- Authenticated users can upload to their own folder
CREATE POLICY "user_ambient_insert_own"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'user-ambient'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Authenticated users can update their own files
CREATE POLICY "user_ambient_update_own"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'user-ambient'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Authenticated users can delete their own files
CREATE POLICY "user_ambient_delete_own"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'user-ambient'
  AND auth.uid()::text = (storage.foldername(name))[1]
);