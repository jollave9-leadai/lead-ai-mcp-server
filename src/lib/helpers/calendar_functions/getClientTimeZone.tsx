import { createClient } from '@/lib/helpers/server'
import type { Client } from '@/types'

/**
 * Retrieves the timezone for a specific client from the database
 * @param clientId - The ID of the client
 * @returns Promise<string | null> - The client's timezone or null if not found
 */
export async function getClientTimezone(clientId: number): Promise<string | null> {
  try {
    const supabase = createClient()
    
    const { data, error } = await supabase
    .schema("lead_dialer")
      .from('clients')
      .select('timezone')
      .eq('id', clientId)
      .single()

    if (error) {
      console.error('Error fetching client timezone:', error)
      return null
    }

    return data?.timezone || null
  } catch (error) {
    console.error('Unexpected error in getClientTimezone:', error)
    return null
  }
}

/**
 * Retrieves the timezone for a client by their email
 * @param email - The email of the client
 * @returns Promise<string | null> - The client's timezone or null if not found
 */
export async function getClientTimezoneByEmail(email: string): Promise<string | null> {
  try {
    const supabase = createClient()
    
    const { data, error } = await supabase
    .schema("lead_dialer")
      .from('clients')
      .select('timezone')
      .eq('email', email)
      .single()

    if (error) {
      console.error('Error fetching client timezone by email:', error)
      return null
    }

    return data?.timezone || null
  } catch (error) {
    console.error('Unexpected error in getClientTimezoneByEmail:', error)
    return null
  }
}

/**
 * Retrieves the timezone for a client by their code
 * @param code - The code of the client
 * @returns Promise<string | null> - The client's timezone or null if not found
 */
export async function getClientTimezoneByCode(code: string): Promise<string | null> {
  try {
    const supabase = createClient()
    
    const { data, error } = await supabase
    .schema("lead_dialer")
      .from('clients')
      .select('timezone')
      .eq('code', code)
      .single()

    if (error) {
      console.error('Error fetching client timezone by code:', error)
      return null
    }

    return data?.timezone || null
  } catch (error) {
    console.error('Unexpected error in getClientTimezoneByCode:', error)
    return null
  }
}

/**
 * Retrieves full client information including timezone
 * @param clientId - The ID of the client
 * @returns Promise<Client | null> - The client data or null if not found
 */
export async function getClientById(clientId: number): Promise<Client | null> {
  try {
    const supabase = createClient()
    
    const { data, error } = await supabase
    .schema("lead_dialer")
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single()

    if (error) {
      console.error('Error fetching client by ID:', error)
      return null
    }

    return data as Client
  } catch (error) {
    console.error('Unexpected error in getClientById:', error)
    return null
  }
}