-- Storage bucket for word document uploads
INSERT INTO storage.buckets (id, name, public)
VALUES ('book-uploads', 'book-uploads', false)
ON CONFLICT (id) DO NOTHING;

-- RLS policies: each user owns their own folder (auth.uid() = first folder name)
CREATE POLICY "users can read own uploads"
ON storage.objects FOR SELECT
USING (bucket_id = 'book-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "users can upload to own folder"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'book-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "users can delete own uploads"
ON storage.objects FOR DELETE
USING (bucket_id = 'book-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);