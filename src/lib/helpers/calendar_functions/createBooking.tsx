import type { 
  CalManagedUser, 
  CreateBookingRequest, 
  CreateBookingResponse, 
  BookingCreationSummary,
  CancelBookingRequest,
  CancelBookingResponse,
  BookingCancellationSummary,
  RescheduleBookingRequest,
  RescheduleBookingResponse,
  BookingRescheduleSummary,
  EventType 
} from '@/types'
import { getManagedUsersByClientId } from './getCalendarEvents'
import { getEventTypesForClient } from './getEventTypes'
import { getConnectedCalendarsForClient, getPrimaryCalendarForClient } from './getConnectedCalendars'

/**
 * Creates a booking via Cal.com API using a managed user's access token
 * @param managedUser - The managed user with access token
 * @param bookingRequest - The booking creation request
 * @returns Promise<CreateBookingResponse> - The booking creation response
 */
export async function createCalBookingForUser(
  managedUser: CalManagedUser,
  bookingRequest: CreateBookingRequest
): Promise<CreateBookingResponse> {
  try {
    const baseUrl = 'https://api.cal.com/v2/bookings'

    console.log(`📅 Creating booking for user ${managedUser.email}...`, {
      eventTypeId: bookingRequest.eventTypeId,
      start: bookingRequest.start,
      attendeeEmail: bookingRequest.attendee.email
    })

    console.log("Booking Request: ", bookingRequest)
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${managedUser.access_token}`,
        'cal-api-version': '2024-08-13',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(bookingRequest)
    })

    
    const result: CreateBookingResponse = await response.json()

    if (!response.ok) {
      console.error(`❌ Cal.com API error for user ${managedUser.email}:`, response.status, response.statusText)
      return {
        status: 'error',
        error: {
          message: `HTTP ${response.status}: ${response.statusText}`,
          details: result
        }
      }
    }

    if (result.status === 'success') {
      console.log(`✅ Booking created successfully for user ${managedUser.email}:`, {
        bookingId: result.data?.id,
        bookingUid: result.data?.uid,
        title: result.data?.title
      })
      return result
    } else {
      console.error('❌ Cal.com API returned error:', result.error)
      return result

    }
  } catch (error) {
    console.error(`💥 Error creating Cal.com booking for user ${managedUser.email}:`, error)
    return {
      status: 'error',
      error: {
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        details: error
      }
    }
  }
}

/**
 * Creates a booking for a client using their managed users
 * @param clientId - The ID of the client
 * @param bookingRequest - The booking creation request
 * @param preferredManagedUserId - Optional preferred managed user ID
 * @returns Promise<BookingCreationSummary> - Summary of the booking creation
 */
export async function createBookingForClient(
  clientId: number,
  bookingRequest: CreateBookingRequest,
  preferredManagedUserId?: number
): Promise<BookingCreationSummary> {
  try {
    console.log(`🎯 Creating booking for client ${clientId}...`)

    // Get both managed users and connected calendars for the client
    const [managedUsers, connectedCalendars] = await Promise.all([
      getManagedUsersByClientId(clientId),
      getConnectedCalendarsForClient(clientId)
    ])

    if (managedUsers.length === 0) {
      return {
        success: false,
        error: `No managed users found for client ${clientId}`
      }
    }

    if (connectedCalendars.length === 0) {
      return {
        success: false,
        error: `No connected calendars found for client ${clientId}. Please connect a calendar first.`
      }
    }

    // Select the managed user to use for booking creation
    let selectedUser: CalManagedUser | undefined

    if (preferredManagedUserId) {
      selectedUser = managedUsers.find(user => user.id === preferredManagedUserId)
      if (!selectedUser) {
        console.log(`⚠️ Preferred managed user ${preferredManagedUserId} not found, using calendar-based selection`)
      }
    }

    // If no preferred user, select based on connected calendar
    if (!selectedUser) {
      // Get the primary connected calendar
      const primaryCalendar = await getPrimaryCalendarForClient(clientId)
      
      if (primaryCalendar) {
        // Find the managed user that matches the primary calendar's cal_user_id
        selectedUser = managedUsers.find(user => user.cal_user_id === primaryCalendar.cal_user_id)
        
        if (selectedUser) {
          console.log(`📅 Selected managed user based on primary calendar: ${selectedUser.email} (cal_user_id: ${selectedUser.cal_user_id})`)
          console.log(`📅 Primary calendar: ${primaryCalendar.account_email} (${primaryCalendar.calendar_type})`)
        } else {
          console.log(`⚠️ No managed user found for primary calendar cal_user_id: ${primaryCalendar.cal_user_id}`)
        }
      }
      
      // If still no user selected, use the first available
      if (!selectedUser) {
        selectedUser = managedUsers[0]
        console.log(`⚠️ Using first available managed user: ${selectedUser.email} (ID: ${selectedUser.id})`)
      }
    }

    console.log(`👤 Final selected managed user: ${selectedUser.email} (ID: ${selectedUser.id}, cal_user_id: ${selectedUser.cal_user_id})`)

    // Create the booking
    const result = await createCalBookingForUser(selectedUser, bookingRequest)

    if (result.status === 'success' && result.data) {
      return {
        success: true,
        bookingId: result.data.id,
        bookingUid: result.data.uid,
        eventTitle: result.data.title,
        startTime: result.data.startTime,
        endTime: result.data.endTime,
        attendeeEmail: bookingRequest.attendee.email,
        attendeeName: bookingRequest.attendee.name
      }
    } else {
      return {
        success: false,
        error: result.error?.message || 'Unknown error occurred during booking creation'
      }
    }
  } catch (error) {
    console.error('💥 Unexpected error in createBookingForClient:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }
  }
}

/**
 * Validates a booking request before creation
 * @param bookingRequest - The booking request to validate
 * @param clientEventTypes - Available event types for the client
 * @returns string | null - Error message if invalid, null if valid
 */
export function validateBookingRequest(
  bookingRequest: CreateBookingRequest,
  clientEventTypes: EventType[]
): string | null {
  // Check if event type exists for the client
  const eventType = clientEventTypes.find(et => et.cal_event_type_id === bookingRequest.eventTypeId)
  if (!eventType) {
    return `Event type ${bookingRequest.eventTypeId} not found for this client`
  }

  if (!eventType.is_active) {
    return `Event type ${bookingRequest.eventTypeId} is not active`
  }

  // Validate required fields
  if (!bookingRequest.attendee.name || !bookingRequest.attendee.email) {
    return 'Attendee name and email are required'
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(bookingRequest.attendee.email)) {
    return 'Invalid email format'
  }

  // Validate start time
  const startTime = new Date(bookingRequest.start)
  if (isNaN(startTime.getTime())) {
    return 'Invalid start time format'
  }

  // Check if start time is in the future
  if (startTime <= new Date()) {
    return 'Start time must be in the future'
  }

  return null // Valid
}

/**
 * Creates a booking with full validation for a client
 * @param clientId - The ID of the client
 * @param bookingRequest - The booking creation request
 * @param preferredManagedUserId - Optional preferred managed user ID
 * @returns Promise<BookingCreationSummary> - Summary of the booking creation
 */
export async function createValidatedBookingForClient(
  clientId: number,
  bookingRequest: CreateBookingRequest,
  preferredManagedUserId?: number
): Promise<BookingCreationSummary> {
  try {
    console.log(`🔍 Validating booking request for client ${clientId}...`)

    // Get client's event types for validation
    const eventTypes = await getEventTypesForClient(clientId)
    
    if (eventTypes.length === 0) {
      return {
        success: false,
        error: `No event types found for client ${clientId}`
      }
    }

    // Validate the booking request
    const validationError = validateBookingRequest(bookingRequest, eventTypes)
    if (validationError) {
      return {
        success: false,
        error: `Validation failed: ${validationError}`
      }
    }

    console.log(`✅ Booking request validated successfully`)

    // Create the booking
    return await createBookingForClient(clientId, bookingRequest, preferredManagedUserId)
  } catch (error) {
    console.error('💥 Unexpected error in createValidatedBookingForClient:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }
  }
}

/**
 * Cancels a booking via Cal.com API using a managed user's access token
 * @param managedUser - The managed user with access token
 * @param bookingUid - The UID of the booking to cancel
 * @param cancelRequest - The cancellation request data
 * @returns Promise<CancelBookingResponse> - The booking cancellation response
 */
export async function cancelCalBookingForUser(
  managedUser: CalManagedUser,
  bookingUid: string,
  cancelRequest: CancelBookingRequest
): Promise<CancelBookingResponse> {
  try {
    const baseUrl = `https://api.cal.com/v2/bookings/${bookingUid}/cancel`

    console.log(`🗑️ Canceling booking ${bookingUid} for user ${managedUser.email}...`, {
      cancellationReason: cancelRequest.cancellationReason,
      cancelSubsequentBookings: cancelRequest.cancelSubsequentBookings,
      seatUid: cancelRequest.seatUid
    })

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${managedUser.access_token}`,
        'cal-api-version': '2024-08-13',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(cancelRequest)
    })

    const result: CancelBookingResponse = await response.json()

    if (!response.ok) {
      console.error(`❌ Cal.com API error for user ${managedUser.email}:`, response.status, response.statusText)
      return {
        status: 'error',
        error: {
          message: `HTTP ${response.status}: ${response.statusText}`,
          details: result
        }
      }
    }

    if (result.status === 'success') {
      console.log(`✅ Booking canceled successfully for user ${managedUser.email}:`, {
        bookingId: result.data?.id,
        bookingUid: result.data?.uid,
        title: result.data?.title,
        cancellationReason: result.data?.cancellationReason
      })
      return result
    } else {
      console.error('❌ Cal.com API returned error:', result.error)
      return result
    }
  } catch (error) {
    console.error(`💥 Error canceling Cal.com booking for user ${managedUser.email}:`, error)
    return {
      status: 'error',
      error: {
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        details: error
      }
    }
  }
}

/**
 * Cancels a booking for a client using their managed users
 * @param clientId - The ID of the client
 * @param bookingUid - The UID of the booking to cancel
 * @param cancelRequest - The cancellation request data
 * @param preferredManagedUserId - Optional preferred managed user ID
 * @returns Promise<BookingCancellationSummary> - Summary of the booking cancellation
 */
export async function cancelBookingForClient(
  clientId: number,
  bookingUid: string,
  cancelRequest: CancelBookingRequest,
  preferredManagedUserId?: number
): Promise<BookingCancellationSummary> {
  try {
    console.log(`🎯 Canceling booking ${bookingUid} for client ${clientId}...`)

    // Get managed users for the client
    const managedUsers = await getManagedUsersByClientId(clientId)

    if (managedUsers.length === 0) {
      return {
        success: false,
        error: `No managed users found for client ${clientId}`
      }
    }

    // Select the managed user to use for booking cancellation
    let selectedUser: CalManagedUser | undefined

    if (preferredManagedUserId) {
      selectedUser = managedUsers.find(user => user.id === preferredManagedUserId)
      if (!selectedUser) {
        console.log(`⚠️ Preferred managed user ${preferredManagedUserId} not found, using first available`)
      }
    }

    // If no preferred user or preferred user not found, use the first one
    if (!selectedUser) {
      selectedUser = managedUsers[0]
    }

    console.log(`👤 Using managed user: ${selectedUser.email} (ID: ${selectedUser.id})`)

    // Cancel the booking
    const result = await cancelCalBookingForUser(selectedUser, bookingUid, cancelRequest)

    if (result.status === 'success' && result.data) {
      return {
        success: true,
        bookingId: result.data.id,
        bookingUid: result.data.uid,
        eventTitle: result.data.title,
        cancellationReason: result.data.cancellationReason,
        cancelledByEmail: result.data.cancelledByEmail,
        wasSeatedBooking: !!cancelRequest.seatUid
      }
    } else {
      return {
        success: false,
        error: result.error?.message || 'Unknown error occurred during booking cancellation'
      }
    }
  } catch (error) {
    console.error('💥 Unexpected error in cancelBookingForClient:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }
  }
}

/**
 * Reschedules a booking via Cal.com API using a managed user's access token
 * @param managedUser - The managed user with access token
 * @param bookingUid - The UID of the booking to reschedule
 * @param rescheduleRequest - The rescheduling request data
 * @returns Promise<RescheduleBookingResponse> - The booking rescheduling response
 */
export async function rescheduleCalBookingForUser(
  managedUser: CalManagedUser,
  bookingUid: string,
  rescheduleRequest: RescheduleBookingRequest
): Promise<RescheduleBookingResponse> {
  try {
    const baseUrl = `https://api.cal.com/v2/bookings/${bookingUid}/reschedule`

    console.log(`📅 Rescheduling booking ${bookingUid} for user ${managedUser.email}...`, {
      newStartTime: rescheduleRequest.start,
      reschedulingReason: rescheduleRequest.reschedulingReason,
      rescheduledBy: rescheduleRequest.rescheduledBy,
      seatUid: rescheduleRequest.seatUid
    })

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${managedUser.access_token}`,
        'cal-api-version': '2024-08-13',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(rescheduleRequest)
    })

    const result: RescheduleBookingResponse = await response.json()

    if (!response.ok) {
      console.error(`❌ Cal.com API error for user ${managedUser.email}:`, response.status, response.statusText)
      return {
        status: 'error',
        error: {
          message: `HTTP ${response.status}: ${response.statusText}`,
          details: result
        }
      }
    }

    if (result.status === 'success') {
      console.log(`✅ Booking rescheduled successfully for user ${managedUser.email}:`, {
        bookingId: result.data?.id,
        newBookingUid: result.data?.uid,
        title: result.data?.title,
        newStartTime: result.data?.start,
        newEndTime: result.data?.end
      })
      return result
    } else {
      console.error('❌ Cal.com API returned error:', result.error)
      return result
    }
  } catch (error) {
    console.error(`💥 Error rescheduling Cal.com booking for user ${managedUser.email}:`, error)
    return {
      status: 'error',
      error: {
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        details: error
      }
    }
  }
}

/**
 * Reschedules a booking for a client using their managed users
 * @param clientId - The ID of the client
 * @param bookingUid - The UID of the booking to reschedule
 * @param rescheduleRequest - The rescheduling request data
 * @param preferredManagedUserId - Optional preferred managed user ID
 * @returns Promise<BookingRescheduleSummary> - Summary of the booking rescheduling
 */
export async function rescheduleBookingForClient(
  clientId: number,
  bookingUid: string,
  rescheduleRequest: RescheduleBookingRequest,
  preferredManagedUserId?: number
): Promise<BookingRescheduleSummary> {
  try {
    console.log(`🎯 Rescheduling booking ${bookingUid} for client ${clientId}...`)

    // Get managed users for the client
    const managedUsers = await getManagedUsersByClientId(clientId)

    if (managedUsers.length === 0) {
      return {
        success: false,
        error: `No managed users found for client ${clientId}`
      }
    }

    // Select the managed user to use for booking rescheduling
    let selectedUser: CalManagedUser | undefined

    if (preferredManagedUserId) {
      selectedUser = managedUsers.find(user => user.id === preferredManagedUserId)
      if (!selectedUser) {
        console.log(`⚠️ Preferred managed user ${preferredManagedUserId} not found, using first available`)
      }
    }

    // If no preferred user or preferred user not found, use the first one
    if (!selectedUser) {
      selectedUser = managedUsers[0]
    }

    console.log(`👤 Using managed user: ${selectedUser.email} (ID: ${selectedUser.id})`)

    // Reschedule the booking
    const result = await rescheduleCalBookingForUser(selectedUser, bookingUid, rescheduleRequest)

    if (result.status === 'success' && result.data) {
      return {
        success: true,
        bookingId: result.data.id,
        bookingUid: bookingUid,
        newBookingUid: result.data.uid,
        eventTitle: result.data.title,
        newStartTime: result.data.start,
        newEndTime: result.data.end,
        reschedulingReason: result.data.reschedulingReason,
        rescheduledByEmail: result.data.rescheduledByEmail,
        wasSeatedBooking: !!rescheduleRequest.seatUid
      }
    } else {
      return {
        success: false,
        error: result.error?.message || 'Unknown error occurred during booking rescheduling'
      }
    }
  } catch (error) {
    console.error('💥 Unexpected error in rescheduleBookingForClient:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }
  }
}
