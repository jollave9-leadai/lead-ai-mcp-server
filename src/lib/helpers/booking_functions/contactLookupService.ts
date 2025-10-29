/**
 * Contact Lookup Service
 * 
 * Handles searching for contacts in both customer and lead databases
 * with fuzzy matching capabilities.
 */

import { createClient } from "@supabase/supabase-js";
import Fuse from "fuse.js";
import type { ContactInfo, ContactSearchResult } from "@/types";

/**
 * Search for a contact by name across customer and lead databases
 */
export async function searchContactByName(
  name: string,
  clientId: number
): Promise<ContactSearchResult> {
  try {
    console.log(`🔍 Searching for contact: "${name}" for client ${clientId}`);

    // Search both customers and leads in parallel
    const [customerResult, leadResult] = await Promise.all([
      searchInCustomers(name, clientId),
      searchInLeads(name, clientId),
    ]);

    // Prefer customer matches over lead matches
    if (customerResult.found && customerResult.contact) {
      console.log(
        `✅ Found customer: ${customerResult.contact.name} (${customerResult.contact.email})`
      );
      return customerResult;
    }

    if (leadResult.found && leadResult.contact) {
      console.log(
        `✅ Found lead: ${leadResult.contact.name} (${leadResult.contact.email || "no email"})`
      );
      return leadResult;
    }

    // Combine all matches if neither has a strong match
    const allMatches = [
      ...(customerResult.matches || []),
      ...(leadResult.matches || []),
    ];

    if (allMatches.length > 0) {
      return {
        found: false,
        matches: allMatches,
        message: `Found ${allMatches.length} potential matches. Please specify email or choose from the list.`,
      };
    }

    return {
      found: false,
      message: `No contact found with name "${name}" in customer or lead database.`,
    };
  } catch (error) {
    console.error("Error searching for contact:", error);
    return {
      found: false,
      message:
        error instanceof Error
          ? `Search error: ${error.message}`
          : "Unknown search error",
    };
  }
}

/**
 * Search for contact by email
 */
export async function searchContactByEmail(
  email: string,
  clientId: number
): Promise<ContactSearchResult> {
  try {
    console.log(`🔍 Searching for contact by email: "${email}" for client ${clientId}`);

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Search in customers first
    const { data: customer } = await supabase
      .from("customer_pipeline_items_with_customers")
      .select("id, full_name, email, phone_number, company")
      .eq("created_by", clientId.toString())
      .eq("email", email)
      .single();

    if (customer && customer.email) {
      const contactInfo: ContactInfo = {
        name: customer.full_name || "Unknown",
        email: customer.email,
        phone: customer.phone_number || undefined,
        source: "customer",
        id: customer.id,
        company: customer.company || undefined,
      };

      return {
        found: true,
        contact: contactInfo,
        searchScore: 1.0,
        message: "Customer found by email",
      };
    }

    // Search in leads
    const { data: lead } = await supabase
      .from("leads")
      .select("id, full_name, email, phone_number, company")
      .eq("client_id", clientId)
      .eq("email", email)
      .single();

    if (lead && lead.email) {
      const contactInfo: ContactInfo = {
        name: lead.full_name || "Unknown",
        email: lead.email,
        phone: lead.phone_number || undefined,
        source: "lead",
        id: lead.id,
        company: lead.company || undefined,
      };

      return {
        found: true,
        contact: contactInfo,
        searchScore: 1.0,
        message: "Lead found by email",
      };
    }

    return {
      found: false,
      message: `No contact found with email "${email}"`,
    };
  } catch (error) {
    console.error("Error searching by email:", error);
    return {
      found: false,
      message:
        error instanceof Error
          ? `Email search error: ${error.message}`
          : "Unknown search error",
    };
  }
}

/**
 * Search for contact by phone number
 */
export async function searchContactByPhone(
  phone: string,
  clientId: number
): Promise<ContactSearchResult> {
  try {
    console.log(`🔍 Searching for contact by phone: "${phone}" for client ${clientId}`);

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Normalize phone number (remove spaces, dashes, etc.)
    const normalizedPhone = phone.replace(/[\s\-\(\)]/g, "");

    // Search in customers
    const { data: customers } = await supabase
      .from("customer_pipeline_items_with_customers")
      .select("id, full_name, email, phone_number, company")
      .eq("created_by", clientId.toString());

    const customerMatch = customers?.find((c) =>
      c.phone_number?.replace(/[\s\-\(\)]/g, "").includes(normalizedPhone)
    );

    if (customerMatch) {
      const contactInfo: ContactInfo = {
        name: customerMatch.full_name || "Unknown",
        email: customerMatch.email || "",
        phone: customerMatch.phone_number || undefined,
        source: "customer",
        id: customerMatch.id,
        company: customerMatch.company || undefined,
      };

      return {
        found: true,
        contact: contactInfo,
        searchScore: 1.0,
        message: "Customer found by phone",
      };
    }

    // Search in leads
    const { data: leads } = await supabase
      .from("leads")
      .select("id, full_name, email, phone_number, company")
      .eq("client_id", clientId);

    const leadMatch = leads?.find((l) =>
      l.phone_number?.replace(/[\s\-\(\)]/g, "").includes(normalizedPhone)
    );

    if (leadMatch) {
      const contactInfo: ContactInfo = {
        name: leadMatch.full_name || "Unknown",
        email: leadMatch.email || "",
        phone: leadMatch.phone_number || undefined,
        source: "lead",
        id: leadMatch.id,
        company: leadMatch.company || undefined,
      };

      return {
        found: true,
        contact: contactInfo,
        searchScore: 1.0,
        message: "Lead found by phone",
      };
    }

    return {
      found: false,
      message: `No contact found with phone "${phone}"`,
    };
  } catch (error) {
    console.error("Error searching by phone:", error);
    return {
      found: false,
      message:
        error instanceof Error
          ? `Phone search error: ${error.message}`
          : "Unknown search error",
    };
  }
}

/**
 * Search in customers database with fuzzy matching
 */
async function searchInCustomers(
  name: string,
  clientId: number
): Promise<ContactSearchResult> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: customers } = await supabase
    .from("customer_pipeline_items_with_customers")
    .select("id, full_name, phone_number, email, pipeline_stage_id, company")
    .eq("created_by", clientId.toString());

  if (!customers || customers.length === 0) {
    return { found: false };
  }

  const fuse = new Fuse(customers, {
    keys: ["full_name"],
    threshold: 0.3, // More strict matching (0 = exact, 1 = very fuzzy)
    includeScore: true,
  });

  const results = fuse.search(name);

  if (results.length === 0) {
    return { found: false };
  }

  const bestMatch = results[0];
  const customer = bestMatch.item;

  // Strong match if score is below 0.2
  if (bestMatch.score && bestMatch.score < 0.2 && customer.email) {
    const contactInfo: ContactInfo = {
      name: customer.full_name || "Unknown",
      email: customer.email,
      phone: customer.phone_number || undefined,
      source: "customer",
      id: customer.id,
      company: customer.company || undefined,
    };

    return {
      found: true,
      contact: contactInfo,
      searchScore: bestMatch.score,
      message: "Customer found with high confidence",
    };
  }

  // Weak matches - return multiple options
  const matches: ContactInfo[] = results
    .slice(0, 5)
    .filter((r) => r.item.email)
    .map((r) => ({
      name: r.item.full_name || "Unknown",
      email: r.item.email!,
      phone: r.item.phone_number || undefined,
      source: "customer" as const,
      id: r.item.id,
      company: r.item.company || undefined,
    }));

  return {
    found: false,
    matches,
    message: `Found ${matches.length} potential customer matches`,
  };
}

/**
 * Search in leads database with fuzzy matching
 */
async function searchInLeads(
  name: string,
  clientId: number
): Promise<ContactSearchResult> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: leads } = await supabase
    .from("leads")
    .select("id, full_name, phone_number, email, company")
    .eq("client_id", clientId);

  if (!leads || leads.length === 0) {
    return { found: false };
  }

  const fuse = new Fuse(leads, {
    keys: ["full_name"],
    threshold: 0.3,
    includeScore: true,
  });

  const results = fuse.search(name);

  if (results.length === 0) {
    return { found: false };
  }

  const bestMatch = results[0];
  const lead = bestMatch.item;

  // Strong match if score is below 0.2 and has email
  if (bestMatch.score && bestMatch.score < 0.2 && lead.email) {
    const contactInfo: ContactInfo = {
      name: lead.full_name || "Unknown",
      email: lead.email,
      phone: lead.phone_number || undefined,
      source: "lead",
      id: lead.id,
      company: lead.company || undefined,
    };

    return {
      found: true,
      contact: contactInfo,
      searchScore: bestMatch.score,
      message: "Lead found with high confidence",
    };
  }

  // Weak matches - return multiple options
  const matches: ContactInfo[] = results
    .slice(0, 5)
    .filter((r) => r.item.email)
    .map((r) => ({
      name: r.item.full_name || "Unknown",
      email: r.item.email!,
      phone: r.item.phone_number || undefined,
      source: "lead" as const,
      id: r.item.id,
      company: r.item.company || undefined,
    }));

  return {
    found: false,
    matches,
    message: `Found ${matches.length} potential lead matches`,
  };
}

/**
 * Validate email address format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Create manual contact info (when not found in database)
 */
export function createManualContact(
  name: string,
  email: string,
  phone?: string
): ContactInfo {
  return {
    name,
    email,
    phone,
    source: "manual",
  };
}

