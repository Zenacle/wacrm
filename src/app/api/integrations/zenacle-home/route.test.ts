import { vi, describe, it, expect, beforeEach } from 'vitest'
import { POST } from './route'
import { engineSendText } from '@/lib/automations/meta-send'

// Helper to create a chainable thenable mock for Supabase client
const createChain = (tableState: { data: any; error?: any }) => {
  const chain = {} as any
  const methods = ['select', 'eq', 'like', 'limit', 'maybeSingle', 'single', 'insert', 'update']
  methods.forEach((m) => {
    chain[m] = vi.fn().mockImplementation(() => chain)
  })
  chain.then = (onfulfilled: any) => Promise.resolve(tableState).then(onfulfilled)
  return chain
}

const mockFrom = vi.fn()

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: mockFrom,
  }),
}))

vi.mock('@/lib/automations/meta-send', () => ({
  engineSendText: vi.fn().mockResolvedValue({ whatsapp_message_id: 'fake-wamid-123' }),
}))

describe('Zenacle Home Integration API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRM_INTEGRATION_SECRET = 'test-secret'
  })

  // 1. Authorization checks
  it('returns 401 if Authorization header is missing', async () => {
    const req = new Request('http://localhost:3000/api/integrations/zenacle-home', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toContain('Unauthorized')
  })

  it('returns 401 if Authorization header format is invalid', async () => {
    const req = new Request('http://localhost:3000/api/integrations/zenacle-home', {
      method: 'POST',
      headers: { Authorization: 'Basic user:pass' },
      body: JSON.stringify({}),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 401 if secret token is invalid', async () => {
    const req = new Request('http://localhost:3000/api/integrations/zenacle-home', {
      method: 'POST',
      headers: { Authorization: 'Bearer invalid-token' },
      body: JSON.stringify({}),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  // 2. Input validation checks
  it('returns 400 if required payload parameters are missing', async () => {
    const req = new Request('http://localhost:3000/api/integrations/zenacle-home', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-secret' },
      body: JSON.stringify({
        report_id: 'rep-123',
        household_id: 'house-456',
        // report_date is missing
        recipient_name: 'Mohamed',
        phone: '9629566619',
        message: 'Hello!',
        delivery_type: 'daily_energy_report',
        source: 'zenacle_home',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('required')
  })

  // 3. Idempotency checks
  it('returns duplicate: true if report_id already exists in integration_delivery_log', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'integration_delivery_log') {
        return createChain({ data: { external_id: 'rep-123' } })
      }
      return createChain({ data: null })
    })

    const req = new Request('http://localhost:3000/api/integrations/zenacle-home', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-secret' },
      body: JSON.stringify({
        report_id: 'rep-123',
        household_id: 'house-456',
        report_date: '2026-06-25',
        recipient_name: 'Mohamed',
        phone: '9629566619',
        message: 'Hello!',
        delivery_type: 'daily_energy_report',
        source: 'zenacle_home',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({
      success: true,
      duplicate: true,
    })

    // Verify outbound sending engine was NOT called
    expect(engineSendText).not.toHaveBeenCalled()
  })

  // 4. Successful Flow: New Contact and New Conversation
  it('creates contact, conversation, sends message, logs status, and returns success details', async () => {
    const contactState = { data: [] as any }
    const convState = { data: null as any }
    const logState = { data: null as any }

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return createChain({ data: { user_id: 'test-user-uuid' } })
      if (table === 'contacts') {
        const chain = createChain(contactState)
        chain.insert = vi.fn().mockImplementation((val) => {
          contactState.data = { id: 'new-contact-uuid', ...val }
          return chain
        })
        return chain
      }
      if (table === 'conversations') {
        const chain = createChain(convState)
        chain.insert = vi.fn().mockImplementation((val) => {
          convState.data = { id: 'new-conv-uuid', ...val }
          return chain
        })
        return chain
      }
      if (table === 'messages') {
        return createChain({ data: { id: 'new-crm-message-uuid' } })
      }
      if (table === 'integration_delivery_log') {
        const chain = createChain(logState)
        chain.insert = vi.fn().mockImplementation((val) => {
          logState.data = { id: 'log-uuid', ...val }
          return chain
        })
        return chain
      }
      return createChain({ data: null })
    })

    const req = new Request('http://localhost:3000/api/integrations/zenacle-home', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-secret' },
      body: JSON.stringify({
        report_id: 'rep-123',
        household_id: 'house-456',
        report_date: '2026-06-25',
        recipient_name: 'Mohamed',
        phone: '9629566619',
        message: 'Hello Mohamed, here is your report!',
        delivery_type: 'daily_energy_report',
        source: 'zenacle_home',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({
      success: true,
      report_id: 'rep-123',
      contact_id: 'new-contact-uuid',
      conversation_id: 'new-conv-uuid',
      crm_message_id: 'new-crm-message-uuid',
      status: 'sent',
    })

    // Verify outbound sending engine was invoked correctly
    expect(engineSendText).toHaveBeenCalledWith({
      userId: 'test-user-uuid',
      conversationId: 'new-conv-uuid',
      contactId: 'new-contact-uuid',
      text: 'Hello Mohamed, here is your report!',
    })

    // Verify integration_delivery_log record was created correctly
    expect(logState.data).toEqual(
      expect.objectContaining({
        integration_source: 'zenacle_home',
        external_id: 'rep-123',
        delivery_type: 'daily_energy_report',
        contact_id: 'new-contact-uuid',
        crm_message_id: 'new-crm-message-uuid',
        meta_message_id: 'fake-wamid-123',
        status: 'sent',
        whatsapp_sent: true,
        error_message: null,
      })
    )
    expect(logState.data.metadata).toEqual({
      household_id: 'house-456',
      report_date: '2026-06-25',
      payload_version: 1,
    })
  })

  // 5. Contact Resolution Flow: Existing Contact (empty fields) and Existing Conversation
  it('reuses existing contact (updates empty name) and conversation', async () => {
    // Existing contact with no name
    const contactState = {
      data: [{ id: 'existing-contact-uuid', phone: '9629566619', name: null, email: null }] as any,
    }
    const convState = { data: { id: 'existing-conv-uuid' } }
    const logState = { data: null as any }

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return createChain({ data: { user_id: 'test-user-uuid' } })
      if (table === 'contacts') {
        const chain = createChain(contactState)
        chain.update = vi.fn().mockImplementation((val) => {
          const updated = { ...contactState.data[0], ...val }
          contactState.data = updated // Return single updated object
          return chain
        })
        return chain
      }
      if (table === 'conversations') {
        return createChain(convState)
      }
      if (table === 'messages') {
        return createChain({ data: { id: 'fake-crm-message-uuid' } })
      }
      if (table === 'integration_delivery_log') {
        const chain = createChain(logState)
        chain.insert = vi.fn().mockImplementation((val) => {
          logState.data = { id: 'log-uuid', ...val }
          return chain
        })
        return chain
      }
      return createChain({ data: null })
    })

    const req = new Request('http://localhost:3000/api/integrations/zenacle-home', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-secret' },
      body: JSON.stringify({
        report_id: 'rep-123',
        household_id: 'house-456',
        report_date: '2026-06-25',
        recipient_name: 'Mohamed',
        phone: '9629566619',
        message: 'Hello!',
        delivery_type: 'daily_energy_report',
        source: 'zenacle_home',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.contact_id).toBe('existing-contact-uuid')
    expect(json.conversation_id).toBe('existing-conv-uuid')

    // Verify contact name was updated
    expect(contactState.data.name).toBe('Mohamed')
  })

  // 6. Engine failure handling
  it('handles engine failure by writing status = failed and error_message to log, and returning 500', async () => {
    const contactState = { data: [] as any }
    const convState = { data: null as any }
    const logState = { data: null as any }

    // Mock engineSendText to reject/fail
    vi.mocked(engineSendText).mockRejectedValueOnce(new Error('Meta Connection Timeout'))

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return createChain({ data: { user_id: 'test-user-uuid' } })
      if (table === 'contacts') {
        const chain = createChain(contactState)
        chain.insert = vi.fn().mockImplementation((val) => {
          contactState.data = { id: 'new-contact-uuid', ...val }
          return chain
        })
        return chain
      }
      if (table === 'conversations') {
        const chain = createChain(convState)
        chain.insert = vi.fn().mockImplementation((val) => {
          convState.data = { id: 'new-conv-uuid', ...val }
          return chain
        })
        return chain
      }
      if (table === 'integration_delivery_log') {
        const chain = createChain(logState)
        chain.insert = vi.fn().mockImplementation((val) => {
          logState.data = { id: 'log-uuid', ...val }
          return chain
        })
        return chain
      }
      return createChain({ data: null })
    })

    const req = new Request('http://localhost:3000/api/integrations/zenacle-home', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-secret' },
      body: JSON.stringify({
        report_id: 'rep-123',
        household_id: 'house-456',
        report_date: '2026-06-25',
        recipient_name: 'Mohamed',
        phone: '9629566619',
        message: 'Hello!',
        delivery_type: 'daily_energy_report',
        source: 'zenacle_home',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.error).toBe('Meta Connection Timeout')
    expect(json.status).toBe('failed')

    // Verify failed log insertion
    expect(logState.data).toEqual(
      expect.objectContaining({
        integration_source: 'zenacle_home',
        external_id: 'rep-123',
        delivery_type: 'daily_energy_report',
        contact_id: 'new-contact-uuid',
        crm_message_id: null,
        meta_message_id: null,
        status: 'failed',
        whatsapp_sent: false,
        error_message: 'Meta Connection Timeout',
      })
    )
  })

  // 7. Database failure handling
  it('returns 500 when active profile retrieval fails', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return createChain({ data: null, error: { message: 'Database unreachable' } })
      }
      return createChain({ data: null })
    })

    const req = new Request('http://localhost:3000/api/integrations/zenacle-home', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-secret' },
      body: JSON.stringify({
        report_id: 'rep-123',
        household_id: 'house-456',
        report_date: '2026-06-25',
        recipient_name: 'Mohamed',
        phone: '9629566619',
        message: 'Hello!',
        delivery_type: 'daily_energy_report',
        source: 'zenacle_home',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toContain('No active CRM profiles found')
  })
})
