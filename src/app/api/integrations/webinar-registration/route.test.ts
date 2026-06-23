import { vi, describe, it, expect, beforeEach } from 'vitest'
import { POST } from './route'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'

// Helper to create a chainable thenable mock for Supabase client
const createChain = (tableState: { data: any; error?: any }) => {
  const chain = {} as any
  const methods = ['select', 'eq', 'like', 'limit', 'maybeSingle', 'single', 'insert', 'update', 'upsert']
  methods.forEach((m) => {
    chain[m] = vi.fn().mockImplementation(() => chain)
  })
  chain.then = (onfulfilled: any) => Promise.resolve(tableState).then(onfulfilled)
  return chain
}

// Variables starting with 'mock' are hoisted in vitest vi.mock calls
const mockFrom = vi.fn()

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: mockFrom,
  }),
}))

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTemplateMessage: vi.fn().mockResolvedValue({ messageId: 'fake-wamid-123' }),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn((token) => token),
}))

describe('Webinar Registration API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.INTEGRATION_SECRET = 'test-secret'
  })

  // 1. Authorization checks
  it('returns 401 if Authorization header is missing', async () => {
    const req = new Request('http://localhost:3000/api/integrations/webinar-registration', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toContain('Unauthorized')
  })

  it('returns 401 if Authorization header does not start with Bearer', async () => {
    const req = new Request('http://localhost:3000/api/integrations/webinar-registration', {
      method: 'POST',
      headers: { Authorization: 'Basic user:pass' },
      body: JSON.stringify({}),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 401 if token does not match INTEGRATION_SECRET', async () => {
    const req = new Request('http://localhost:3000/api/integrations/webinar-registration', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-secret' },
      body: JSON.stringify({}),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  // 2. Input validation checks
  it('returns 400 if required parameters are missing', async () => {
    const req = new Request('http://localhost:3000/api/integrations/webinar-registration', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-secret' },
      body: JSON.stringify({
        registration_id: 'reg-123',
        full_name: 'John Doe',
        // phone is missing
        workshop_batch: 'July 05 2026',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('required')
  })

  // 3. Main registration flow: New contact creation
  it('creates contact, links tags, sends WhatsApp template and returns success', async () => {
    const contactState = { data: [] as any }
    const tagState = { data: null as any }
    const noteState = { data: [] as any }
    const convState = { data: null as any }

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return createChain({ data: { user_id: 'test-user-id' } })
      if (table === 'contacts') {
        const chain = createChain(contactState)
        chain.insert = vi.fn().mockImplementation((val) => {
          contactState.data = { id: 'new-contact-uuid', ...val }
          return chain
        })
        return chain
      }
      if (table === 'tags') {
        const chain = createChain(tagState)
        chain.insert = vi.fn().mockImplementation((val) => {
          tagState.data = { id: 'tag-uuid', ...val }
          return chain
        })
        return chain
      }
      if (table === 'contact_notes') {
        const chain = createChain(noteState)
        chain.insert = vi.fn().mockImplementation((val) => {
          noteState.data = { id: 'note-uuid', ...val }
          return chain
        })
        return chain
      }
      if (table === 'conversations') {
        const chain = createChain(convState)
        chain.insert = vi.fn().mockImplementation((val) => {
          convState.data = { id: 'conv-uuid', ...val }
          return chain
        })
        return chain
      }
      if (table === 'whatsapp_config') return createChain({ data: { phone_number_id: 'test-phone-id', access_token: 'test-token', status: 'connected' } })
      return createChain({ data: null })
    })

    const req = new Request('http://localhost:3000/api/integrations/webinar-registration', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-secret' },
      body: JSON.stringify({
        registration_id: 'reg-123',
        full_name: 'John Doe',
        phone: '+91 96295 66619',
        email: 'john@example.com',
        workshop_batch: 'July 05 2026',
        payment_status: 'paid',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.contact_id).toBe('new-contact-uuid')
    expect(json.whatsapp_sent).toBe(true)

    // Verify WhatsApp template message was sent
    expect(sendTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        templateName: 'registration_confirmation',
        to: '919629566619',
        params: ['John Doe'],
      })
    )
  })

  // 4. Contact updating logic
  it('updates name/email of existing contact if they are empty', async () => {
    // Contact exists with empty name/email
    const contactState = {
      data: [{ id: 'existing-contact-uuid', phone: '919629566619', name: null, email: null }] as any
    }
    const tagState = { data: { id: 'tag-uuid', name: 'Webinar Registered' } }
    const noteState = { data: [] as any }
    const convState = { data: { id: 'conv-uuid' } }

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return createChain({ data: { user_id: 'test-user-id' } })
      if (table === 'contacts') {
        const chain = createChain(contactState)
        chain.update = vi.fn().mockImplementation((val) => {
          // If we had a list, update the contact in it
          const updatedContact = { ...contactState.data[0], ...val }
          contactState.data = updatedContact // POST handler expects a single contact returned by select().single() after update
          return chain
        })
        return chain
      }
      if (table === 'tags') return createChain(tagState)
      if (table === 'contact_notes') {
        const chain = createChain(noteState)
        chain.insert = vi.fn().mockImplementation((val) => {
          noteState.data = { id: 'note-uuid', ...val }
          return chain
        })
        return chain
      }
      if (table === 'conversations') return createChain(convState)
      if (table === 'whatsapp_config') return createChain({ data: { phone_number_id: 'test-phone-id', access_token: 'test-token', status: 'connected' } })
      return createChain({ data: null })
    })

    const req = new Request('http://localhost:3000/api/integrations/webinar-registration', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-secret' },
      body: JSON.stringify({
        registration_id: 'reg-123',
        full_name: 'John Doe',
        phone: '+91 96295 66619',
        email: 'john@example.com',
        workshop_batch: 'July 05 2026',
        payment_status: 'free_access',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.contact_id).toBe('existing-contact-uuid')
    expect(json.whatsapp_sent).toBe(true)
  })

  // 5. Idempotency logic
  it('skips sending WhatsApp message if registration_id has already been processed', async () => {
    const contactState = {
      data: [{ id: 'existing-contact-uuid', phone: '919629566619', name: 'John Doe', email: 'john@example.com' }] as any
    }
    const noteState = { data: [{ id: 'note-uuid', contact_id: 'existing-contact-uuid' }] }

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return createChain({ data: { user_id: 'test-user-id' } })
      if (table === 'contacts') return createChain(contactState)
      if (table === 'contact_notes') return createChain(noteState)
      return createChain({ data: null })
    })

    const req = new Request('http://localhost:3000/api/integrations/webinar-registration', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-secret' },
      body: JSON.stringify({
        registration_id: 'reg-123',
        full_name: 'John Doe',
        phone: '+91 96295 66619',
        email: 'john@example.com',
        workshop_batch: 'July 05 2026',
        payment_status: 'paid',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.contact_id).toBe('existing-contact-uuid')
    expect(json.whatsapp_sent).toBe(false)

    // Verify WhatsApp template message was NOT sent
    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })
})
