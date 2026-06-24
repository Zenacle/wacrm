import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  normalizePhone,
  phonesMatch,
  sanitizePhoneForMeta,
  phoneVariants,
  isRecipientNotAllowedError,
  isValidE164,
} from '@/lib/whatsapp/phone-utils'

// Helper: Add tag to contact
async function addTagToContact(
  userId: string,
  contactId: string,
  tagName: string,
  defaultColor = '#3b82f6'
) {
  // Find tag
  let { data: tag, error: tagError } = await supabaseAdmin()
    .from('tags')
    .select('*')
    .eq('user_id', userId)
    .eq('name', tagName)
    .maybeSingle()

  if (tagError) {
    console.error(`Error searching for tag "${tagName}":`, tagError)
  }

  if (!tag) {
    const { data: newTag, error: newTagError } = await supabaseAdmin()
      .from('tags')
      .insert({
        user_id: userId,
        name: tagName,
        color: defaultColor,
      })
      .select()
      .single()

    if (newTagError) {
      console.error(`Error creating tag "${tagName}":`, newTagError)
      throw newTagError
    }
    tag = newTag
  }

  // Upsert the relation to avoid duplicate errors
  const { error: linkError } = await supabaseAdmin()
    .from('contact_tags')
    .upsert(
      { contact_id: contactId, tag_id: tag.id },
      { onConflict: 'contact_id,tag_id' }
    )

  if (linkError) {
    console.error(`Error adding tag "${tagName}" to contact:`, linkError)
    throw linkError
  }
}

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
      registration_id,
      full_name,
      email,
      phone,
      workshop_batch,
      payment_status,
    } = body

    if (!registration_id || !full_name || !phone || !workshop_batch) {
      console.error('Missing required input parameters:', {
        registration_id: !!registration_id,
        full_name: !!full_name,
        phone: !!phone,
        workshop_batch: !!workshop_batch,
      })
      return NextResponse.json(
        { error: 'registration_id, full_name, phone, and workshop_batch are required' },
        { status: 400 }
      )
    }

    // Check if registration_id already exists in webinar_sync_log
    const { data: existingLog, error: logSearchError } = await supabaseAdmin()
      .from('webinar_sync_log')
      .select('registration_id')
      .eq('registration_id', registration_id)
      .limit(1)
      .maybeSingle()

    if (logSearchError) {
      console.error('Error checking webinar_sync_log:', logSearchError)
    }

    if (existingLog) {
      console.log(`Registration ID ${registration_id} already exists in webinar_sync_log. Skipping processing.`)
      return NextResponse.json({
        success: true,
        duplicate: true,
        whatsapp_sent: false
      })
    }

    // Get the first user/profile in the CRM system to associate the new contact with
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

    // 3. Normalize phone number
    const normalized = normalizePhone(phone)

    // 4. Check if contact already exists using phone number
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

    // 5. Create or update contact
    let contact = existingContact
    if (existingContact) {
      // Update name/email if empty
      const updates: Record<string, any> = {}
      if (!existingContact.name && full_name) {
        updates.name = full_name
      }
      if (!existingContact.email && email) {
        updates.email = email
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
          name: full_name,
          email: email || null,
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

    // 6. Add tags
    // A. Webinar Registered
    await addTagToContact(userId, contact.id, 'Webinar Registered', '#3b82f6')

    // 7. Find or create conversation
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

    let whatsapp_sent = false
    let errorMessage: string | null = null

    try {
      // 8. Fetch and decrypt WhatsApp config
      const { data: config, error: configError } = await supabaseAdmin()
        .from('whatsapp_config')
        .select('*')
        .eq('user_id', userId)
        .single()

      if (configError || !config) {
        throw new Error(configError?.message || 'WhatsApp not configured in CRM for user')
      }

      const accessToken = decrypt(config.access_token)
      const sanitizedPhone = sanitizePhoneForMeta(contact.phone)

      if (!isValidE164(sanitizedPhone)) {
        throw new Error('Invalid phone number format')
      }

      const variants = phoneVariants(sanitizedPhone)
      let waMessageId = ''
      let workingPhone = sanitizedPhone
      let lastError: unknown = null

      for (const variant of variants) {
        try {
          const result = await sendTemplateMessage({
            phoneNumberId: config.phone_number_id,
            accessToken,
            to: variant,
            templateName: 'registration_confirmation',
            language: 'en',
            params: [full_name],
          })
          waMessageId = result.messageId
          workingPhone = variant
          lastError = null
          break
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (!isRecipientNotAllowedError(message)) {
            throw err
          }
          lastError = err
          console.warn(`[integration] variant "${variant}" rejected by Meta, trying next…`)
        }
      }

      if (lastError) {
        throw lastError
      }

      // If workingPhone was corrected
      if (workingPhone !== sanitizedPhone) {
        await supabaseAdmin()
          .from('contacts')
          .update({ phone: workingPhone, updated_at: new Date().toISOString() })
          .eq('id', contact.id)
      }

      // Insert message record into internal DB
      const { data: messageRecord, error: msgError } = await supabaseAdmin()
        .from('messages')
        .insert({
          conversation_id: conversation.id,
          sender_type: 'agent',
          content_type: 'template',
          content_text: null,
          template_name: 'registration_confirmation',
          message_id: waMessageId,
          status: 'sent',
        })
        .select()
        .single()

      if (msgError) {
        console.error('Error inserting webhook-sent message:', msgError)
      }

      // Update conversation details
      await supabaseAdmin()
        .from('conversations')
        .update({
          last_message_text: '[Template: registration_confirmation]',
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversation.id)

      whatsapp_sent = true
    } catch (err) {
      console.error('WhatsApp template sending failed:', err)
      errorMessage = err instanceof Error ? err.message : String(err)
    }

    // 9. Record sync log
    const { error: syncLogError } = await supabaseAdmin()
      .from('webinar_sync_log')
      .insert({
        registration_id,
        contact_id: contact.id,
        full_name,
        email,
        phone,
        workshop_batch,
        payment_status,
        whatsapp_sent,
        processed_at: new Date().toISOString(),
        error_message: errorMessage,
      })

    if (syncLogError) {
      if (syncLogError.code === '23505') {
        console.log(`Registration ID ${registration_id} already exists in webinar_sync_log (detected via insert constraint). Skipping processing duplicate.`)
        return NextResponse.json({
          success: true,
          duplicate: true,
          whatsapp_sent: false,
        })
      }
      console.error('Error inserting webinar_sync_log:', syncLogError)
      return NextResponse.json(
        { error: `Failed to record sync log: ${syncLogError.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      contact_id: contact.id,
      whatsapp_sent,
    })
  } catch (error) {
    console.error('Error in CRM webinar integration:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
