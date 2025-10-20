/**
 * Calendar Connection Service
 * 
 * Handles retrieving calendar connections by agent ID
 */

import { createClient } from "@supabase/supabase-js";

/**
 * Get calendar connection for a specific agent
 */
export async function getCalendarConnectionByAgentId(
  agentId: number,
  clientId: number
): Promise<{ id: string; connectionId: string } | null> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data: assignment, error } = await supabase
      .schema("lead_dialer")
      .from("agent_calendar_assignments")
      .select("id, calendar_connection_id")
      .eq("agent_id", agentId)
      .eq("client_id", clientId)
      .single();

    if (error || !assignment) {
      console.error("Error getting calendar connection by agent:", error);
      return null;
    }

    return {
      id: assignment.calendar_connection_id,
      connectionId: assignment.calendar_connection_id,
    };
  } catch (error) {
    console.error("Error fetching calendar connection by agent:", error);
    return null;
  }
}

