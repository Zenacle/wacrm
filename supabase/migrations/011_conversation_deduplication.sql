-- ============================================================
-- 011_conversation_deduplication.sql — conversation deduplication
--
-- Safely merges duplicate conversation rows, preserving child
-- messages, deals, and reactions, keeping the oldest conversation,
-- and enforcing UNIQUE(user_id, contact_id).
-- ============================================================

BEGIN;

-- 1. Move messages to the oldest conversation for each user-contact pair
WITH conversation_rankings AS (
  SELECT id,
         user_id,
         contact_id,
         FIRST_VALUE(id) OVER (
           PARTITION BY user_id, contact_id 
           ORDER BY created_at ASC, id ASC
         ) as primary_conv_id
  FROM public.conversations
)
UPDATE public.messages
SET conversation_id = rankings.primary_conv_id
FROM conversation_rankings rankings
WHERE messages.conversation_id = rankings.id
  AND rankings.id != rankings.primary_conv_id;

-- 2. Move deals to the oldest conversation
WITH conversation_rankings AS (
  SELECT id,
         user_id,
         contact_id,
         FIRST_VALUE(id) OVER (
           PARTITION BY user_id, contact_id 
           ORDER BY created_at ASC, id ASC
         ) as primary_conv_id
  FROM public.conversations
)
UPDATE public.deals
SET conversation_id = rankings.primary_conv_id
FROM conversation_rankings rankings
WHERE deals.conversation_id = rankings.id
  AND rankings.id != rankings.primary_conv_id;

-- 3. Move message_reactions to the oldest conversation
WITH conversation_rankings AS (
  SELECT id,
         user_id,
         contact_id,
         FIRST_VALUE(id) OVER (
           PARTITION BY user_id, contact_id 
           ORDER BY created_at ASC, id ASC
         ) as primary_conv_id
  FROM public.conversations
)
UPDATE public.message_reactions
SET conversation_id = rankings.primary_conv_id
FROM conversation_rankings rankings
WHERE message_reactions.conversation_id = rankings.id
  AND rankings.id != rankings.primary_conv_id;

-- 4. Delete the duplicate conversations (preserving only the oldest one)
DELETE FROM public.conversations
WHERE id IN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY user_id, contact_id 
             ORDER BY created_at ASC, id ASC
           ) as row_num
    FROM public.conversations
  ) t
  WHERE t.row_num > 1
);

-- 5. Add unique constraint on (user_id, contact_id)
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS unique_conversations_user_id_contact_id;
ALTER TABLE public.conversations ADD CONSTRAINT unique_conversations_user_id_contact_id UNIQUE (user_id, contact_id);

COMMIT;
