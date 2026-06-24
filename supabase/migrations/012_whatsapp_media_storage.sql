-- ============================================================
-- 012_whatsapp_media_storage.sql
--
-- Creates the `chat-media` Supabase Storage bucket and RLS policies
-- that allow users to store and retrieve media sent via WhatsApp.
--
-- File path convention:
--   chat-media/{auth.uid()}/{random-uuid-or-timestamp-and-filename}
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-media',
  'chat-media',
  TRUE,
  15728640, -- 15 MB
  NULL      -- Allow any file type, validated client-side
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Policies for public reading
DROP POLICY IF EXISTS "Chat media is publicly readable" ON storage.objects;
CREATE POLICY "Chat media is publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'chat-media');

-- Policies for uploading
DROP POLICY IF EXISTS "Users can upload their own chat media" ON storage.objects;
CREATE POLICY "Users can upload their own chat media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'chat-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Policies for deleting
DROP POLICY IF EXISTS "Users can delete their own chat media" ON storage.objects;
CREATE POLICY "Users can delete their own chat media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'chat-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
