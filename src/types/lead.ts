// Type definitions for the leads table
export interface Lead {
  id: number;
  full_name: string;
  client_id?: number;
  first_name?: string;
  last_name?: string;
  phone_number?: string;
  email?: string;
  call_ongoing?: boolean;
  phone_contacted?: boolean;
  number_of_calls_made?: number;
  last_outcome?: string;
  last_contacted?: string;
  outcome_notes?: string;
  stage?: string;
  date_imported?: string;
  city?: number;
  postal_code?: number;
  created_at?: string;
  updated_at?: string;
  technical_status?: string;
  agents?: number;
  source?: string;
  last_call_session_id?: number;
  leads_list_id?: number;
  company?: string;
  state?: string;
  website?: string;
  linkedin?: string;
  secondary_contact_number?: string;
  position?: string;
  number_of_employees?: number;
  city_name?: string;
  lead_type?: string;
  alternate_phone?: string;
  street_address?: string;
  address_line_2?: string;
  country?: string;
  industry?: string;
  campaign_name?: string;
  date_acquired?: string;
  tags?: string;
}

export interface LeadSummary {
  client_id: number;
  total_leads: number;
  leads_by_stage: Record<string, number>;
  recent_leads: number;
  contacted_leads: number;
  uncontacted_leads: number;
  leads_with_calls: number;
  average_calls_per_lead: number;
  top_sources: Array<{
    source: string;
    count: number;
  }>;
  top_industries: Array<{
    industry: string;
    count: number;
  }>;
}

export interface LeadFilters {
  stage?: string;
  source?: string;
  industry?: string;
  city_name?: string;
  state?: string;
  country?: string;
  lead_type?: string;
  phone_contacted?: boolean;
  call_ongoing?: boolean;
  has_email?: boolean;
  has_phone?: boolean;
  date_imported_from?: string;
  date_imported_to?: string;
  last_contacted_from?: string;
  last_contacted_to?: string;
  min_calls?: number;
  max_calls?: number;
}

export interface LeadQueryOptions {
  filters?: LeadFilters;
  search?: string; // Search in full_name, email, phone_number, company
  sort_by?: 'created_at' | 'updated_at' | 'last_contacted' | 'number_of_calls_made' | 'full_name';
  sort_order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface LeadsResponse {
  leads: Lead[];
  total_count: number;
  filtered_count: number;
  summary: {
    stages: Record<string, number>;
    sources: Record<string, number>;
    contacted_count: number;
    uncontacted_count: number;
  };
}
