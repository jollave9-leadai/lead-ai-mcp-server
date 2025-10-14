import { DateTime } from "luxon";
import { FinalOptimizedCalendarOperations } from "@/lib/helpers/calendar_functions/finalOptimizedCalendarOperations";
import { AdvancedCacheService } from "@/lib/helpers/cache/advancedCacheService";
import {
  getCustomerWithFuzzySearch,
  getAgentByCalendarConnection,
  isWithinOfficeHours
} from "@/lib/helpers/utils";

/**
 * Dedicated booking service for customer-facing appointment booking
 * Uses existing calendar functions without modifying them
 */
export class BookingService {
  
  /**
   * Parse customer date/time requests into proper datetime
   * Handles natural language like "today at 1:30 pm", "tomorrow at 9am", etc.
   */
  static parseCustomerDateTime(
    dateTimeRequest: string,
    clientTimezone: string
  ): {
    dateTime: string
    description: string
  } {
    const nowInClientTZ = DateTime.now().setZone(clientTimezone)
    const lower = dateTimeRequest.toLowerCase().trim()
    
    // Check if it's already a full ISO datetime
    if (dateTimeRequest.includes('T')) {
      try {
        const parsed = DateTime.fromISO(dateTimeRequest, { zone: clientTimezone })
        if (parsed.isValid) {
          return {
            dateTime: parsed.toISO() || '',
            description: `${parsed.toFormat('DDD')} at ${parsed.toFormat('h:mm a')}`
          }
        }
      } catch {
        // Fall through to natural language parsing
      }
    }
    
    // Check if it's in the format returned by CheckAvailability: "14/10/2025, 02:51 pm"
    const dateTimeMatch = lower.match(/(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2}):(\d{2})\s*(am|pm)/i)
    if (dateTimeMatch) {
      try {
        const [, day, month, year, hour, minute, ampm] = dateTimeMatch
        const hour24 = ampm.toLowerCase() === 'pm' && parseInt(hour) !== 12 
          ? parseInt(hour) + 12 
          : (ampm.toLowerCase() === 'am' && parseInt(hour) === 12 ? 0 : parseInt(hour))
        
        const parsed = DateTime.fromObject({
          year: parseInt(year),
          month: parseInt(month),
          day: parseInt(day),
          hour: hour24,
          minute: parseInt(minute),
          second: 0,
          millisecond: 0
        }, { zone: clientTimezone })
        
        if (parsed.isValid) {
          return {
            dateTime: parsed.toISO() || '',
            description: `${parsed.toFormat('DDD')} at ${parsed.toFormat('h:mm a')}`
          }
        }
      } catch {
        // Fall through to natural language parsing
      }
    }
    
    // Extract time pattern (e.g., "1:30 pm", "9am", "2:00 PM")
    const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i)
    
    if (!timeMatch) {
      // No time specified, default to 9 AM
      const hour = 9
      const minute = 0
      
      if (lower.includes('today')) {
        const result = nowInClientTZ.set({ hour, minute, second: 0, millisecond: 0 })
        return {
          dateTime: result.toISO() || '',
          description: `Today at ${hour}:${minute.toString().padStart(2, '0')} AM`
        }
      } else if (lower.includes('tomorrow')) {
        const result = nowInClientTZ.plus({ days: 1 }).set({ hour, minute, second: 0, millisecond: 0 })
        return {
          dateTime: result.toISO() || '',
          description: `Tomorrow at ${hour}:${minute.toString().padStart(2, '0')} AM`
        }
      }
      
      // Fallback to today 9 AM
      const result = nowInClientTZ.set({ hour, minute, second: 0, millisecond: 0 })
      return {
        dateTime: result.toISO() || '',
        description: `Today at ${hour}:${minute.toString().padStart(2, '0')} AM (default)`
      }
    }
    
    // Parse the time
    const hour = parseInt(timeMatch[1])
    const minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0
    const isPM = timeMatch[3].toLowerCase() === 'pm'
    const adjustedHour = isPM && hour !== 12 ? hour + 12 : (hour === 12 && !isPM ? 0 : hour)
    
    let targetDate: DateTime
    let dayDescription: string
    
    if (lower.includes('today')) {
      targetDate = nowInClientTZ
      dayDescription = 'Today'
    } else if (lower.includes('tomorrow')) {
      targetDate = nowInClientTZ.plus({ days: 1 })
      dayDescription = 'Tomorrow'
    } else if (lower.includes('this friday') || lower.includes('next monday')) {
      // Handle "this friday at 2pm", "next monday at 10am", etc.
      const dayMatch = lower.match(/(?:this|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/)
      if (dayMatch) {
        const dayName = dayMatch[1]
        const isNext = lower.includes('next')
        const targetDay = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"].indexOf(dayName)
        const currentWeekday = nowInClientTZ.weekday === 7 ? 0 : nowInClientTZ.weekday
        
        let diff = (targetDay - currentWeekday + 7) % 7
        if (isNext && diff === 0) {
          diff = 7 // Next week if it's the same day
        }
        
        targetDate = nowInClientTZ.plus({ days: diff })
        dayDescription = `${isNext ? 'Next' : 'This'} ${dayName.charAt(0).toUpperCase() + dayName.slice(1)}`
      } else {
        // Fallback to today
        targetDate = nowInClientTZ
        dayDescription = 'Today'
      }
    } else {
      // Try to parse as ISO date or fallback to today
      try {
        const parsed = DateTime.fromISO(lower, { zone: clientTimezone })
        if (parsed.isValid) {
          targetDate = parsed
          dayDescription = parsed.toFormat('DDD')
        } else {
          targetDate = nowInClientTZ
          dayDescription = 'Today (fallback)'
        }
      } catch {
        targetDate = nowInClientTZ
        dayDescription = 'Today (fallback)'
      }
    }
    
    // Set the specific time
    const result = targetDate.set({ hour: adjustedHour, minute, second: 0, millisecond: 0 })
    
    // Format time for description
    const timeStr = `${hour}:${minute.toString().padStart(2, '0')} ${isPM ? 'PM' : 'AM'}`
    
    return {
      dateTime: result.toISO() || '',
      description: `${dayDescription} at ${timeStr}`
    }
  }

  /**
   * Find customer by name using fuzzy search
   */
  static async findCustomer(
    customerName: string,
    clientId: number
  ): Promise<{
    found: boolean
    customer?: {
      id: number
      full_name: string
      first_name?: string
      email: string
      phone_number?: string
    }
    error?: string
  }> {
    try {
      const searchResults = await getCustomerWithFuzzySearch(customerName, clientId.toString())
      
      if (searchResults && searchResults.length > 0) {
        return {
          found: true,
          customer: searchResults[0].item
        }
      }
      
      return {
        found: false,
        error: `Customer "${customerName}" not found in system`
      }
    } catch (error) {
      return {
        found: false,
        error: `Error searching for customer: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }

  /**
   * Get agent and calendar information for a client
   */
  static async getClientBookingInfo(
    clientId: number
  ): Promise<{
    success: boolean
    connection?: {
      id: string
      email: string
      display_name: string
    }
    agent?: {
      id: number
      name: string
      agent_type: string
      profiles: {
        id: number
        name: string
        office_hours: Record<string, { start: string; end: string; enabled: boolean }>
        timezone: string
      } | {
        id: number
        name: string
        office_hours: Record<string, { start: string; end: string; enabled: boolean }>
        timezone: string
      }[]
    }
    timezone?: string
    error?: string
  }> {
    try {
      // Get calendar connection and client data
      const clientData = await AdvancedCacheService.getClientCalendarData(clientId)
      if (!clientData?.connection) {
        return {
          success: false,
          error: 'No calendar connection found for this client'
        }
      }

      // Get agent assigned to this calendar connection
      const agentInfo = await getAgentByCalendarConnection(clientData.connection.id, clientId)
      if (!agentInfo) {
        return {
          success: false,
          error: 'No agent assigned to handle bookings for this client'
        }
      }

      return {
        success: true,
        connection: clientData.connection,
        agent: agentInfo.agents as unknown as {
          id: number
          name: string
          agent_type: string
          profiles: {
            id: number
            name: string
            office_hours: Record<string, { start: string; end: string; enabled: boolean }>
            timezone: string
          } | {
            id: number
            name: string
            office_hours: Record<string, { start: string; end: string; enabled: boolean }>
            timezone: string
          }[]
        },
        timezone: clientData.timezone || 'Australia/Melbourne'
      }
    } catch (error) {
      return {
        success: false,
        error: `Error getting client booking info: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }

  /**
   * Validate if requested time is within office hours and not in the past
   */
  static validateBookingTime(
    startDateTime: string,
    officeHours: Record<string, { start: string; end: string; enabled: boolean }> | null,
    agentTimezone: string,
    minimumAdvanceMinutes: number = 15
  ): {
    valid: boolean
    reason?: string
    suggestedAction?: string
  } {
    // Check if time is in the past
    const requestedTime = new Date(startDateTime)
    const now = new Date()
    const minimumTime = new Date(now.getTime() + minimumAdvanceMinutes * 60 * 1000)

    if (requestedTime < minimumTime) {
      return {
        valid: false,
        reason: `Cannot book appointments in the past or less than ${minimumAdvanceMinutes} minutes in advance`,
        suggestedAction: 'Please choose a future time'
      }
    }

    // Check office hours
    if (officeHours) {
      const officeHoursCheck = isWithinOfficeHours(startDateTime, officeHours, agentTimezone)
      if (!officeHoursCheck.isWithin) {
        return {
          valid: false,
          reason: officeHoursCheck.reason,
          suggestedAction: 'Please choose a time during business hours'
        }
      }
    }

    return { valid: true }
  }

  /**
   * Create booking metadata for tracking
   */
  static createBookingMetadata(
    clientId: number,
    agentId: number,
    customerId: number | null,
    agentType: string,
    appointmentType: string,
    callContext?: string | null,
    customerPhone?: string | null
  ) {
    return {
      client_id: clientId,
      agent_id: agentId,
      customer_id: customerId,
      booking_source: 'booking_mcp',
      call_context: callContext || null,
      customer_phone: customerPhone || null,
      created_via: agentType || 'unknown',
      appointment_type: appointmentType
    }
  }

  /**
   * Book an appointment for a customer
   */
  static async bookAppointment(params: {
    clientId: number
    customerName: string
    customerEmail?: string
    customerPhone?: string
    callContext?: string
    appointmentType: string
    preferredDateTime: string
    duration: number
    notes?: string
    isOnlineMeeting: boolean
    location?: string
  }): Promise<{
    success: boolean
    event?: {
      id: string
      start?: { dateTime: string }
      onlineMeeting?: { joinUrl: string }
    }
    eventId?: string
    error?: string
    availableSlots?: Array<{
      start: string
      end: string
      startFormatted: string
      endFormatted: string
      confidence: number
    }>
    suggestedAction?: string
  }> {
    const {
      clientId,
      customerName,
      customerEmail,
      customerPhone,
      callContext,
      appointmentType,
      preferredDateTime,
      duration,
      notes,
      isOnlineMeeting,
      location
    } = params

    try {
      // 1. Find customer if email not provided
      let finalCustomerEmail = customerEmail
      let finalCustomerName = customerName
      let customerId: number | null = null

      if (!customerEmail) {
        const customerResult = await this.findCustomer(customerName, clientId)
        if (!customerResult.found) {
          return {
            success: false,
            error: customerResult.error,
            suggestedAction: 'Please provide the customer\'s email address'
          }
        }
        
        finalCustomerEmail = customerResult.customer!.email
        finalCustomerName = customerResult.customer!.full_name || customerName
        customerId = customerResult.customer!.id
      }

      if (!finalCustomerEmail) {
        return {
          success: false,
          error: 'Customer email is required for appointment booking',
          suggestedAction: 'Please provide the customer\'s email address'
        }
      }

      // 2. Get client booking information
      const bookingInfo = await this.getClientBookingInfo(clientId)
      if (!bookingInfo.success) {
        return {
          success: false,
          error: bookingInfo.error,
          suggestedAction: 'Please contact support to set up calendar integration'
        }
      }

      // 3. Parse requested date/time
      const parsedResult = this.parseCustomerDateTime(preferredDateTime, bookingInfo.timezone!)
      
      // Keep the DateTime in the client's timezone (don't convert to system timezone)
      const parsedDateTime = DateTime.fromISO(parsedResult.dateTime, { setZone: true })
      
      // Extract the local time components in the CLIENT'S timezone
      // Microsoft Graph will handle timezone conversion via Prefer header
      const startDateTime = parsedDateTime.toFormat('yyyy-MM-dd\'T\'HH:mm:ss')
      
      // Calculate end time in the same timezone
      const endDateTime = parsedDateTime.plus({ minutes: duration }).toFormat('yyyy-MM-dd\'T\'HH:mm:ss')
      
      console.log(`🕐 Customer Request: "${preferredDateTime}" → ${startDateTime} (${parsedResult.description})`)
      console.log(`🕐 Booking Times: Start=${startDateTime}, End=${endDateTime}, Duration=${duration}min`)
      console.log(`🌍 Timezone: ${bookingInfo.timezone} (will be handled by Microsoft Graph Prefer header)`)

      // 4. Validate booking time
      const agent = bookingInfo.agent!
      const profile = Array.isArray(agent.profiles) ? agent.profiles[0] : agent.profiles
      const officeHours = profile?.office_hours
      const agentTimezone = profile?.timezone || 'UTC'

      const timeValidation = this.validateBookingTime(startDateTime, officeHours, agentTimezone)
      if (!timeValidation.valid) {
        // Try to find alternative slots
        try {
          const slotsResult = await FinalOptimizedCalendarOperations.findAvailableSlotsForClient(
            clientId,
            startDateTime,
            endDateTime,
            duration,
            5 // max 5 suggestions
          )

          return {
            success: false,
            error: timeValidation.reason,
            availableSlots: slotsResult.availableSlots || [],
            suggestedAction: slotsResult.availableSlots?.length 
              ? 'Here are some available alternative times'
              : timeValidation.suggestedAction
          }
        } catch {
          return {
            success: false,
            error: timeValidation.reason,
            suggestedAction: timeValidation.suggestedAction
          }
        }
      }

      // 5. Create booking request (times already calculated above)
      
      const bookingRequest = {
        clientId,
        subject: `${appointmentType} - ${finalCustomerName}`,
        startDateTime,
        endDateTime,
        attendeeEmail: finalCustomerEmail,
        attendeeName: finalCustomerName,
        description: [
          appointmentType,
          callContext ? `Call Context: ${callContext}` : '',
          notes ? `Notes: ${notes}` : ''
        ].filter(Boolean).join('\n\n'),
        location,
        isOnlineMeeting,
        // Add metadata for tracking
        metadata: this.createBookingMetadata(
          clientId,
          agent.id,
          customerId,
          agent.agent_type,
          appointmentType,
          callContext,
          customerPhone
        )
      }

      // 6. Book the appointment
      console.log(`📅 Booking appointment for ${finalCustomerName} at ${startDateTime}`)
      
      const result = await FinalOptimizedCalendarOperations.createCalendarEventForClient(
        clientId,
        bookingRequest
      )

      if (result.success) {
        return {
          success: true,
          event: result.event as {
            id: string
            start?: { dateTime: string }
            onlineMeeting?: { joinUrl: string }
          },
          eventId: result.eventId
        }
      } else {
        // Check if conflict with alternative slots
        if (result.availableSlots && result.availableSlots.length > 0) {
          return {
            success: false,
            error: 'The requested time slot is already booked',
            availableSlots: result.availableSlots,
            suggestedAction: 'Please choose one of the available alternative times'
          }
        } else {
          return {
            success: false,
            error: result.error || 'Failed to create appointment',
            suggestedAction: 'Please try a different time or contact support'
          }
        }
      }

    } catch (error) {
      console.error('Error in BookingService.bookAppointment:', error)
      return {
        success: false,
        error: `Booking failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        suggestedAction: 'Please try again or contact support'
      }
    }
  }

  /**
   * Check availability for a client
   */
  static async checkAvailability(params: {
    clientId: number
    dateRequest?: string
    startDate?: string
    endDate?: string
    duration: number
    maxSlots: number
  }): Promise<{
    success: boolean
    availableSlots?: Array<{
      start: string
      end: string
      startFormatted: string
      endFormatted: string
      confidence: number
    }>
    error?: string
  }> {
    const { clientId, dateRequest, startDate, endDate, duration, maxSlots } = params

    try {
      // Determine search date range
      let searchStartDate: string
      let searchEndDate: string

      if (dateRequest) {
        // For natural language, we'll use today as default
        const today = new Date()
        searchStartDate = today.toISOString().slice(0, 19)
        const endOfDay = new Date(today)
        endOfDay.setHours(23, 59, 59)
        searchEndDate = endOfDay.toISOString().slice(0, 19)
      } else if (startDate && endDate) {
        searchStartDate = startDate
        searchEndDate = endDate
      } else {
        // Default to today
        const today = new Date()
        searchStartDate = today.toISOString().slice(0, 19)
        const endOfDay = new Date(today)
        endOfDay.setHours(23, 59, 59)
        searchEndDate = endOfDay.toISOString().slice(0, 19)
      }

      // Find available slots
      const slotsResult = await FinalOptimizedCalendarOperations.findAvailableSlotsForClient(
        clientId,
        searchStartDate,
        searchEndDate,
        duration,
        maxSlots
      )

      if (!slotsResult.success) {
        return {
          success: false,
          error: slotsResult.error || 'Could not check availability'
        }
      }

      return {
        success: true,
        availableSlots: slotsResult.availableSlots || []
      }

    } catch (error) {
      console.error('Error in BookingService.checkAvailability:', error)
      return {
        success: false,
        error: `Availability check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }
}
