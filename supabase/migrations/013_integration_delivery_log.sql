-- ============================================================
-- 013_integration_delivery_log.sql — Integration Delivery Log
--
-- Declares the schema for recording status and ensuring idempotency
-- of daily snapshots and reports sent from external integrations.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.integration_delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  delivery_type TEXT NOT NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  crm_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  meta_message_id TEXT,
  status TEXT NOT NULL,
  whatsapp_sent BOOLEAN NOT NULL DEFAULT FALSE,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(integration_source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_integration_delivery_log_source_id ON public.integration_delivery_log(integration_source, external_id);
CREATE INDEX IF NOT EXISTS idx_integration_delivery_log_contact ON public.integration_delivery_log(contact_id);

ALTER TABLE public.integration_delivery_log ENABLE ROW LEVEL SECURITY;

-- Select policy allows authenticated users to view logs for contacts they own
DROP POLICY IF EXISTS "Users can view own integration logs" ON public.integration_delivery_log;
CREATE POLICY "Users can view own integration logs" ON public.integration_delivery_log FOR SELECT
  USING (EXISTS (SELECT 1 FROM contacts WHERE contacts.id = integration_delivery_log.contact_id AND contacts.user_id = auth.uid()));
