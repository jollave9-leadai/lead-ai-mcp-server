// Legacy optimized calendar operations - redirects to final optimized version
import type {
  GraphEvent,
  GetGraphEventsRequest,
  CreateGraphEventMCPRequest,
  GetAvailabilityRequest,
  AvailabilityResponse,
} from '@/types'

/**
 * Legacy calendar operations - use FinalOptimizedCalendarOperations for new code
 * @deprecated Use FinalOptimizedCalendarOperations instead
 */
export class OptimizedCalendarOperations {

  /**
   * @deprecated Use FinalOptimizedCalendarOperations.getCalendarEventsForClient instead
   */
  static async getCalendarEventsForClient(
    clientId: number,
    request: GetGraphEventsRequest
  ): Promise<{
    success: boolean
    events?: GraphEvent[]
    formattedEvents?: string
    error?: string
  }> {
    const { FinalOptimizedCalendarOperations } = await import('./finalOptimizedCalendarOperations')
    return await FinalOptimizedCalendarOperations.getCalendarEventsForClient(clientId, request)
  }

  /**
   * @deprecated Use FinalOptimizedCalendarOperations.createCalendarEventForClient instead
   */
  static async createCalendarEventForClient(
    clientId: number,
    request: CreateGraphEventMCPRequest
  ): Promise<{
    success: boolean
    event?: GraphEvent
    eventId?: string
    error?: string
    availableSlots?: Array<{
      start: string
      end: string
      startFormatted: string
      endFormatted: string
      confidence: number
    }>
  }> {
    const { FinalOptimizedCalendarOperations } = await import('./finalOptimizedCalendarOperations')
    return await FinalOptimizedCalendarOperations.createCalendarEventForClient(clientId, request)
  }

  /**
   * @deprecated Use legacy functions for availability (not yet optimized)
   */
  static async getAvailabilityForClient(
    clientId: number,
    request: GetAvailabilityRequest
  ): Promise<AvailabilityResponse> {
    const { getAvailabilityForClient } = await import('./graphCalendar')
    return await getAvailabilityForClient(clientId, request)
  }

  /**
   * @deprecated Use FinalOptimizedCalendarOperations.findAvailableSlotsForClient instead
   */
  static async findAvailableSlotsForClient(
    clientId: number,
    requestedStartTime: string,
    requestedEndTime: string,
    durationMinutes: number = 60,
    maxSuggestions: number = 5
  ): Promise<{
    success: boolean
    hasConflict: boolean
    availableSlots?: Array<{
      start: string
      end: string
      startFormatted: string
      endFormatted: string
      confidence: number
    }>
    conflictDetails?: string
    error?: string
  }> {
    const { FinalOptimizedCalendarOperations } = await import('./finalOptimizedCalendarOperations')
    return await FinalOptimizedCalendarOperations.findAvailableSlotsForClient(
      clientId, 
      requestedStartTime, 
      requestedEndTime, 
      durationMinutes, 
      maxSuggestions
    )
  }

  /**
   * @deprecated Use FinalOptimizedCalendarOperations.searchCalendarEventsForClient instead
   */
  static async searchCalendarEventsForClient(
    clientId: number,
    searchQuery: string,
    options: {
      startDate?: string
      endDate?: string
      calendarId?: string
    } = {}
  ): Promise<{
    success: boolean
    events?: GraphEvent[]
    formattedEvents?: string
    error?: string
  }> {
    const { FinalOptimizedCalendarOperations } = await import('./finalOptimizedCalendarOperations')
    return await FinalOptimizedCalendarOperations.searchCalendarEventsForClient(clientId, searchQuery, options)
  }

  /**
   * Get performance statistics
   */
  static getPerformanceStats(): {
    cacheStats: { size: number; keys: string[] }
    requestStats: { size: number; keys: string[]; oldestEntry?: { key: string; age: number } }
  } {
    // Return empty stats for legacy compatibility
    return {
      cacheStats: { size: 0, keys: [] },
      requestStats: { size: 0, keys: [] }
    }
  }
}

export default OptimizedCalendarOperations