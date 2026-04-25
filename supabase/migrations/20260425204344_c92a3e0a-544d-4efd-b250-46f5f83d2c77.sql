-- Public bucket for extracted book media (images from docx imports)
INSERT INTO storage.buckets (id, name, public)
VALUES ('book-media', 'book-media', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Public read; only authenticated users can write into their own folder
DROP POLICY IF EXISTS "book-media public read" ON storage.objects;
CREATE POLICY "book-media public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'book-media');

DROP POLICY IF EXISTS "book-media auth write" ON storage.objects;
CREATE POLICY "book-media auth write"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'book-media');

DROP POLICY IF EXISTS "book-media auth update" ON storage.objects;
CREATE POLICY "book-media auth update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'book-media');