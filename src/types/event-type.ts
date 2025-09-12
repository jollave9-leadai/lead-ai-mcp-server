// Type definitions for the event_types table
export interface EventType {
  id: number;
  client_id: number;
  cal_event_type_id: number;
  title: string;
  slug: string;
  description?: string;
  length_in_minutes: number;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
  location?: unknown; // jsonb type
  agent_id?: number;
  cal_managed_user_id?: number;
  availability_schedule_id?: number;
  minimum_booking_notice?: number;
  before_event_buffer?: number;
  after_event_buffer?: number;
}

export interface EventTypeSummary {
  client_id: number;
  total_event_types: number;
  active_event_types: number;
  cal_event_type_ids: number[];
  event_types: EventType[];
  has_active_event_types: boolean;
}

export interface EventTypeForCalendar {
  cal_event_type_id: number;
  title: string;
  slug: string;
  length_in_minutes: number;
  is_active: boolean;
}
