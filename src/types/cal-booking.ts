// Cal.com API response types based on the documentation
export interface CalBookingHost {
  id: number;
  name: string;
  email: string;
  username: string;
  timeZone: string;
}

export interface CalBookingAttendee {
  name: string;
  email: string;
  timeZone: string;
  language: string;
  absent: boolean;
  phoneNumber?: string;
}

export interface CalEventType {
  id: number;
  slug: string;
}

export interface CalBooking {
  id: number;
  uid: string;
  title: string;
  description?: string;
  hosts: CalBookingHost[];
  status: "accepted" | "pending" | "cancelled" | "rejected";
  cancellationReason?: string;
  cancelledByEmail?: string;
  reschedulingReason?: string;
  rescheduledByEmail?: string;
  rescheduledFromUid?: string;
  rescheduledToUid?: string;
  start: string;
  end: string;
  duration: number;
  eventTypeId: number;
  eventType: CalEventType;
  meetingUrl?: string;
  location?: string;
  absentHost?: boolean;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
  rating?: number;
  icsUid?: string;
  attendees: CalBookingAttendee[];
  guests?: string[];
  bookingFieldsResponses?: Record<string, unknown>;
}

export interface CalBookingsResponse {
  status: "success" | "error";
  data: CalBooking[];
  pagination: {
    totalItems: number;
    remainingItems: number;
    returnedItems: number;
    itemsPerPage: number;
    currentPage: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  error?: unknown;
}

export interface SearchCriteria {
  title?: string;
  attendeeEmail?: string;
  date?: string;
  dateRange?: { start: string; end: string };
  status?: string[];
}
