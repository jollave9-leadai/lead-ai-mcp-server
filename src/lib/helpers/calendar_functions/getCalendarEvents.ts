import { createClient } from '@/lib/helpers/server'
import type { CalManagedUser, CalBooking, CalBookingsResponse, SearchCriteria } from '@/types'
import { hasActiveCalendarConnections } from './getConnectedCalendars'
import { hasActiveEventTypes, getCalEventTypeIdsForClient } from './getEventTypes'

/**
 * Retrieves all managed users for a specific client
 * @param clientId - The ID of the client
 * @returns Promise<CalManagedUser[]> - Array of managed users or empty array
 */
export async function getManagedUsersByClientId(clientId: number): Promise<CalManagedUser[]> {
  try {
    const supabase = createClient()
    
      const { data, error } = await supabase.rpc('get_managed_users_for_client', {
        p_client_id: clientId
      })
      if (error) {
        console.error('❌ RPC call failed:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code
        })
        
      }
      return data as CalManagedUser[]
    
  } catch (error) {
    console.error('💥 Unexpected error in getManagedUsersByClientId:', error)
    return []
  }
}

/**
 * Fetches bookings from Cal.com API for a specific managed user
 * @param managedUser - The managed user with access token
 * @param options - Essential query parameters for filtering bookings (eventTypeIds, afterStart, beforeEnd)
 * @returns Promise<CalBooking[]> - Array of bookings
 */
export async function fetchCalBookingsForUser(
  managedUser: CalManagedUser,
  options: {
    eventTypeIds?: string
    afterStart?: string
    beforeEnd?: string
  } = {}
): Promise<CalBooking[]> {
  try {
    const baseUrl = 'https://api.cal.com/v2/bookings'
    const queryParams = new URLSearchParams()

    // Add essential query parameters (most common usage)
    if (options.eventTypeIds) queryParams.append('eventTypeIds', options.eventTypeIds)
    if (options.afterStart) queryParams.append('afterStart', options.afterStart)
    if (options.beforeEnd) queryParams.append('beforeEnd', options.beforeEnd)
    

    const url = `${baseUrl}?${queryParams.toString()}`
    console.log("URL for fetching : ", url)

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${managedUser.access_token}`,
        'cal-api-version': '2024-08-13',
        'Content-Type': 'application/json'
      }
    })

    const result: CalBookingsResponse = await response.json()

    if (result.status === 'success') {
      return result.data
    } else {
      console.error('Cal.com API returned error:', result.error)
      return []
    }
  } catch (error) {
    console.error(`Error fetching Cal.com bookings for user ${managedUser.email}:`, error)
    return []
  }
}

/**
 * Main function to get calendar events for a client
 * @param clientId - The ID of the client
 * @param options - Essential query parameters for filtering bookings (eventTypeIds, afterStart, beforeEnd)
 * @returns Promise<CalBooking[]> - Array of all bookings from all managed users
 */
export async function getCalendarEvents(
  clientId: number,
  options: {
    eventTypeIds?: string
    afterStart?: string
    beforeEnd?: string
    // Optional parameters for advanced use cases
    status?: string[]
    take?: number
    skip?: number
  } = {}
): Promise<CalBooking[]> {
  try {
    console.log(`🗓️ Starting calendar events fetch for client ${clientId}...`)
    
    // First, check if client has connected calendars
    const hasConnectedCalendars = await hasActiveCalendarConnections(clientId)
    
    if (!hasConnectedCalendars) {
      console.log(`❌ Client ${clientId} has no connected calendars. Cannot fetch events.`)
      return []
    }
    
    console.log(`✅ Client ${clientId} has connected calendars.`)
    
    // Second, check if client has active event types
    const hasEventTypes = await hasActiveEventTypes(clientId)
    
    if (!hasEventTypes) {
      console.log(`❌ Client ${clientId} has no active event types. Cannot fetch events.`)
      return []
    }
    
    console.log(`✅ Client ${clientId} has active event types.`)
    
    // Get cal_event_type_ids for the client if not provided in options
    let eventTypeIds = options.eventTypeIds
    if (!eventTypeIds) {
      eventTypeIds = await getCalEventTypeIdsForClient(clientId) || undefined
      if (!eventTypeIds) {
        console.log(`❌ Could not retrieve event type IDs for client ${clientId}`)
        return []
      }
      console.log(`📋 Using client's event type IDs: ${eventTypeIds}`)
    }
    
    // Update options with event type IDs
    const updatedOptions = {
      ...options,
      eventTypeIds
    }
    
    console.log(`🔍 Proceeding to fetch managed users...`)
    
    // Get all managed users for the client
    const managedUsers = await getManagedUsersByClientId(clientId)

    if (managedUsers.length === 0) {
      console.log(`❌ No active managed users found for client ${clientId}`)
      return []
    }

    console.log(`👥 Found ${managedUsers.length} managed users. Fetching bookings with event type IDs...`)

    // Fetch bookings for each managed user in parallel
    const bookingPromises = managedUsers.map(user => 
      fetchCalBookingsForUser(user, updatedOptions)
    )

    const bookingResults = await Promise.all(bookingPromises)

    // Flatten the results and sort by start time
    const allBookings = bookingResults.flat()
    
    // Sort bookings by start time (most recent first)
    allBookings.sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime())

    console.log(`📅 Successfully fetched ${allBookings.length} calendar events for client ${clientId}`)

    return allBookings
  } catch (error) {
    console.error('💥 Unexpected error in getCalendarEvents:', error)
    return []
  }
}

/**
 * Get calendar events for today for a specific client
 * @param clientId - The ID of the client
 * @param timezone - The timezone to use for "today" calculation
 * @returns Promise<CalBooking[]> - Array of today's bookings
 */
export async function getTodaysCalendarEvents(
  clientId: number,
  timezone: string = 'UTC'
): Promise<CalBooking[]> {
  try {
    const now = new Date()
    const today = new Date(now.toLocaleString('en-US', { timeZone: timezone }))
    
    // Start of today
    const startOfDay = new Date(today)
    startOfDay.setHours(0, 0, 0, 0)
    
    // End of today
    const endOfDay = new Date(today)
    endOfDay.setHours(23, 59, 59, 999)

    return await getCalendarEvents(clientId, {
      afterStart: startOfDay.toISOString(),
      beforeEnd: endOfDay.toISOString(),
      status: ['accepted', 'pending']
    })
  } catch (error) {
    console.error('Error in getTodaysCalendarEvents:', error)
    return []
  }
}

/**
 * Get upcoming calendar events for a specific client
 * @param clientId - The ID of the client
 * @param daysAhead - Number of days to look ahead (default: 7)
 * @returns Promise<CalBooking[]> - Array of upcoming bookings
 */
export async function getUpcomingCalendarEvents(
  clientId: number,
  daysAhead: number = 7
): Promise<CalBooking[]> {
  try {
    const now = new Date()
    const futureDate = new Date(now)
    futureDate.setDate(now.getDate() + daysAhead)

    return await getCalendarEvents(clientId, {
      afterStart: now.toISOString(),
      beforeEnd: futureDate.toISOString(),
      status: ['accepted', 'pending'],
      take: 50 // Limit to 50 upcoming events
    })
  } catch (error) {
    console.error('Error in getUpcomingCalendarEvents:', error)
    return []
  }
}

/**
 * Search for bookings by various criteria (title, date, attendee email, etc.)
 * @param clientId - The ID of the client
 * @param searchCriteria - Object containing search parameters
 * @returns Promise<CalBooking[]> - Array of matching bookings
 */
export async function searchBookings(
  clientId: number,
  searchCriteria: {
    title?: string
    attendeeEmail?: string
    date?: string // YYYY-MM-DD format
    dateRange?: { start: string, end: string }
    status?: string[]
  }
): Promise<CalBooking[]> {
  try {
    console.log(`🔍 Searching bookings for client ${clientId} with criteria:`, searchCriteria)
    
    // Determine date range for search
    let afterStart: string
    let beforeEnd: string
    
    if (searchCriteria.dateRange) {
      afterStart = searchCriteria.dateRange.start
      beforeEnd = searchCriteria.dateRange.end
    } else if (searchCriteria.date) {
      // Search for specific date
      const searchDate = new Date(searchCriteria.date)
      const startOfDay = new Date(searchDate)
      startOfDay.setHours(0, 0, 0, 0)
      const endOfDay = new Date(searchDate)
      endOfDay.setHours(23, 59, 59, 999)
      
      afterStart = startOfDay.toISOString()
      beforeEnd = endOfDay.toISOString()
    } else {
      // Default to next 30 days if no date specified
      const now = new Date()
      const futureDate = new Date(now)
      futureDate.setDate(now.getDate() + 30)
      
      afterStart = now.toISOString()
      beforeEnd = futureDate.toISOString()
    }
    
    // Get all bookings in the date range
    const allBookings = await getCalendarEvents(clientId, {
      afterStart,
      beforeEnd,
      status: searchCriteria.status || ['accepted', 'pending', 'cancelled']
    })
    
    console.log(`📋 Found ${allBookings.length} bookings in date range, applying filters...`)
    
    // Filter bookings based on search criteria
    let filteredBookings = allBookings
    
    // Filter by title (case-insensitive partial match)
    if (searchCriteria.title) {
      const titleSearch = searchCriteria.title.toLowerCase()
      filteredBookings = filteredBookings.filter(booking => 
        booking.title?.toLowerCase().includes(titleSearch)
      )
      console.log(`🏷️ After title filter ("${searchCriteria.title}"): ${filteredBookings.length} bookings`)
    }
    
    // Filter by attendee email (case-insensitive partial match)
    if (searchCriteria.attendeeEmail) {
      const emailSearch = searchCriteria.attendeeEmail.toLowerCase()
      filteredBookings = filteredBookings.filter(booking => 
        booking.attendees?.some(attendee => 
          attendee.email?.toLowerCase().includes(emailSearch) ||
          attendee.name?.toLowerCase().includes(emailSearch)
        )
      )
      console.log(`📧 After attendee filter ("${searchCriteria.attendeeEmail}"): ${filteredBookings.length} bookings`)
    }
    
    console.log(`✅ Final search result: ${filteredBookings.length} matching bookings`)
    
    return filteredBookings
  } catch (error) {
    console.error('💥 Error in searchBookings:', error)
    return []
  }
}

/**
 * Find a specific booking by title and optional date for rescheduling
 * @param clientId - The ID of the client
 * @param title - The title or partial title of the booking
 * @param date - Optional specific date (YYYY-MM-DD) or relative date ("tomorrow", "today")
 * @param timezone - Client timezone for date parsing
 * @returns Promise<CalBooking | null> - The found booking or null
 */
export async function findBookingForReschedule(
  clientId: number,
  title: string,
  date?: string,
): Promise<CalBooking | null> {
  try {
    console.log(`🎯 Finding booking for reschedule: "${title}" on ${date || 'any date'}`)
    
    const searchCriteria: SearchCriteria = { title }
    
    // Parse date if provided
    if (date) {
      // Handle relative dates
      if (date.toLowerCase().includes('today')) {
        const today = new Date().toISOString().split('T')[0]
        searchCriteria.date = today
      } else if (date.toLowerCase().includes('tomorrow')) {
        const tomorrow = new Date()
        tomorrow.setDate(tomorrow.getDate() + 1)
        searchCriteria.date = tomorrow.toISOString().split('T')[0]
      } else {
        // Try to parse as specific date
        try {
          const parsedDate = new Date(date)
          if (!isNaN(parsedDate.getTime())) {
            searchCriteria.date = parsedDate.toISOString().split('T')[0]
          }
        } catch (error) {
          console.log(`⚠️ Could not parse date "${date}", searching all dates Error: ${error}`)
        }
      }
    }
    
    const matchingBookings = await searchBookings(clientId, searchCriteria)
    
    if (matchingBookings.length === 0) {
      console.log(`❌ No bookings found matching title "${title}"`)
      return null
    }
    
    if (matchingBookings.length === 1) {
      console.log(`✅ Found exactly one matching booking: ${matchingBookings[0].uid}`)
      return matchingBookings[0]
    }
    
    // Multiple matches - return the closest upcoming one
    const now = new Date()
    const upcomingBookings = matchingBookings
      .filter(booking => new Date(booking.start) > now)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
    
    if (upcomingBookings.length > 0) {
      console.log(`🔄 Multiple matches found, returning closest upcoming booking: ${upcomingBookings[0].uid}`)
      return upcomingBookings[0]
    }
    
    // No upcoming bookings, return the most recent one
    const sortedBookings = matchingBookings.sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime())
    console.log(`📅 No upcoming matches, returning most recent booking: ${sortedBookings[0].uid}`)
    return sortedBookings[0]
    
  } catch (error) {
    console.error('💥 Error in findBookingForReschedule:', error)
    return null
  }
}