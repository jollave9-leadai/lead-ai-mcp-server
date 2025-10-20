// Type definitions for booking operations

export interface ContactInfo {
  name: string
  email: string
  phone?: string
  source: 'customer' | 'lead' | 'manual'
  id?: number
  company?: string
}

export interface ContactSearchResult {
  found: boolean
  contact?: ContactInfo
  matches?: ContactInfo[]
  searchScore?: number
  message?: string
}

export interface TimeSlot {
  start: string
  end: string
  startFormatted: string
  endFormatted: string
  available: boolean
}

export interface ConflictCheckResult {
  hasConflict: boolean
  conflictingEvents?: Array<{
    id: string
    subject: string
    start: string
    end: string
  }>
  message?: string
}

export interface BookingValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
}

export interface BookingRequest {
  clientId: number
  agentId: number // Required: which agent's calendar to use
  subject: string
  startDateTime: string
  endDateTime: string
  contactName?: string
  contactEmail?: string
  contactPhone?: string
  description?: string
  location?: string
  isOnlineMeeting?: boolean
  calendarId?: string
}

export interface BookingResponse {
  success: boolean
  booking?: {
    eventId: string
    subject: string
    startDateTime: string
    endDateTime: string
    contact: ContactInfo
    teamsLink?: string
    location?: string
  }
  error?: string
  availableSlots?: TimeSlot[]
  conflictDetails?: string
}

export interface AvailabilityCheckRequest {
  clientId: number
  agentId: number // Required: which agent's calendar to check
  startDateTime: string
  endDateTime: string
  durationMinutes?: number
  maxSuggestions?: number
}

export interface AvailabilityCheckResponse {
  success: boolean
  isAvailable: boolean
  requestedSlot: TimeSlot
  availableSlots?: TimeSlot[]
  hasConflict: boolean
  conflictDetails?: string
  error?: string
}

export interface AgentOfficeHours {
  agentId: number
  agentName: string
  schedule: Record<string, { start: string; end: string; enabled: boolean }>
  timezone: string
}

export interface CalendarConnectionStatus {
  connected: boolean
  clientId: number
  email?: string
  displayName?: string
  calendarsCount?: number
  lastSync?: string
  error?: string
}

