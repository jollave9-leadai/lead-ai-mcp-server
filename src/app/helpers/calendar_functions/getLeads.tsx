import { createClient } from '../lib/supbase/server/route'
import type { Lead, LeadSummary, LeadFilters, LeadQueryOptions, LeadsResponse } from '../types'

/**
 * Gets leads summary for a specific client
 * @param clientId - The ID of the client
 * @returns Promise<LeadSummary | null> - Summary of leads or null if error
 */
export async function getClientLeadsSummary(clientId: number): Promise<LeadSummary | null> {
  try {
    const supabase = createClient()
    
    console.log(`🔍 Getting leads summary for client ${clientId}...`)
    
    const { data, error } = await supabase.rpc('get_client_leads_summary', {
      p_client_id: clientId
    })
    
    if (error) {
      console.error('❌ RPC call failed for leads summary:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      })
      return null
    }
    
    if (!data || data.length === 0) {
      console.log(`📭 No leads data found for client ${clientId}`)
      return {
        client_id: clientId,
        total_leads: 0,
        leads_by_stage: {},
        recent_leads: 0,
        contacted_leads: 0,
        uncontacted_leads: 0,
        leads_with_calls: 0,
        average_calls_per_lead: 0,
        top_sources: [],
        top_industries: []
      }
    }
    
    const summary = data[0]
    
    // Parse JSON data
    const stagesData = summary.stages_json || {}
    const sourcesData = summary.sources_json || {}
    const industriesData = summary.industries_json || {}
    
    // Convert to arrays for top sources and industries
    const topSources = Object.entries(sourcesData)
      .map(([source, count]) => ({ source, count: Number(count) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
    
    const topIndustries = Object.entries(industriesData)
      .map(([industry, count]) => ({ industry, count: Number(count) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
    
    console.log(`📊 Leads summary for client ${clientId}:`, {
      total: summary.total_leads,
      contacted: summary.contacted_leads,
      uncontacted: summary.uncontacted_leads,
      recent: summary.recent_leads_count
    })
    
    return {
      client_id: clientId,
      total_leads: Number(summary.total_leads),
      leads_by_stage: stagesData,
      recent_leads: Number(summary.recent_leads_count),
      contacted_leads: Number(summary.contacted_leads),
      uncontacted_leads: Number(summary.uncontacted_leads),
      leads_with_calls: Number(summary.leads_with_calls),
      average_calls_per_lead: Number(summary.average_calls_per_lead),
      top_sources: topSources,
      top_industries: topIndustries
    }
  } catch (error) {
    console.error('💥 Unexpected error in getClientLeadsSummary:', error)
    return null
  }
}

/**
 * Retrieves leads for a specific client with filtering and pagination
 * @param clientId - The ID of the client
 * @param options - Query options for filtering, sorting, and pagination
 * @returns Promise<LeadsResponse> - Leads data with pagination info
 */
export async function getLeadsForClient(clientId: number, options: LeadQueryOptions = {}): Promise<LeadsResponse> {
  try {
    const supabase = createClient()
    
    console.log(`🔍 Fetching leads for client ${clientId}...`, options)
    
    const {
      filters = {},
      search,
      sort_by = 'created_at',
      sort_order = 'desc',
      limit = 50,
      offset = 0
    } = options
    
    const { data, error } = await supabase.rpc('get_leads_for_client', {
      p_client_id: clientId,
      p_stage: filters.stage || null,
      p_source: filters.source || null,
      p_industry: filters.industry || null,
      p_phone_contacted: filters.phone_contacted || null,
      p_search: search || null,
      p_sort_by: sort_by,
      p_sort_order: sort_order,
      p_limit: limit,
      p_offset: offset
    })
    
    if (error) {
      console.error('❌ RPC call failed for leads:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      })
      return {
        leads: [],
        total_count: 0,
        filtered_count: 0,
        summary: {
          stages: {},
          sources: {},
          contacted_count: 0,
          uncontacted_count: 0
        }
      }
    }
    
    console.log(`✅ Found ${data?.length || 0} leads for client ${clientId}`)
    
    // Get summary for the response
    const summary = await getClientLeadsSummary(clientId)
    
    return {
      leads: data as Lead[],
      total_count: summary?.total_leads || 0,
      filtered_count: data?.length || 0,
      summary: {
        stages: summary?.leads_by_stage || {},
        sources: summary?.top_sources.reduce((acc, item) => {
          acc[item.source] = item.count
          return acc
        }, {} as Record<string, number>) || {},
        contacted_count: summary?.contacted_leads || 0,
        uncontacted_count: summary?.uncontacted_leads || 0
      }
    }
  } catch (error) {
    console.error('💥 Unexpected error in getLeadsForClient:', error)
    return {
      leads: [],
      total_count: 0,
      filtered_count: 0,
      summary: {
        stages: {},
        sources: {},
        contacted_count: 0,
        uncontacted_count: 0
      }
    }
  }
}

/**
 * Searches leads for a client using a search term
 * @param clientId - The ID of the client
 * @param searchTerm - The search term to look for
 * @param limit - Maximum number of results to return
 * @returns Promise<Lead[]> - Array of matching leads
 */
export async function searchClientLeads(clientId: number, searchTerm: string, limit: number = 20): Promise<Lead[]> {
  try {
    const supabase = createClient()
    
    console.log(`🔍 Searching leads for client ${clientId} with term: "${searchTerm}"`)
    
    const { data, error } = await supabase.rpc('search_client_leads', {
      p_client_id: clientId,
      p_search_term: searchTerm,
      p_limit: limit
    })
    
    if (error) {
      console.error('❌ RPC call failed for lead search:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      })
      return []
    }
    
    console.log(`✅ Found ${data?.length || 0} leads matching "${searchTerm}" for client ${clientId}`)
    
    return data as Lead[]
  } catch (error) {
    console.error('💥 Unexpected error in searchClientLeads:', error)
    return []
  }
}

/**
 * Gets leads by stage for a specific client
 * @param clientId - The ID of the client
 * @param stage - The stage to filter by
 * @param limit - Maximum number of results to return
 * @returns Promise<Lead[]> - Array of leads in the specified stage
 */
export async function getLeadsByStage(clientId: number, stage: string, limit: number = 50): Promise<Lead[]> {
  try {
    const supabase = createClient()
    
    console.log(`🔍 Getting leads by stage "${stage}" for client ${clientId}`)
    
    const { data, error } = await supabase.rpc('get_leads_by_stage', {
      p_client_id: clientId,
      p_stage: stage,
      p_limit: limit
    })
    
    if (error) {
      console.error('❌ RPC call failed for leads by stage:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      })
      return []
    }
    
    console.log(`✅ Found ${data?.length || 0} leads in stage "${stage}" for client ${clientId}`)
    
    return data as Lead[]
  } catch (error) {
    console.error('💥 Unexpected error in getLeadsByStage:', error)
    return []
  }
}

/**
 * Gets recent leads for a client (created in the last 7 days)
 * @param clientId - The ID of the client
 * @param limit - Maximum number of results to return
 * @returns Promise<Lead[]> - Array of recent leads
 */
export async function getRecentLeads(clientId: number, limit: number = 20): Promise<Lead[]> {
  try {
    const options: LeadQueryOptions = {
      sort_by: 'created_at',
      sort_order: 'desc',
      limit
    }
    
    const response = await getLeadsForClient(clientId, options)
    
    // Filter to only recent leads (last 7 days)
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    
    const recentLeads = response.leads.filter(lead => {
      if (!lead.created_at) return false
      const createdDate = new Date(lead.created_at)
      return createdDate >= sevenDaysAgo
    })
    
    console.log(`✅ Found ${recentLeads.length} recent leads for client ${clientId}`)
    
    return recentLeads
  } catch (error) {
    console.error('💥 Unexpected error in getRecentLeads:', error)
    return []
  }
}

/**
 * Checks if a client has any leads
 * @param clientId - The ID of the client
 * @returns Promise<boolean> - True if client has leads, false otherwise
 */
export async function hasLeads(clientId: number): Promise<boolean> {
  try {
    const summary = await getClientLeadsSummary(clientId)
    
    if (!summary) {
      console.log(`❌ Could not check leads for client ${clientId}`)
      return false
    }
    
    const hasAnyLeads = summary.total_leads > 0
    
    if (hasAnyLeads) {
      console.log(`✅ Client ${clientId} has ${summary.total_leads} leads`)
    } else {
      console.log(`❌ Client ${clientId} has no leads`)
    }
    
    return hasAnyLeads
  } catch (error) {
    console.error('💥 Error checking if client has leads:', error)
    return false
  }
}
