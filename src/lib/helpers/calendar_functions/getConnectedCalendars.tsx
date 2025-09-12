import { createClient } from '../lib/supbase/server/route'
import type { ConnectedCalendar, ConnectedCalendarSummary } from '../types'

/**
 * Checks if a client has connected calendars
 * @param clientId - The ID of the client
 * @returns Promise<ConnectedCalendarSummary | null> - Summary of connected calendars or null if error
 */
export async function checkClientConnectedCalendars(clientId: number): Promise<ConnectedCalendarSummary | null> {
  try {
    const supabase = createClient()
    
    console.log(`🔍 Checking connected calendars for client ${clientId}...`)
    
    const { data, error } = await supabase.rpc('check_client_connected_calendars', {
      p_client_id: clientId
    })
    
    if (error) {
      console.error('❌ RPC call failed for connected calendars check:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      })
      return null
    }
    
    if (!data || data.length === 0) {
      console.log(`📭 No calendar data found for client ${clientId}`)
      return {
        client_id: clientId,
        total_calendars: 0,
        connected_calendars: 0,
        google_calendars: 0,
        office365_calendars: 0,
        has_active_calendars: false
      }
    }
    
    const summary = data[0]
    console.log(`📊 Calendar summary for client ${clientId}:`, {
      total: summary.total_calendars,
      connected: summary.connected_calendars,
      google: summary.google_calendars,
      office365: summary.office365_calendars,
      has_primary: summary.has_primary_calendar,
      has_active: summary.has_active_calendars
    })
    
    return {
      client_id: clientId,
      total_calendars: Number(summary.total_calendars),
      connected_calendars: Number(summary.connected_calendars),
      google_calendars: Number(summary.google_calendars),
      office365_calendars: Number(summary.office365_calendars),
      has_active_calendars: summary.has_active_calendars,
      primary_calendar: summary.has_primary_calendar ? {
        account_email: summary.primary_calendar_email,
        calendar_type: summary.primary_calendar_type,
        is_primary: true
      } as Partial<ConnectedCalendar> : undefined
    }
  } catch (error) {
    console.error('💥 Unexpected error in checkClientConnectedCalendars:', error)
    return null
  }
}

/**
 * Retrieves all connected calendars for a specific client
 * @param clientId - The ID of the client
 * @returns Promise<ConnectedCalendar[]> - Array of connected calendars or empty array
 */
export async function getConnectedCalendarsForClient(clientId: number): Promise<ConnectedCalendar[]> {
  try {
    const supabase = createClient()
    
    console.log(`🔍 Fetching connected calendars for client ${clientId}...`)
    
    const { data, error } = await supabase.rpc('get_connected_calendars_for_client', {
      p_client_id: clientId
    })
    
    if (error) {
      console.error('❌ RPC call failed for connected calendars:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      })
      return []
    }
    
    console.log(`✅ Found ${data?.length || 0} connected calendars for client ${clientId}`)
    
    if (data && data.length > 0) {
      console.log('📋 Connected calendars summary:', data.map(calendar => ({
        id: calendar.id,
        calendar_type: calendar.calendar_type,
        account_email: calendar.account_email,
        is_primary: calendar.is_primary,
        is_connected: calendar.is_connected,
        is_selected: calendar.is_selected
      })))
    }
    
    return data as ConnectedCalendar[]
  } catch (error) {
    console.error('💥 Unexpected error in getConnectedCalendarsForClient:', error)
    return []
  }
}

/**
 * Checks if a client has any active calendar connections before fetching events
 * @param clientId - The ID of the client
 * @returns Promise<boolean> - True if client has active calendars, false otherwise
 */
export async function hasActiveCalendarConnections(clientId: number): Promise<boolean> {
  try {
    const summary = await checkClientConnectedCalendars(clientId)
    
    if (!summary) {
      console.log(`❌ Could not check calendar connections for client ${clientId}`)
      return false
    }
    
    const hasActive = summary.has_active_calendars && summary.connected_calendars > 0
    
    if (hasActive) {
      console.log(`✅ Client ${clientId} has ${summary.connected_calendars} active calendar connection(s)`)
    } else {
      console.log(`❌ Client ${clientId} has no active calendar connections`)
    }
    
    return hasActive
  } catch (error) {
    console.error('💥 Error checking active calendar connections:', error)
    return false
  }
}

/**
 * Gets the primary calendar for a client
 * @param clientId - The ID of the client
 * @returns Promise<ConnectedCalendar | null> - Primary calendar or null if not found
 */
export async function getPrimaryCalendarForClient(clientId: number): Promise<ConnectedCalendar | null> {
  try {
    const calendars = await getConnectedCalendarsForClient(clientId)
    
    // Find the primary calendar
    const primaryCalendar = calendars.find(calendar => 
      calendar.is_primary === true && 
      (calendar.is_connected === null || calendar.is_connected === true)
    )
    
    if (primaryCalendar) {
      console.log(`✅ Found primary calendar for client ${clientId}: ${primaryCalendar.account_email} (${primaryCalendar.calendar_type})`)
      return primaryCalendar
    }
    
    // If no primary calendar, return the first connected one
    const firstConnected = calendars.find(calendar => 
      calendar.is_connected === null || calendar.is_connected === true
    )
    
    if (firstConnected) {
      console.log(`📝 No primary calendar found, using first connected: ${firstConnected.account_email} (${firstConnected.calendar_type})`)
      return firstConnected
    }
    
    console.log(`❌ No connected calendars found for client ${clientId}`)
    return null
  } catch (error) {
    console.error('💥 Error getting primary calendar:', error)
    return null
  }
}
