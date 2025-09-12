import { createClient } from '../lib/supbase/server/route'
import type { EventType, EventTypeSummary, EventTypeForCalendar } from '../types'

/**
 * Checks if a client has event types and returns summary
 * @param clientId - The ID of the client
 * @returns Promise<EventTypeSummary | null> - Summary of event types or null if error
 */
export async function checkClientEventTypes(clientId: number): Promise<EventTypeSummary | null> {
  try {
    const supabase = createClient()
    
    console.log(`🔍 Checking event types for client ${clientId}...`)
    
    const { data, error } = await supabase.rpc('check_client_event_types', {
      p_client_id: clientId
    })
    
    if (error) {
      console.error('❌ RPC call failed for event types check:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      })
      return null
    }
    
    if (!data || data.length === 0) {
      console.log(`📭 No event type data found for client ${clientId}`)
      return {
        client_id: clientId,
        total_event_types: 0,
        active_event_types: 0,
        cal_event_type_ids: [],
        event_types: [],
        has_active_event_types: false
      }
    }
    
    const summary = data[0]
    const calEventTypeIds = summary.cal_event_type_ids 
      ? summary.cal_event_type_ids.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id))
      : []
    
    console.log(`📊 Event types summary for client ${clientId}:`, {
      total: summary.total_event_types,
      active: summary.active_event_types,
      has_active: summary.has_active_event_types,
      cal_event_type_ids: calEventTypeIds,
      sample_titles: summary.sample_event_titles
    })
    
    return {
      client_id: clientId,
      total_event_types: Number(summary.total_event_types),
      active_event_types: Number(summary.active_event_types),
      cal_event_type_ids: calEventTypeIds,
      event_types: [], // Will be populated by getEventTypesForClient if needed
      has_active_event_types: summary.has_active_event_types
    }
  } catch (error) {
    console.error('💥 Unexpected error in checkClientEventTypes:', error)
    return null
  }
}

/**
 * Retrieves all event types for a specific client
 * @param clientId - The ID of the client
 * @returns Promise<EventType[]> - Array of event types or empty array
 */
export async function getEventTypesForClient(clientId: number): Promise<EventType[]> {
  try {
    const supabase = createClient()
    
    console.log(`🔍 Fetching event types for client ${clientId}...`)
    
    const { data, error } = await supabase.rpc('get_event_types_for_client', {
      p_client_id: clientId
    })
    
    if (error) {
      console.error('❌ RPC call failed for event types:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      })
      return []
    }
    
    console.log(`✅ Found ${data?.length || 0} event types for client ${clientId}`)
    
    if (data && data.length > 0) {
      console.log('📋 Event types summary:', data.map(eventType => ({
        id: eventType.id,
        cal_event_type_id: eventType.cal_event_type_id,
        title: eventType.title,
        slug: eventType.slug,
        length_in_minutes: eventType.length_in_minutes,
        is_active: eventType.is_active
      })))
    }
    
    return data as EventType[]
  } catch (error) {
    console.error('💥 Unexpected error in getEventTypesForClient:', error)
    return []
  }
}

/**
 * Gets cal_event_type_ids as a comma-separated string for use in calendar API queries
 * @param clientId - The ID of the client
 * @returns Promise<string | null> - Comma-separated cal_event_type_ids or null
 */
export async function getCalEventTypeIdsForClient(clientId: number): Promise<string | null> {
  try {
    const supabase = createClient()
    
    console.log(`🔍 Getting cal_event_type_ids for client ${clientId}...`)
    
    const { data, error } = await supabase.rpc('get_cal_event_type_ids_for_client', {
      p_client_id: clientId
    })
    
    if (error) {
      console.error('❌ RPC call failed for cal_event_type_ids:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      })
      return null
    }
    
    const calEventTypeIds = data?.[0]?.cal_event_type_ids || null
    
    if (calEventTypeIds) {
      console.log(`✅ Found cal_event_type_ids for client ${clientId}: ${calEventTypeIds}`)
    } else {
      console.log(`❌ No cal_event_type_ids found for client ${clientId}`)
    }
    
    return calEventTypeIds
  } catch (error) {
    console.error('💥 Unexpected error in getCalEventTypeIdsForClient:', error)
    return null
  }
}

/**
 * Checks if a client has any active event types before fetching events
 * @param clientId - The ID of the client
 * @returns Promise<boolean> - True if client has active event types, false otherwise
 */
export async function hasActiveEventTypes(clientId: number): Promise<boolean> {
  try {
    const summary = await checkClientEventTypes(clientId)
    
    if (!summary) {
      console.log(`❌ Could not check event types for client ${clientId}`)
      return false
    }
    
    const hasActive = summary.has_active_event_types && summary.active_event_types > 0
    
    if (hasActive) {
      console.log(`✅ Client ${clientId} has ${summary.active_event_types} active event type(s)`)
    } else {
      console.log(`❌ Client ${clientId} has no active event types`)
    }
    
    return hasActive
  } catch (error) {
    console.error('💥 Error checking active event types:', error)
    return false
  }
}

/**
 * Gets event types formatted for calendar queries
 * @param clientId - The ID of the client
 * @returns Promise<EventTypeForCalendar[]> - Array of event types formatted for calendar use
 */
export async function getEventTypesForCalendar(clientId: number): Promise<EventTypeForCalendar[]> {
  try {
    const eventTypes = await getEventTypesForClient(clientId)
    
    return eventTypes
      .filter(et => et.is_active)
      .map(et => ({
        cal_event_type_id: et.cal_event_type_id,
        title: et.title,
        slug: et.slug,
        length_in_minutes: et.length_in_minutes,
        is_active: et.is_active
      }))
  } catch (error) {
    console.error('💥 Error getting event types for calendar:', error)
    return []
  }
}
