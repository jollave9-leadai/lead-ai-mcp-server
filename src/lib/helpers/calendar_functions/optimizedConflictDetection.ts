// Optimized conflict detection with smart algorithms and caching
import type { GraphCalendarConnection } from '@/types'
import { AdvancedCacheService } from '../cache/advancedCacheService'
import { EnhancedGraphApiService } from './enhancedGraphApiService'
import { isWithinOfficeHours } from '../utils'
import { DateTime } from 'luxon'

interface TimeSlot {
  start: Date
  end: Date
}

interface BusyPeriod extends TimeSlot {
  id: string
  type: 'event' | 'busy'
}

interface ConflictResult {
  hasConflict: boolean
  conflictDetails?: string
  conflictingEvents?: BusyPeriod[]
}

interface AvailableSlot extends TimeSlot {
  startFormatted: string
  endFormatted: string
  confidence: number // 0-1, how good this slot is
}

/**
 * Optimized conflict detection service with smart algorithms
 */
export class OptimizedConflictDetection {
  
  // Expanded search windows for better conflict detection
  private static readonly SEARCH_WINDOWS = {
    CONFLICT_CHECK: 6 * 60 * 60 * 1000,    // 6 hours before/after for conflict check
    SLOT_SEARCH: 8 * 60 * 60 * 1000,       // 8 hours before/after for slot finding
    EXTENDED_SEARCH: 12 * 60 * 60 * 1000   // 12 hours for extended search
  }

  /**
   * Fast conflict detection with optimized algorithm
   */
  static async checkForConflicts(
    connection: GraphCalendarConnection,
    startDateTime: string,
    endDateTime: string,
    timeZone: string,
    officeHours?: Record<string, { start: string; end: string; enabled: boolean }> | null,
    agentTimezone?: string
  ): Promise<ConflictResult> {
    try {
      console.log(`🔍 OPTIMIZED: Checking conflicts for ${startDateTime} to ${endDateTime}`)
      
      // Parse the datetime strings in the correct timezone context
      // Since startDateTime/endDateTime are in client timezone format (e.g., 2025-10-15T14:00:00)
      // we need to interpret them in the client's timezone, not system timezone
      const requestedStartLuxon = DateTime.fromISO(startDateTime, { zone: timeZone })
      const requestedEndLuxon = DateTime.fromISO(endDateTime, { zone: timeZone })
      
      const requestedStart = requestedStartLuxon.toJSDate()
      const requestedEnd = requestedEndLuxon.toJSDate()
      
      console.log(`🔍 CONFLICT DEBUG: Requested times in client timezone and UTC:`)
      console.log(`   Input: ${startDateTime} in ${timeZone}`)
      console.log(`   Parsed: ${requestedStartLuxon.toISO()}`)
      console.log(`   UTC: ${requestedStart.toISOString()}`)
      
      // FIRST: Check if requested time is within office hours
      if (officeHours) {
        const officeHoursCheck = isWithinOfficeHours(
          startDateTime,
          officeHours,
          agentTimezone || timeZone
        )
        
        if (!officeHoursCheck.isWithin) {
          console.log(`❌ OFFICE HOURS VIOLATION: ${officeHoursCheck.reason}`)
          return {
            hasConflict: true,
            conflictDetails: `Outside office hours: ${officeHoursCheck.reason || 'Not within business hours'}`
          }
        }
        
        console.log(`✅ OFFICE HOURS CHECK: Request is within office hours`)
      }
      
      // Create cache key for busy periods
      const dateKey = requestedStart.toISOString().split('T')[0]
      // const cacheKey = `${connection.id}-${dateKey}` // Reserved for future use
      
      // Get busy periods with caching
      const busyPeriods: BusyPeriod[] = await AdvancedCacheService.getBusyPeriods(
        connection.id,
        dateKey,
        async () => {
          // Reduced search window for better performance
          const searchStart = new Date(requestedStart.getTime() - this.SEARCH_WINDOWS.CONFLICT_CHECK)
          const searchEnd = new Date(requestedEnd.getTime() + this.SEARCH_WINDOWS.CONFLICT_CHECK)
          
          // Ensure searchStart is not after searchEnd
          if (searchStart >= searchEnd) {
            console.warn(`⚠️ Invalid date range: ${searchStart.toISOString()} >= ${searchEnd.toISOString()}`)
            return []
          }
          
          const events = await EnhancedGraphApiService.getEventsOptimized(
            connection,
            {
              startDateTime: searchStart.toISOString(),
              endDateTime: searchEnd.toISOString(),
              timeZone,
              fieldSet: 'MINIMAL'
            }
          )
          
          if (!events.success || !events.events) {
            console.log(`⚠️ No events found or API error`)
            return []
          }
          
          console.log(`📅 Found ${events.events.length} events in search window`)
          events.events.forEach((event, index) => {
            console.log(`   ${index + 1}. ${event.subject} | ${event.start?.dateTime} - ${event.end?.dateTime}`)
          })
          
          return events.events.map(event => ({
            id: event.id,
            start: new Date(event.start.dateTime),
            end: new Date(event.end.dateTime),
            type: 'event' as const
          }))
        }
      ) as BusyPeriod[]

      // Fast overlap detection using sorted intervals
      const conflictingEvents = this.findOverlappingEvents(
        { start: requestedStart, end: requestedEnd },
        busyPeriods
      )

      if (conflictingEvents.length > 0) {
        const conflictDetails = `Conflicts with ${conflictingEvents.length} existing event(s)`
        
        console.log(`❌ CONFLICT DETECTED: ${conflictingEvents.length} overlapping events`)
        
        return {
          hasConflict: true,
          conflictDetails,
          conflictingEvents
        }
      }

      console.log(`✅ NO CONFLICTS: Time slot is available`)
      return { hasConflict: false }

    } catch (error) {
      console.error('❌ Error in optimized conflict detection:', error)
      return { hasConflict: false } // Don't block on error
    }
  }

  /**
   * Optimized available slot finding with smart algorithms
   */
  static async findAvailableSlots(
    connection: GraphCalendarConnection,
    requestedStartTime: string,
    requestedEndTime: string,
    timeZone: string,
    options: {
      durationMinutes?: number
      maxSuggestions?: number
      officeHours?: Record<string, { start: string; end: string; enabled: boolean }> | null
      agentTimezone?: string
      searchWindowHours?: number
    } = {}
  ): Promise<{
    hasConflict: boolean
    availableSlots: AvailableSlot[]
    conflictDetails?: string
  }> {
    const {
      durationMinutes = 60,
      maxSuggestions = 3,
      officeHours,
      agentTimezone = timeZone,
      searchWindowHours = 4
    } = options

    try {
      console.log(`🔍 OPTIMIZED: Finding available slots near ${requestedStartTime}`)
      
      const requestedStart = new Date(requestedStartTime)
      const requestedEnd = new Date(requestedEndTime)
      
      // First check if requested time is available (including office hours validation)
      const conflictCheck = await this.checkForConflicts(
        connection,
        requestedStartTime,
        requestedEndTime,
        timeZone,
        officeHours,
        agentTimezone
      )
      
      if (!conflictCheck.hasConflict) {
        return {
          hasConflict: false,
          availableSlots: []
        }
      }

      // Get busy periods for slot finding
      const searchWindow = searchWindowHours * 60 * 60 * 1000
      const searchStart = new Date(requestedStart.getTime() - searchWindow)
      const searchEnd = new Date(requestedEnd.getTime() + searchWindow)
      
      console.log(`🔍 Searching ${searchWindowHours}h window for alternatives`)
      
      const busyPeriods = await EnhancedGraphApiService.getEventsOptimized(
        connection,
        {
          startDateTime: searchStart.toISOString(),
          endDateTime: searchEnd.toISOString(),
          timeZone,
          fieldSet: 'MINIMAL'
        }
      )

      if (!busyPeriods.success || !busyPeriods.events) {
        return {
          hasConflict: false,
          availableSlots: []
        }
      }

      // Convert to sorted busy periods
      const sortedBusyPeriods = busyPeriods.events
        .map(event => ({
          id: event.id,
          start: new Date(event.start.dateTime),
          end: new Date(event.end.dateTime),
          type: 'event' as const
        }))
        .sort((a, b) => a.start.getTime() - b.start.getTime())

      // Find available slots using optimized algorithm
      const availableSlots = this.findOptimalSlots(
        requestedStart,
        requestedEnd,
        sortedBusyPeriods,
        durationMinutes,
        maxSuggestions,
        timeZone,
        officeHours,
        agentTimezone
      )

      console.log(`💡 Found ${availableSlots.length} optimized alternative slots`)

      return {
        hasConflict: true,
        availableSlots,
        conflictDetails: conflictCheck.conflictDetails
      }

    } catch (error) {
      console.error('❌ Error in optimized slot finding:', error)
      return {
        hasConflict: true,
        availableSlots: [],
        conflictDetails: 'Error finding available slots'
      }
    }
  }

  /**
   * Fast overlap detection using sorted intervals - O(n log n) complexity
   */
  private static findOverlappingEvents(
    targetSlot: TimeSlot,
    busyPeriods: BusyPeriod[]
  ): BusyPeriod[] {
    const overlapping: BusyPeriod[] = []
    
    // Binary search for potential overlaps (if we had many events)
    // For now, simple linear search since we limit the search window
    for (const period of busyPeriods) {
      if (this.hasOverlap(targetSlot, period)) {
        overlapping.push(period)
      }
    }
    
    return overlapping
  }

  /**
   * Check if two time slots overlap
   */
  private static hasOverlap(slot1: TimeSlot, slot2: TimeSlot): boolean {
    return slot1.start < slot2.end && slot1.end > slot2.start
  }

  /**
   * Find optimal available slots using smart algorithm
   */
  private static findOptimalSlots(
    requestedStart: Date,
    requestedEnd: Date,
    busyPeriods: BusyPeriod[],
    durationMinutes: number,
    maxSuggestions: number,
    timeZone: string,
    officeHours?: Record<string, { start: string; end: string; enabled: boolean }> | null,
    agentTimezone?: string
  ): AvailableSlot[] {
    const slots: AvailableSlot[] = []
    const slotDuration = durationMinutes * 60 * 1000
    const now = new Date()
    const minSlotTime = new Date(now.getTime() + 15 * 60 * 1000) // 15 min buffer
    
    // Smart slot generation - focus on times near the requested time
    const searchStart = new Date(requestedStart.getTime() - 4 * 60 * 60 * 1000) // 4h before
    const searchEnd = new Date(requestedEnd.getTime() + 4 * 60 * 60 * 1000) // 4h after
    
    // Generate candidate slots with smart intervals
    const candidates = this.generateSmartCandidates(
      requestedStart,
      searchStart,
      searchEnd,
      slotDuration,
      30 // 30-minute intervals
    )

    for (const candidate of candidates) {
      if (slots.length >= maxSuggestions) break
      
      // Skip if in the past
      if (candidate.start < minSlotTime) continue
      
      // Check if slot conflicts with busy periods
      if (this.slotHasConflict(candidate, busyPeriods)) continue
      
      // Check office hours if provided
      if (officeHours) {
        const officeHoursCheck = isWithinOfficeHours(
          candidate.start.toISOString(),
          officeHours,
          agentTimezone || 'Australia/Melbourne'
        )
        if (!officeHoursCheck.isWithin) continue
      }

      // Calculate confidence score based on proximity to requested time
      const confidence = this.calculateSlotConfidence(candidate.start, requestedStart)
      
      slots.push({
        start: candidate.start,
        end: candidate.end,
        startFormatted: this.formatTimeForDisplay(candidate.start, timeZone),
        endFormatted: this.formatTimeForDisplay(candidate.end, timeZone),
        confidence
      })
    }

    // Sort by confidence (best slots first)
    return slots.sort((a, b) => b.confidence - a.confidence)
  }

  /**
   * Generate smart candidate slots focusing on preferred times
   */
  private static generateSmartCandidates(
    requestedStart: Date,
    searchStart: Date,
    searchEnd: Date,
    slotDuration: number,
    intervalMinutes: number
  ): TimeSlot[] {
    const candidates: TimeSlot[] = []
    const interval = intervalMinutes * 60 * 1000
    
    // Generate slots with preference for times close to requested time
    let currentTime = new Date(searchStart)
    
    while (currentTime < searchEnd && candidates.length < 50) { // Limit candidates
      const slotEnd = new Date(currentTime.getTime() + slotDuration)
      
      candidates.push({
        start: new Date(currentTime),
        end: slotEnd
      })
      
      currentTime = new Date(currentTime.getTime() + interval)
    }
    
    return candidates
  }

  /**
   * Check if a slot conflicts with any busy period
   */
  private static slotHasConflict(slot: TimeSlot, busyPeriods: BusyPeriod[]): boolean {
    return busyPeriods.some(period => this.hasOverlap(slot, period))
  }

  /**
   * Calculate confidence score for a slot based on proximity to requested time
   */
  private static calculateSlotConfidence(slotStart: Date, requestedStart: Date): number {
    const timeDiff = Math.abs(slotStart.getTime() - requestedStart.getTime())
    const maxDiff = 4 * 60 * 60 * 1000 // 4 hours
    
    // Confidence decreases with distance from requested time
    const proximityScore = Math.max(0, 1 - (timeDiff / maxDiff))
    
    // Bonus for business hours (9 AM - 6 PM)
    const hour = slotStart.getHours()
    const businessHoursBonus = (hour >= 9 && hour < 18) ? 0.2 : 0
    
    return Math.min(1, proximityScore + businessHoursBonus)
  }

  /**
   * Format time for display in client timezone
   */
  private static formatTimeForDisplay(date: Date, timeZone: string = 'Australia/Melbourne'): string {
    return date.toLocaleString('en-AU', {
      timeZone: timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    })
  }
}

export default OptimizedConflictDetection
