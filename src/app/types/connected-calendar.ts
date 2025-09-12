// Type definitions for the connected_calendars table
export interface ConnectedCalendar {
  id: number;
  client_id: number;
  cal_user_id: number;
  calendar_type: 'google' | 'office365';
  credential_id: number;
  account_email: string;
  account_name?: string;
  integration_title?: string;
  external_id?: string;
  is_primary?: boolean;
  is_selected?: boolean;
  is_read_only?: boolean;
  is_connected?: boolean;
  connected_at?: string;
  last_sync_at?: string;
  created_at?: string;
  updated_at?: string;
  calendar_id?: number;
}

export interface ConnectedCalendarSummary {
  client_id: number;
  total_calendars: number;
  connected_calendars: number;
  google_calendars: number;
  office365_calendars: number;
  primary_calendar?: ConnectedCalendar;
  has_active_calendars: boolean;
}
