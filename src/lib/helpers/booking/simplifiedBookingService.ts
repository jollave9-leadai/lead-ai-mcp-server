import { DateTime } from 'luxon'
import { FinalOptimizedCalendarOperations } from '@/lib/helpers/calendar_functions/finalOptimizedCalendarOperations'
import { getCustomerWithFuzzySearch, getAgentByCalendarConnection, isWithinOfficeHours } from '@/lib/helpers/utils'
import { AdvancedCacheService } from '@/lib/helpers/cache/advancedCacheService'

/**
 * Simplified Booking Service - Clean, step-by-step booking flow
 */
export class SimplifiedBookingService {
  
  /**
   * STEP 1: Find customer in database or use provided details
   */
  private static async findCustomer(
    customerName: string,
    clientId: number
  ): Promise<{
    found: boolean
    customer?: {
      id: number
      full_name: string
      email: string
      phone_number?: string
    }
  }> {
    try {
      const searchResults = await getCustomerWithFuzzySearch(customerName, clientId.toString())
      
      if (searchResults && searchResults.length > 0) {
        const customer = searchResults[0].item
        return {
          found: true,
          customer: {
            id: customer.id,
            full_name: customer.full_name,
            email: customer.email,
            phone_number: customer.phone_number
          }
        }
      }
      
      return { found: false }
    } catch (error) {
      console.error(`❌ Customer search error:`, error)
      return { found: false }
    }
  }
  
  /**
   * STEP 2: Parse date/time in client timezone
   */
  private static parseDateTime(
    dateTimeRequest: string,
    clientTimezone: string
  ): {
    success: boolean
    startDateTime?: string
    endDateTime?: string
    duration?: number
    description?: string
    error?: string
  } {
    try {
      const nowInClientTZ = DateTime.now().setZone(clientTimezone)
      const lower = dateTimeRequest.toLowerCase().trim()
      
      console.log(`🕐 Parsing "${dateTimeRequest}" in timezone ${clientTimezone}`)
      
      // Handle VAPI format: "14/10/2025, 03:42 pm"
      const vapiMatch = lower.match(/(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2}):(\d{2})\s*(am|pm)/i)
      if (vapiMatch) {
        const [, day, month, year, hour, minute, ampm] = vapiMatch
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
          const startDateTime = parsed.toFormat('yyyy-MM-dd\'T\'HH:mm:ss')
          const endDateTime = parsed.plus({ minutes: 60 }).toFormat('yyyy-MM-dd\'T\'HH:mm:ss')
          
          console.log(`✅ VAPI format parsed: ${startDateTime}`)
          return {
            success: true,
            startDateTime,
            endDateTime,
            duration: 60,
            description: `${parsed.toFormat('DDD')} at ${parsed.toFormat('h:mm a')}`
          }
        }
      }
      
      // Handle natural language: "today at 3pm", "tomorrow at 2pm"
      const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i)
      if (timeMatch) {
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
        } else {
          targetDate = nowInClientTZ
          dayDescription = 'Today (default)'
        }
        
        const result = targetDate.set({ hour: adjustedHour, minute, second: 0, millisecond: 0 })
        const startDateTime = result.toFormat('yyyy-MM-dd\'T\'HH:mm:ss')
        const endDateTime = result.plus({ minutes: 60 }).toFormat('yyyy-MM-dd\'T\'HH:mm:ss')
        
        console.log(`✅ Natural language parsed: ${startDateTime}`)
        return {
          success: true,
          startDateTime,
          endDateTime,
          duration: 60,
          description: `${dayDescription} at ${hour}:${minute.toString().padStart(2, '0')} ${isPM ? 'PM' : 'AM'}`
        }
      }
      
      return {
        success: false,
        error: `Could not parse date/time format: "${dateTimeRequest}"`
      }
      
    } catch (error) {
      console.error(`❌ Date parsing error:`, error)
      return {
        success: false,
        error: `Date parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }
  
  /**
   * STEP 3: Check availability (office hours + conflicts)
   */
  private static async checkAvailabilityInternal(
    clientId: number,
    startDateTime: string,
    endDateTime: string,
    agentTimezone: string,
    officeHours?: Record<string, { start: string; end: string; enabled: boolean }>
  ): Promise<{
    available: boolean
    error?: string
    availableSlots?: Array<{
      startFormatted: string
      endFormatted: string
      confidence: number
    }>
  }> {
    try {
      // Check office hours first
      if (officeHours) {
        const officeHoursCheck = isWithinOfficeHours(startDateTime, officeHours, agentTimezone)
        if (!officeHoursCheck.isWithin) {
          console.log(`❌ Office hours violation: ${officeHoursCheck.reason}`)
          
          // Find alternative slots
          try {
            const slotsResult = await FinalOptimizedCalendarOperations.findAvailableSlotsForClient(
              clientId,
              startDateTime,
              endDateTime,
              60,
              5
            )
            return {
              available: false,
              error: officeHoursCheck.reason || 'Outside office hours',
              availableSlots: slotsResult.availableSlots || []
            }
          } catch {
            return {
              available: false,
              error: officeHoursCheck.reason || 'Outside office hours'
            }
          }
        }
      }
      
      console.log(`✅ Office hours check passed`)
      
      // Check for conflicts
      const result = await FinalOptimizedCalendarOperations.createCalendarEventForClient(clientId, {
        clientId,
        subject: 'Availability Check',
        startDateTime,
        endDateTime,
        attendeeEmail: 'test@example.com',
        description: 'Checking availability',
        isOnlineMeeting: false
      })
      
      if (result.success) {
        // If successful, delete the test event
        if (result.eventId) {
          await FinalOptimizedCalendarOperations.deleteCalendarEventForClient(clientId, result.eventId)
        }
        return { available: true }
      } else {
        // Check if it's a conflict (has alternative slots)
        if (result.availableSlots && result.availableSlots.length > 0) {
          return {
            available: false,
            error: 'Time slot is already booked',
            availableSlots: result.availableSlots
          }
        } else {
          return {
            available: false,
            error: result.error || 'Time slot unavailable'
          }
        }
      }
      
    } catch (error) {
      console.error(`❌ Availability check error:`, error)
      return {
        available: false,
        error: `Availability check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }
  
  /**
   * STEP 4: Create booking
   */
  private static async createBooking(
    clientId: number,
    customerName: string,
    customerEmail: string,
    customerId: number | null,
    appointmentType: string,
    startDateTime: string,
    endDateTime: string,
    agentId: number,
    agentType: string,
    callContext?: string,
    customerPhone?: string,
    notes?: string,
    isOnlineMeeting?: boolean,
    location?: string
  ): Promise<{
    success: boolean
    event?: {
      id: string
      start?: { dateTime: string }
      onlineMeeting?: { joinUrl: string }
    }
    eventId?: string
    error?: string
  }> {
    try {
      const bookingRequest = {
        clientId,
        subject: `${appointmentType} - ${customerName}`,
        startDateTime,
        endDateTime,
        attendeeEmail: customerEmail,
        description: [
          appointmentType,
          callContext ? `Call Context: ${callContext}` : '',
          notes ? `Notes: ${notes}` : ''
        ].filter(Boolean).join('\n\n'),
        location,
        isOnlineMeeting: isOnlineMeeting ?? true,
        metadata: {
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
      
      const result = await FinalOptimizedCalendarOperations.createCalendarEventForClient(
        clientId,
        bookingRequest
      )
      
      if (result.success) {
        console.log(`✅ Booking created successfully`)
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
        console.log(`❌ Booking creation failed: ${result.error}`)
        return {
          success: false,
          error: result.error || 'Failed to create appointment'
        }
      }
      
    } catch (error) {
      console.error(`❌ Booking creation error:`, error)
      return {
        success: false,
        error: `Booking creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }
  
  /**
   * Main booking method - Simplified 4-step flow
   */
  static async bookAppointment({
    clientId,
    customerName,
    customerEmail,
    customerPhone,
    callContext,
    appointmentType,
    preferredDateTime,
    duration = 60,
    notes,
    isOnlineMeeting = true,
    location
  }: {
    clientId: number
    customerName: string
    customerEmail?: string
    customerPhone?: string
    callContext?: string
    appointmentType: string
    preferredDateTime: string
    duration?: number
    notes?: string
    isOnlineMeeting?: boolean
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
      startFormatted: string
      endFormatted: string
      confidence: number
    }>
    suggestedAction?: string
  }> {
    console.log(`📅 SIMPLIFIED BOOKING FLOW - Starting for client ${clientId}`)
    console.log(`   Customer: ${customerName}`)
    console.log(`   Requested time: ${preferredDateTime}`)
    console.log(`   Type: ${appointmentType}`)
    
    try {
      // STEP 1: Customer lookup
      console.log(`\n👤 STEP 1: Customer lookup`)
      const customerResult = await this.findCustomer(customerName, clientId)
      
      let finalCustomerEmail: string
      let finalCustomerName: string
      let customerId: number | null = null
      
      if (customerResult.found && customerResult.customer) {
        console.log(`✅ Customer found: ${customerResult.customer.email}`)
        finalCustomerEmail = customerResult.customer.email
        finalCustomerName = customerResult.customer.full_name
        customerId = customerResult.customer.id
      } else if (customerEmail) {
        console.log(`📧 Using provided email: ${customerEmail}`)
        finalCustomerEmail = customerEmail
        finalCustomerName = customerName
      } else {
        console.log(`❌ No customer found and no email provided`)
        return {
          success: false,
          error: `Customer "${customerName}" not found in system`,
          suggestedAction: 'Please provide the customer\'s email address'
        }
      }
      
      // Get client info
      const clientData = await AdvancedCacheService.getClientCalendarData(clientId)
      if (!clientData) {
        return {
          success: false,
          error: 'Client calendar not configured',
          suggestedAction: 'Please contact support to set up calendar integration'
        }
      }
      
      const agentInfo = await getAgentByCalendarConnection(clientData.connection.id, clientId)
      if (!agentInfo) {
        return {
          success: false,
          error: 'Agent not found for calendar',
          suggestedAction: 'Please contact support'
        }
      }
      
      const agent = agentInfo.agents as unknown as {
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
      
      const profile = Array.isArray(agent.profiles) ? agent.profiles[0] : agent.profiles
      
      // STEP 2: Parse date/time
      console.log(`\n🕐 STEP 2: Date/time parsing`)
      const parseResult = this.parseDateTime(preferredDateTime, clientData.timezone || 'Australia/Melbourne')
      if (!parseResult.success) {
        return {
          success: false,
          error: parseResult.error || 'Could not parse date/time',
          suggestedAction: 'Please provide a valid date and time'
        }
      }
      
      // STEP 3: Check availability
      console.log(`\n🔍 STEP 3: Availability check`)
      const availabilityResult = await this.checkAvailabilityInternal(
        clientId,
        parseResult.startDateTime!,
        parseResult.endDateTime!,
        profile.timezone,
        profile.office_hours
      )
      
      if (!availabilityResult.available) {
        return {
          success: false,
          error: availabilityResult.error || 'Time slot unavailable',
          availableSlots: availabilityResult.availableSlots || [],
          suggestedAction: availabilityResult.availableSlots?.length 
            ? 'Here are some available alternative times'
            : 'Please choose a different time'
        }
      }
      
      // STEP 4: Create booking
      console.log(`\n📝 STEP 4: Creating booking`)
      const bookingResult = await this.createBooking(
        clientId,
        finalCustomerName,
        finalCustomerEmail,
        customerId,
        appointmentType,
        parseResult.startDateTime!,
        parseResult.endDateTime!,
        agent.id,
        agent.agent_type,
        callContext,
        customerPhone,
        notes,
        isOnlineMeeting,
        location
      )
      
      if (bookingResult.success) {
        console.log(`✅ BOOKING COMPLETED SUCCESSFULLY`)
        return {
          success: true,
          event: bookingResult.event,
          eventId: bookingResult.eventId
        }
      } else {
        console.log(`❌ BOOKING FAILED: ${bookingResult.error}`)
        return {
          success: false,
          error: bookingResult.error || 'Booking failed',
          suggestedAction: 'Please try again or contact support'
        }
      }
      
    } catch (error) {
      console.error(`❌ SIMPLIFIED BOOKING ERROR:`, error)
      return {
        success: false,
        error: `Booking failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        suggestedAction: 'Please try again or contact support'
      }
    }
  }
  
  /**
   * Check availability without booking
   */
  static async checkAvailability({
    clientId,
    dateRequest,
    startDate,
    endDate,
    duration = 60, // eslint-disable-line @typescript-eslint/no-unused-vars
    maxSlots = 10
  }: {
    clientId: number
    dateRequest?: string
    startDate?: string
    endDate?: string
    duration?: number
    maxSlots?: number
  }): Promise<{
    success: boolean
    availableSlots?: Array<{
      startFormatted: string
      endFormatted: string
      confidence: number
    }>
    error?: string
  }> {
    try {
      console.log(`🔍 SIMPLIFIED AVAILABILITY CHECK for client ${clientId}`)
      
      // Use existing implementation
      const result = await FinalOptimizedCalendarOperations.findAvailableSlotsForClient(
        clientId,
        startDate || dateRequest || 'today',
        endDate || 'today',
        duration,
        maxSlots
      )
      
      return {
        success: true,
        availableSlots: result.availableSlots || []
      }
      
    } catch (error) {
      console.error(`❌ Availability check error:`, error)
      return {
        success: false,
        error: `Availability check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }
}
