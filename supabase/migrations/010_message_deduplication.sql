-- ============================================================
-- 010_message_deduplication.sql — message deduplication
--
-- Safely deduplicates existing records and enforces a unique
-- constraint on messages.message_id.
-- ============================================================

BEGIN;

-- 1. Safely remove duplicate messages, preserving the oldest record.
DELETE FROM public.messages
WHERE id IN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY message_id 
             ORDER BY created_at ASC, id ASC
           ) as row_num
    FROM public.messages
    WHERE message_id IS NOT NULL
  ) t
  WHERE t.row_num > 1
);

-- 2. Add the unique constraint on message_id
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS unique_messages_message_id;
ALTER TABLE public.messages ADD CONSTRAINT unique_messages_message_id UNIQUE (message_id);

COMMIT;
