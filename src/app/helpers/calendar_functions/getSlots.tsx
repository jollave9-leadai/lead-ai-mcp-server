import { createClient } from '../lib/supbase/server/route'
import type { 
  CalManagedUser, 
  GetSlotsRequest, 
  SlotsResponse, 
  SlotsSummary,
  SlotValidationResult,
  SlotTime,
  SlotRange
} from '../types'
import { getManagedUsersByClientId } from './getCalendarEvents'
import { getPrimaryCalendarForClient } from './getConnectedCalendars'

/**
 * Fetches available slots from Cal.com API using a managed user's access token
 * @param managedUser - The managed user with access token
 * @param slotsRequest - The slots request parameters
 * @returns Promise<SlotsResponse> - The slots response
 */
export async function fetchSlotsForUser(
  managedUser: CalManagedUser,
  slotsRequest: GetSlotsRequest
): Promise<SlotsResponse> {
  try {
    const baseUrl = 'https://api.cal.com/v2/slots'
    const queryParams = new URLSearchParams()

    // Required parameters - Cal.com API often works better with date-only format for wider ranges
    const startDate = new Date(slotsRequest.start)
    const endDate = new Date(slotsRequest.end)
    
    // Calculate the range in days
    const rangeDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    
    console.log(`📊 Date range: ${rangeDays} days (${slotsRequest.start} to ${slotsRequest.end})`)
    
    // For ranges > 3 days, use date-only format which often works better
    if (rangeDays > 3) {
      queryParams.append('start', startDate.toISOString().split('T')[0])
      queryParams.append('end', endDate.toISOString().split('T')[0])
      console.log(`📅 Using date-only format for ${rangeDays}-day range`)
    } else {
      queryParams.append('start', slotsRequest.start)
      queryParams.append('end', slotsRequest.end)
      console.log(`⏰ Using full datetime format for ${rangeDays}-day range`)
    }

    // Event type identification
    if (slotsRequest.eventTypeId) {
      queryParams.append('eventTypeId', slotsRequest.eventTypeId.toString())
    }

    const url = `${baseUrl}?${queryParams.toString()}`

    console.log(`🕒 Fetching slots for user ${managedUser.email}...`, {
      eventTypeId: slotsRequest.eventTypeId,
      start: slotsRequest.start,
      end: slotsRequest.end
    })

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${managedUser.access_token}`,
        'cal-api-version': '2024-09-04',
        'Content-Type': 'application/json'
      }
    })

    const result: SlotsResponse = await response.json()

    if (!response.ok) {
      console.error(`❌ Cal.com Slots API error for user ${managedUser.email}:`, response.status, response.statusText)
      return {
        status: 'error',
        error: {
          message: `HTTP ${response.status}: ${response.statusText}`,
          details: result
        }
      }
    }

    if (result.status === 'success') {
      const totalSlots = Object.values(result.data || {}).reduce((total, slots) => total + slots.length, 0)
      console.log(`✅ Found ${totalSlots} available slots for user ${managedUser.email}`)
      return result
    } else {
      console.error('❌ Cal.com Slots API returned error:', result.error)
      return result
    }
  } catch (error) {
    console.error(`💥 Error fetching Cal.com slots for user ${managedUser.email}:`, error)
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
 * Gets available slots for a client using their managed users
 * @param clientId - The ID of the client
 * @param slotsRequest - The slots request parameters
 * @param preferredManagedUserId - Optional preferred managed user ID
 * @returns Promise<SlotsResponse> - The slots response
 */
export async function getSlotsForClient(
  clientId: number,
  slotsRequest: GetSlotsRequest,
  preferredManagedUserId?: number
): Promise<SlotsResponse> {
  try {
    console.log(`🎯 Getting slots for client ${clientId}...`)

    // Get managed users for the client
    const managedUsers = await getManagedUsersByClientId(clientId)

    if (managedUsers.length === 0) {
      return {
        status: 'error',
        error: {
          message: `No managed users found for client ${clientId}`
        }
      }
    }

    // Select the managed user to use for slots fetching
    let selectedUser: CalManagedUser | undefined

    if (preferredManagedUserId) {
      selectedUser = managedUsers.find(user => user.id === preferredManagedUserId)
      if (!selectedUser) {
        console.log(`⚠️ Preferred managed user ${preferredManagedUserId} not found, using calendar-based selection`)
      }
    }

    // If no preferred user, select based on connected calendar (same logic as booking)
    if (!selectedUser) {
      const primaryCalendar = await getPrimaryCalendarForClient(clientId)
      
      if (primaryCalendar) {
        selectedUser = managedUsers.find(user => user.cal_user_id === primaryCalendar.cal_user_id)
        
        if (selectedUser) {
          console.log(`📅 Selected managed user based on primary calendar: ${selectedUser.email}`)
        }
      }
      
      // If still no user selected, use the first available
      if (!selectedUser) {
        selectedUser = managedUsers[0]
        console.log(`⚠️ Using first available managed user: ${selectedUser.email}`)
      }
    }

    console.log(`👤 Using managed user: ${selectedUser.email} (ID: ${selectedUser.id})`)

    // Fetch the slots
    return await fetchSlotsForUser(selectedUser, slotsRequest)
  } catch (error) {
    console.error('💥 Unexpected error in getSlotsForClient:', error)
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
 * Creates a summary of available slots
 * @param slotsResponse - The slots response from Cal.com API
 * @param slotsRequest - The original slots request
 * @returns SlotsSummary - Summary of the slots
 */
export function createSlotsSummary(
  slotsResponse: SlotsResponse,
  slotsRequest: GetSlotsRequest
): SlotsSummary {
  if (slotsResponse.status === 'error') {
    return {
      success: false,
      totalSlots: 0,
      availableDates: [],
      slotsPerDate: {},
      dateRange: {
        start: slotsRequest.start,
        end: slotsRequest.end
      },
      error: slotsResponse.error?.message || 'Unknown error'
    }
  }

  const data = slotsResponse.data || {}
  const availableDates = Object.keys(data).sort()
  const slotsPerDate: { [date: string]: number } = {}
  let totalSlots = 0

  availableDates.forEach(date => {
    const slots = data[date] || []
    slotsPerDate[date] = slots.length
    totalSlots += slots.length
  })

  return {
    success: true,
    totalSlots,
    availableDates,
    slotsPerDate,
    dateRange: {
      start: slotsRequest.start,
      end: slotsRequest.end
    }
  }
}

/**
 * Validates if a specific slot is available
 * @param slotsResponse - The slots response from Cal.com API
 * @param requestedSlot - The requested slot time (ISO 8601 string)
 * @returns SlotValidationResult - Validation result
 */
export function validateSlotAvailability(
  slotsResponse: SlotsResponse,
  requestedSlot: string
): SlotValidationResult {
  if (slotsResponse.status === 'error') {
    return {
      isAvailable: false,
      requestedSlot,
      availableSlots: [],
      error: slotsResponse.error?.message || 'Unknown error'
    }
  }

  const data = slotsResponse.data || {}
  const requestedDate = new Date(requestedSlot).toISOString().split('T')[0]
  const requestedDateTime = new Date(requestedSlot)
  
  // Get slots for the requested date
  const slotsForDate = data[requestedDate] || []
  
  // Check if the exact slot is available
  const isAvailable = slotsForDate.some(slot => {
    const slotStart = new Date(slot.start)
    return slotStart.getTime() === requestedDateTime.getTime()
  })

  // Find nearest available slot if requested slot is not available
  let nearestAvailable: SlotTime | SlotRange | undefined

  if (!isAvailable && slotsForDate.length > 0) {
    // Find the closest slot by time difference
    let minTimeDiff = Infinity
    
    slotsForDate.forEach(slot => {
      const slotStart = new Date(slot.start)
      const timeDiff = Math.abs(slotStart.getTime() - requestedDateTime.getTime())
      
      if (timeDiff < minTimeDiff) {
        minTimeDiff = timeDiff
        nearestAvailable = slot
      }
    })
  }

  return {
    isAvailable,
    requestedSlot,
    availableSlots: slotsForDate,
    nearestAvailable
  }
}

/**
 * Gets random available slots from the slots response, prioritizing same-day alternatives
 * @param slotsResponse - The slots response from Cal.com API
 * @param requestedDate - The originally requested date (ISO string) to prioritize same-day slots
 * @param count - Number of random slots to return (default: 3)
 * @returns SlotTime[] | SlotRange[] - Array of random available slots (same day first, then other days)
 */
export function getRandomAvailableSlots(
  slotsResponse: SlotsResponse,
  requestedDate?: string,
  count: number = 3
): (SlotTime | SlotRange)[] {
  if (slotsResponse.status === 'error' || !slotsResponse.data) {
    return []
  }

  const data = slotsResponse.data
  const sameDaySlots: (SlotTime | SlotRange)[] = []
  const otherDaySlots: (SlotTime | SlotRange)[] = []

  // Extract the date part from the requested date for comparison
  const requestedDateOnly = requestedDate ? new Date(requestedDate).toISOString().split('T')[0] : null

  // Separate slots into same-day and other-day categories
  Object.keys(data).forEach(date => {
    const slotsForDate = data[date] || []
    
    if (requestedDateOnly && date === requestedDateOnly) {
      // These are slots on the same day as requested
      sameDaySlots.push(...slotsForDate)
    } else {
      // These are slots on other days
      otherDaySlots.push(...slotsForDate)
    }
  })

  const finalSlots: (SlotTime | SlotRange)[] = []

  // STEP 1: First, try to get random slots from the same day
  if (sameDaySlots.length > 0) {
    const sameDayCount = Math.min(count, sameDaySlots.length)
    const sameDayIndices = Array.from({ length: sameDaySlots.length }, (_, i) => i)
    
    for (let i = 0; i < sameDayCount; i++) {
      const randomIndex = Math.floor(Math.random() * sameDayIndices.length)
      const slotIndex = sameDayIndices[randomIndex]
      finalSlots.push(sameDaySlots[slotIndex])
      
      // Remove the selected index to avoid duplicates
      sameDayIndices.splice(randomIndex, 1)
    }
  }

  // STEP 2: If we still need more slots, get them from other days
  const remainingCount = count - finalSlots.length
  if (remainingCount > 0 && otherDaySlots.length > 0) {
    const otherDayCount = Math.min(remainingCount, otherDaySlots.length)
    const otherDayIndices = Array.from({ length: otherDaySlots.length }, (_, i) => i)
    
    for (let i = 0; i < otherDayCount; i++) {
      const randomIndex = Math.floor(Math.random() * otherDayIndices.length)
      const slotIndex = otherDayIndices[randomIndex]
      finalSlots.push(otherDaySlots[slotIndex])
      
      // Remove the selected index to avoid duplicates
      otherDayIndices.splice(randomIndex, 1)
    }
  }

  // Sort by start time (same day slots will naturally come first due to date ordering)
  finalSlots.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())

  return finalSlots
}

/**
 * Formats random slots for display with booking instructions, highlighting same-day vs other-day slots
 * @param randomSlots - Array of random slots
 * @param requestedDate - The originally requested date to identify same-day slots
 * @param timeZone - Optional timezone for formatting
 * @returns string - Formatted random slots display
 */
export function formatRandomSlotsForBooking(
  randomSlots: (SlotTime | SlotRange)[],
  requestedDate?: string,
  timeZone?: string
): string {
  if (randomSlots.length === 0) {
    return '❌ No alternative slots available'
  }

  const requestedDateOnly = requestedDate ? new Date(requestedDate).toISOString().split('T')[0] : null
  const sameDaySlots: (SlotTime | SlotRange)[] = []
  const otherDaySlots: (SlotTime | SlotRange)[] = []

  // Separate slots into same-day and other-day
  randomSlots.forEach(slot => {
    const slotDateOnly = new Date(slot.start).toISOString().split('T')[0]
    if (requestedDateOnly && slotDateOnly === requestedDateOnly) {
      sameDaySlots.push(slot)
    } else {
      otherDaySlots.push(slot)
    }
  })

  let output = `**🎲 ${randomSlots.length} Available Alternatives:**\n\n`

  let slotCounter = 1

  // Show same-day slots first
  if (sameDaySlots.length > 0) {
    output += `**📅 Same Day Alternatives (${sameDaySlots.length}):**\n\n`
    
    sameDaySlots.forEach((slot) => {
      const startDate = new Date(slot.start)
      const formattedDate = startDate.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: timeZone || 'UTC'
      })
      const formattedTime = startDate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: timeZone || 'UTC'
      })

      output += `**${slotCounter}. ${formattedTime}** ⭐ *Same Day*\n`
      output += `   📅 **Date**: ${formattedDate}\n`
      output += `   ⏰ **Time**: ${formattedTime} (${timeZone || 'UTC'})\n`
      output += `   📝 **ISO Format**: \`${slot.start}\`\n`
      
      if ('end' in slot && slot.end) {
        const endTime = new Date(slot.end as string).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: timeZone || 'UTC'
        })
        output += `   ⏱️ **Duration**: ${formattedTime} - ${endTime}\n`
      }
      
      output += `\n`
      slotCounter++
    })
  }

  // Show other-day slots
  if (otherDaySlots.length > 0) {
    if (sameDaySlots.length > 0) {
      output += `**📆 Other Day Alternatives (${otherDaySlots.length}):**\n\n`
    }
    
    otherDaySlots.forEach((slot) => {
      const startDate = new Date(slot.start)
      const formattedDate = startDate.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: timeZone || 'UTC'
      })
      const formattedTime = startDate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: timeZone || 'UTC'
      })

      output += `**${slotCounter}. ${formattedDate} at ${formattedTime}**\n`
      output += `   📅 **Date**: ${formattedDate}\n`
      output += `   ⏰ **Time**: ${formattedTime} (${timeZone || 'UTC'})\n`
      output += `   📝 **ISO Format**: \`${slot.start}\`\n`
      
      if ('end' in slot && slot.end) {
        const endTime = new Date(slot.end as string).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: timeZone || 'UTC'
        })
        output += `   ⏱️ **Duration**: ${formattedTime} - ${endTime}\n`
      }
      
      output += `\n`
      slotCounter++
    })
  }

  output += `**💡 To book any of these slots:**\n`
  if (sameDaySlots.length > 0) {
    output += `⭐ **Recommended**: Try same-day alternatives first (marked with ⭐)\n`
  }
  output += `1. 📋 **Copy the ISO Format** from your preferred option above\n`
  output += `2. 🔄 **Use CreateBooking tool** again with the new startTime\n`
  output += `3. ✅ **Keep all other details** the same (attendee info, event type, etc.)\n`

  return output
}

/**
 * Formats slots for display
 * @param slotsResponse - The slots response from Cal.com API
 * @param timeZone - Optional timezone for formatting
 * @returns string - Formatted slots display
 */
export function formatSlotsForDisplay(
  slotsResponse: SlotsResponse,
  timeZone?: string
): string {
  if (slotsResponse.status === 'error') {
    return `❌ Error: ${slotsResponse.error?.message || 'Unknown error'}`
  }

  const data = slotsResponse.data || {}
  const dates = Object.keys(data).sort()

  if (dates.length === 0) {
    return '📅 No available slots found for the specified time range.'
  }

  let output = `📅 **Available Slots** (${timeZone || 'UTC'}):\n\n`

  dates.forEach(date => {
    const slots = data[date] || []
    const formattedDate = new Date(date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: timeZone || 'UTC'
    })

    output += `**${formattedDate}** (${slots.length} slots):\n`
    
    slots.forEach((slot, index) => {
      const startTime = new Date(slot.start).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: timeZone || 'UTC'
      })
      
      if ('end' in slot && slot.end) {
        const endTime = new Date(slot.end as string).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: timeZone || 'UTC'
        })
        output += `  ${index + 1}. ${startTime} - ${endTime}`
        
        const slotRange = slot as SlotRange
        if (slotRange.attendeesCount !== undefined) {
          output += ` (${slotRange.attendeesCount} attendees)`
        }
        if (slotRange.bookingUid) {
          output += ` [${slotRange.bookingUid}]`
        }
      } else {
        output += `  ${index + 1}. ${startTime}`
      }
      
      output += '\n'
    })
    
    output += '\n'
  })

  return output
}
