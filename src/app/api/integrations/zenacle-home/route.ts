import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { engineSendText } from '@/lib/automations/meta-send'
import {
  normalizePhone,
  phonesMatch,
} from '@/lib/whatsapp/phone-utils'

export async function POST(request: Request) {
  try {
    // 1. Validate API secret header
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('Authorization header missing or invalid format')
      return NextResponse.json(
        { error: 'Unauthorized: Missing or invalid token format' },
        { status: 401 }
      )
    }

    const token = authHeader.substring(7)
    const integrationSecret = process.env.CRM_INTEGRATION_SECRET

    if (!integrationSecret || token !== integrationSecret) {
      console.error('Invalid or unconfigured CRM_INTEGRATION_SECRET')
      return NextResponse.json(
        { error: 'Unauthorized: Invalid CRM integration secret' },
        { status: 401 }
      )
    }

    // 2. Parse body parameters
    const body = await request.json()
    const {
      report_id,
      household_id,
      report_date,
      recipient_name,
      phone,
      message,
      delivery_type,
      source,
    } = body

    if (
      !report_id ||
      !household_id ||
      !report_date ||
      !recipient_name ||
      !phone ||
      !message ||
      !delivery_type ||
      !source
    ) {
      console.error('Missing required input parameters:', {
        report_id: !!report_id,
        household_id: !!household_id,
        report_date: !!report_date,
        recipient_name: !!recipient_name,
        phone: !!phone,
        message: !!message,
        delivery_type: !!delivery_type,
        source: !!source,
      })
      return NextResponse.json(
        {
          error:
            'report_id, household_id, report_date, recipient_name, phone, message, delivery_type, and source are required',
        },
        { status: 400 }
      )
    }

    // 3. Idempotency Check: check if report_id already exists in integration_delivery_log
    const { data: existingLog, error: logSearchError } = await supabaseAdmin()
      .from('integration_delivery_log')
      .select('external_id')
      .eq('integration_source', 'zenacle_home')
      .eq('external_id', report_id)
      .limit(1)
      .maybeSingle()

    if (logSearchError) {
      console.error('Error checking integration_delivery_log:', logSearchError)
    }

    if (existingLog) {
      console.log(
        `Report ID ${report_id} already exists in integration_delivery_log. Skipping processing.`
      )
      return NextResponse.json({
        success: true,
        duplicate: true,
      })
    }

    // Get the first user/profile in the CRM system to associate the contact with
    const { data: profile, error: profileError } = await supabaseAdmin()
      .from('profiles')
      .select('user_id')
      .limit(1)
      .maybeSingle()

    if (profileError || !profile) {
      console.error('Error fetching admin profile for integration:', profileError)
      return NextResponse.json(
        { error: 'No active CRM profiles found' },
        { status: 500 }
      )
    }

    const userId = profile.user_id

    // 4. Normalize phone number
    const normalized = normalizePhone(phone)

    // 5. Check if contact already exists using phone number
    const last8 = normalized.slice(-8)
    let existingContact = null

    if (last8.length >= 8) {
      const { data: contacts, error: contactsError } = await supabaseAdmin()
        .from('contacts')
        .select('*')
        .eq('user_id', userId)
        .like('phone', `%${last8}`)

      if (!contactsError && contacts) {
        existingContact = contacts.find((c) => phonesMatch(c.phone, phone))
      }
    }

    if (!existingContact) {
      const { data: exactContacts } = await supabaseAdmin()
        .from('contacts')
        .select('*')
        .eq('user_id', userId)
        .eq('phone', normalized)

      if (exactContacts && exactContacts.length > 0) {
        existingContact = exactContacts[0]
      }
    }

    // Create or update contact
    let contact = existingContact
    if (existingContact) {
      // Update name/email ONLY if they are currently empty
      const updates: Record<string, any> = {}
      if (!existingContact.name && recipient_name) {
        updates.name = recipient_name
      }

      if (Object.keys(updates).length > 0) {
        const { data: updatedContact, error: updateError } = await supabaseAdmin()
          .from('contacts')
          .update({ ...updates, updated_at: new Date().toISOString() })
          .eq('id', existingContact.id)
          .select()
          .single()

        if (updateError) {
          console.error('Error updating existing contact:', updateError)
        } else {
          contact = updatedContact
        }
      }
    } else {
      // Create new contact
      const { data: newContact, error: createError } = await supabaseAdmin()
        .from('contacts')
        .insert({
          user_id: userId,
          phone: normalized,
          name: recipient_name,
          email: null,
        })
        .select()
        .single()

      if (createError) {
        console.error('Error creating contact:', createError)
        return NextResponse.json(
          { error: `Failed to create contact: ${createError.message}` },
          { status: 500 }
        )
      }
      contact = newContact
    }

    // 6. Find or create conversation
    let { data: conversation, error: convError } = await supabaseAdmin()
      .from('conversations')
      .select('*')
      .eq('user_id', userId)
      .eq('contact_id', contact.id)
      .maybeSingle()

    if (!conversation) {
      const { data: newConv, error: createConvError } = await supabaseAdmin()
        .from('conversations')
        .insert({
          user_id: userId,
          contact_id: contact.id,
        })
        .select()
        .single()

      if (createConvError) {
        console.error('Error creating conversation:', createConvError)
        return NextResponse.json(
          { error: `Failed to create conversation: ${createConvError.message}` },
          { status: 500 }
        )
      }
      conversation = newConv
    }

    let whatsappSent = false
    let crmMessageId: string | null = null
    let metaMessageId: string | null = null
    let errorMessage: string | null = null
    let deliveryStatus = 'failed'

    // 7. Invoke the CRM's existing outbound messaging pipeline
    try {
      const { whatsapp_message_id } = await engineSendText({
        userId,
        conversationId: conversation.id,
        contactId: contact.id,
        text: message,
      })
      whatsappSent = true
      metaMessageId = whatsapp_message_id
      deliveryStatus = 'sent'

      // Lookup the CRM message record ID that engineSendText inserted
      const { data: messageRecord } = await supabaseAdmin()
        .from('messages')
        .select('id')
        .eq('message_id', whatsapp_message_id)
        .limit(1)
        .maybeSingle()

      if (messageRecord) {
        crmMessageId = messageRecord.id
      }
    } catch (err: any) {
      console.error('WhatsApp message sending failed:', err)
      errorMessage = err instanceof Error ? err.message : String(err)
    }

    // 8. Log the delivery status
    const { error: syncLogError } = await supabaseAdmin()
      .from('integration_delivery_log')
      .insert({
        integration_source: 'zenacle_home',
        external_id: report_id,
        delivery_type,
        contact_id: contact.id,
        crm_message_id: crmMessageId,
        meta_message_id: metaMessageId,
        status: deliveryStatus,
        whatsapp_sent: whatsappSent,
        error_message: errorMessage,
        metadata: {
          household_id,
          report_date,
          payload_version: 1,
        },
      })

    if (syncLogError) {
      // Graceful handling of unique constraint violation (code 23505) in case of races
      if (syncLogError.code === '23505') {
        console.log(
          `Report ID ${report_id} already logged in integration_delivery_log. Skipping processing duplicate.`
        )
        return NextResponse.json({
          success: true,
          duplicate: true,
        })
      }
      console.error('Error inserting integration_delivery_log:', syncLogError)
      return NextResponse.json(
        { error: `Failed to record integration log: ${syncLogError.message}` },
        { status: 500 }
      )
    }

    if (!whatsappSent) {
      return NextResponse.json(
        {
          success: false,
          error: errorMessage || 'Failed to send WhatsApp message',
          report_id,
          contact_id: contact.id,
          conversation_id: conversation.id,
          status: 'failed',
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      report_id,
      contact_id: contact.id,
      conversation_id: conversation.id,
      crm_message_id: crmMessageId,
      status: 'sent',
    })
  } catch (error: any) {
    console.error('Error in Zenacle Home integration:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
