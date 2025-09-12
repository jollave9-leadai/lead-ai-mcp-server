// Type definitions for creating bookings via Cal.com API
export interface BookingAttendee {
  name: string;
  email: string;
  timeZone?: string;
  language?: string;
  phoneNumber?: string;
}

export interface BookingMetadata {
  [key: string]: string | number | boolean;
}

export interface CreateBookingRequest {
  eventTypeId: number;
  start: string; // ISO 8601 datetime string
  attendee: BookingAttendee;
  meetingUrl?: string;
  bookingFieldsResponses?: Record<string, any>;
  metadata?: BookingMetadata;
  title?: string;
  recurringEventId?: string;
  description?: string;
  status?: 'ACCEPTED' | 'PENDING' | 'CANCELLED';
  seatsPerTimeSlot?: number;
  seatsShowAttendees?: boolean;
}

export interface CreateBookingResponse {
  status: 'success' | 'error';
  data?: {
    id: number;
    uid: string;
    title: string;
    description?: string;
    startTime: string;
    endTime: string;
    attendees: BookingAttendee[];
    organizer: {
      id: number;
      name: string;
      email: string;
      timeZone: string;
    };
    location?: string;
    status: string;
    metadata?: BookingMetadata;
    recurringEventId?: string;
  };
  error?: {
    message: string;
    details?: any;
  };
}

export interface BookingCreationSummary {
  success: boolean;
  bookingId?: number;
  bookingUid?: string;
  eventTitle?: string;
  startTime?: string;
  endTime?: string;
  attendeeEmail?: string;
  attendeeName?: string;
  error?: string;
}

// Type definitions for canceling bookings via Cal.com API
export interface CancelBookingRequest {
  cancellationReason: string;
  cancelSubsequentBookings?: boolean;
  seatUid?: string; // For seated bookings
}

export interface CancelBookingResponse {
  status: 'success' | 'error';
  data?: {
    id: number;
    uid: string;
    title: string;
    description?: string;
    hosts: Array<{
      id: number;
      name: string;
      email: string;
      username: string;
      timeZone: string;
    }>;
    status: string;
    cancellationReason: string;
    cancelledByEmail: string;
    start: string;
    end: string;
    duration: number;
    eventTypeId: number;
    eventType: {
      id: number;
      slug: string;
    };
    attendees: Array<{
      name: string;
      email: string;
      timeZone: string;
      language: string;
      absent: boolean;
      phoneNumber?: string;
    }>;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, any>;
  };
  error?: {
    message: string;
    details?: any;
  };
}

export interface BookingCancellationSummary {
  success: boolean;
  bookingId?: number;
  bookingUid?: string;
  eventTitle?: string;
  cancellationReason?: string;
  cancelledByEmail?: string;
  wasSeatedBooking?: boolean;
  error?: string;
}

// Type definitions for rescheduling bookings via Cal.com API
export interface RescheduleBookingRequest {
  start: string; // ISO 8601 datetime string
  rescheduledBy?: string;
  reschedulingReason?: string;
  seatUid?: string; // For seated bookings
}

export interface RescheduleBookingResponse {
  status: 'success' | 'error';
  data?: {
    id: number;
    uid: string;
    title: string;
    description?: string;
    hosts: Array<{
      id: number;
      name: string;
      email: string;
      username: string;
      timeZone: string;
    }>;
    status: string;
    reschedulingReason?: string;
    rescheduledByEmail?: string;
    rescheduledFromUid?: string;
    rescheduledToUid?: string;
    start: string;
    end: string;
    duration: number;
    eventTypeId: number;
    eventType: {
      id: number;
      slug: string;
    };
    attendees: Array<{
      name: string;
      email: string;
      timeZone: string;
      language: string;
      absent: boolean;
      phoneNumber?: string;
    }>;
    meetingUrl?: string;
    location?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, any>;
  };
  error?: {
    message: string;
    details?: any;
  };
}

export interface BookingRescheduleSummary {
  success: boolean;
  bookingId?: number;
  bookingUid?: string;
  newBookingUid?: string;
  eventTitle?: string;
  oldStartTime?: string;
  newStartTime?: string;
  newEndTime?: string;
  reschedulingReason?: string;
  rescheduledByEmail?: string;
  wasSeatedBooking?: boolean;
  error?: string;
}
