import { createClient } from "@supabase/supabase-js";
import Fuse from "fuse.js";
import axios from "axios";
import { BASE_SUPABASE_FUNCTIONS_URL } from "./constants";
import { google } from "googleapis";
import { Client } from "@microsoft/microsoft-graph-client";
import { DateTime } from "luxon";

export const getCustomerWithFuzzySearch = async (
  name: string,
  clientId: string
) => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // TODO: replace created_by with client_id
  const { data: customers } = await supabase
    .from("customer_pipeline_items_with_customers")
    .select("id, full_name, phone_number, email, pipeline_stage_id, company")
    .eq("created_by", clientId);

  const fuse = new Fuse(customers || [], {
    keys: ["full_name"], // fields to search
    threshold: 0.5, // how fuzzy (0 = exact, 1 = very fuzzy)
  });
  return fuse.search(name);
};

// New function for leads search (for inbound/outbound agents)
export const getLeadWithFuzzySearch = async (
  name: string,
  clientId: string
) => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.DEVELOP_PUBLIC_SUPABASE_ANON_KEY!
  );

  try {
    const { data: leads, error } = await supabase
      .schema("lead_dialer")
      .from("leads")
      .select("id, full_name, first_name, last_name, email, phone_number, company, job_title, client_id")
      .eq("client_id", clientId)
      .eq("is_active", true);

    if (error) {
      console.error('Error fetching leads:', error);
      return [];
    }

    const fuse = new Fuse(leads || [], {
      keys: ["full_name", "first_name", "last_name"], // fields to search
      threshold: 0.5, // how fuzzy (0 = exact, 1 = very fuzzy)
    });
    return fuse.search(name);
  } catch (error) {
    console.error('Error in getLeadWithFuzzySearch:', error);
    return [];
  }
};

// Combined function to search both customers and leads
export const getContactWithFuzzySearch = async (
  name: string,
  clientId: string,
  searchType: 'customer' | 'lead' | 'both' = 'both'
): Promise<{
  found: boolean;
  contact?: {
    id: number;
    full_name: string;
    email: string;
    phone_number?: string;
    company?: string;
    source: 'customer' | 'lead';
  };
  score?: number;
}> => {
  try {
    let bestMatch: {
      id: number;
      full_name: string;
      email: string;
      phone_number?: string;
      company?: string;
    } | null = null;
    let bestScore = 1; // Lower is better for Fuse.js
    let source: 'customer' | 'lead' = 'customer';

    // Search customers if requested
    if (searchType === 'customer' || searchType === 'both') {
      const customerResults = await getCustomerWithFuzzySearch(name, clientId);
      if (customerResults && customerResults.length > 0) {
        const topCustomer = customerResults[0];
        if (topCustomer.score !== undefined && topCustomer.score < bestScore) {
          bestMatch = topCustomer.item;
          bestScore = topCustomer.score;
          source = 'customer';
        }
      }
    }

    // Search leads if requested
    if (searchType === 'lead' || searchType === 'both') {
      const leadResults = await getLeadWithFuzzySearch(name, clientId);
      if (leadResults && leadResults.length > 0) {
        const topLead = leadResults[0];
        if (topLead.score !== undefined && topLead.score < bestScore) {
          bestMatch = topLead.item;
          bestScore = topLead.score;
          source = 'lead';
        }
      }
    }

    if (bestMatch) {
      return {
        found: true,
        contact: {
          id: bestMatch.id,
          full_name: bestMatch.full_name,
          email: bestMatch.email,
          phone_number: bestMatch.phone_number,
          company: bestMatch.company,
          source
        },
        score: bestScore
      };
    }

    return { found: false };
  } catch (error) {
    console.error('Error in getContactWithFuzzySearch:', error);
    return { found: false };
  }
};

export const getAgentWithFuzzySearch = async (name: string) => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: agents } = await supabase
    .schema("lead_dialer")
    .from("agents")
    .select("name, id")
    .eq("name", name);

  const fuse = new Fuse(agents || [], {
    keys: ["name"], // fields to search
    threshold: 0.3, // how fuzzy (0 = exact, 1 = very fuzzy)
  });
  return fuse.search(name);
};

export const getAvailableAgent = async (clientId: string) => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: agents } = await supabase
    .schema("lead_dialer")
    .from("agents")
    .select("name, id")
    .order("created_at", { ascending: false }) // newest first
    .eq("is_active", true)
    .eq("client_id", clientId)
    .eq("agent_type", "outbound")
    .limit(1);

  return agents?.[0] || null;
};

export const initiateCall = async (
  phone_number: string,
  agent: { id: string; name: string },
  client_id: string,
  script?: string
) => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: vapiIntegration } = await supabase
    .schema("lead_dialer")
    .from("vapi_integration")
    .select("*")
    .eq("client_id", client_id)
    .eq("agent_id", agent.id)
    .single();
  const phoneCallPayload = {
    assistant: {
      name: agent.name,
      firstMessage: `Hi this is ${agent.name} do you have a moment?`,
      firstMessageMode:
        vapiIntegration?.firstMessageMode || "assistant-speaks-first",
      backgroundSound: vapiIntegration?.backgroundSound || "office",
      ...(vapiIntegration?.serverUrl && {
        serverUrl: vapiIntegration.serverUrl,
      }),
      transcriber: vapiIntegration?.transcriber || {
        provider: "deepgram",
        model: "nova-2",
        language: "en",
      },
      ...(vapiIntegration?.voice && {
        ...vapiIntegration.voice,
      }),
      // voice: {

      // chunkPlan belongs in voice object
      // ...(vapiIntegration?.chunkPlan && {
      //   chunkPlan: vapiIntegration.chunkPlan,
      // }),
      // ...(typeof vapiIntegration.talkingSpeed === "number" && {
      //   speed: vapiIntegration.talkingSpeed,
      // }),
      // },
      model: {
        provider:
          vapiIntegration?.model_configurations?.providers?.name || "openai",
        model: vapiIntegration?.model_configurations?.model || "gpt-4.1",
        temperature: vapiIntegration?.temperature || 0.2,
        maxTokens: vapiIntegration?.maxToken || 250,
        messages: [
          {
            role: "system",
            // content: "You are just relaying a message to a customer.",
            content: script,
          },
        ],
        // tools and toolIds belong in model object
        ...(vapiIntegration?.tools && { tools: vapiIntegration.tools }),
        ...(vapiIntegration?.toolIds && {
          toolIds: vapiIntegration.toolIds,
        }),
      },
      endCallPhrases: vapiIntegration?.endCallPhrases || [],
      startSpeakingPlan: vapiIntegration?.startSpeakingPlan || {
        waitSeconds: 4,
        smartEndpointingEnabled: true,
      },
      stopSpeakingPlan: vapiIntegration?.stopSpeakingPlan || {
        voiceSeconds: 0.5,
        numWords: 2,
      },
      // Add missing vapi_integration fields at assistant level
      // ...(vapiIntegration?.voicemailDetection && {
      //   voicemailDetection: vapiIntegration.voicemailDetection,
      // }),
      ...(vapiIntegration?.messagePlan && {
        messagePlan: vapiIntegration.messagePlan,
      }),
      // Add JSONB fields for advanced VAPI features at assistant level
      ...(vapiIntegration?.clientMessages && {
        clientMessages: vapiIntegration.clientMessages,
      }),
      ...(vapiIntegration?.serverMessages && {
        serverMessages: vapiIntegration.serverMessages,
      }),
      serverUrl:
        "https://weiqhneguxfutfdaxsil.supabase.co/functions/v1/outbound-agent-webhook-receiver",
    },
    type: "outboundPhoneCall",
    phoneNumberId: vapiIntegration?.phoneNumberId,
    phoneNumber: vapiIntegration?.phoneNumber,
    customer: {
      number: phone_number,
    },
    metadata: {
      client_id,
    },
  };
  // console.log("vapiIntegration", vapiIntegration);
  console.log("phoneCallPayload", JSON.stringify(phoneCallPayload));
  await axios.post("https://api.vapi.ai/call/phone", phoneCallPayload, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${vapiIntegration.auth_token}`,
    },
  });
};


export const getCustomerPipeLineWithFuzzySearch = async (fullName: string) => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  
  
  const { data: customerPipeLines } = await supabase
    .from("customer_pipeline_items_with_customers")
    .select("id, full_name, created_by, pipeline_stage_id");

  const fuse = new Fuse(customerPipeLines || [], {
    keys: ["full_name"], // fields to search
    threshold: 0.3, // how fuzzy (0 = exact, 1 = very fuzzy)
  });
  return fuse.search(fullName);
};

export const getNextPipeLineStage = async (
  pipelineStageId: string,
  clientId: string
) => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: pipeline } = await supabase
    .from("pipelines")
    .select("id, pipeline_stages(id, sort_order, name)")
    .order("sort_order", {
      referencedTable: "pipeline_stages",
      ascending: true,
    })
    .eq("is_default", true)
    .eq("created_by", clientId)
    .single();
  const currentIndex = pipeline?.pipeline_stages.findIndex(
    (stage) => stage.id === pipelineStageId
  );
  // check if currentIndex is undefined since 0 is also falsy
  if (
    currentIndex === undefined ||
    currentIndex === -1 ||
    !pipeline?.pipeline_stages[currentIndex + 1]
  ) {
    return null;
  }
  return pipeline?.pipeline_stages[currentIndex + 1];
};

export const moveLeadToNextStage = async (
  customerPipelineId: string,
  pipelineStageId: string
) => {
  console.log("customerPipelineId", customerPipelineId);
  console.log("pipelineStageId", pipelineStageId);
  await axios.put(
    `${BASE_SUPABASE_FUNCTIONS_URL}/customer-pipeline-items/${customerPipelineId}/stage`,
    {
      pipeline_stage_id: pipelineStageId,
    }
  );
};

export const getCustomerInformation = async (
  fullName: string,
  clientId: string
) => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // TODO: replace created_by with client_id
  const { data: customerPipeLines } = await supabase
    .from("customer_pipeline_items_with_customers")
    .select(
      "full_name,email, company, job_title, customer_status, customer_type, source, address, city, state, postal_code, country, phone_number, pipeline_stage_id"
    )
    .eq("created_by", clientId);

  console.log("clientId", clientId);
  console.log("customerPipeLines", customerPipeLines);

  const fuse = new Fuse(customerPipeLines || [], {
    keys: ["full_name"], // fields to search
    threshold: 0.3, // how fuzzy (0 = exact, 1 = very fuzzy)
  });
  const [customerPipeline] = fuse.search(fullName);
  console.log("customerPipeline", customerPipeline);
  if (!customerPipeline) return;

  const { data: stage } = await supabase
    .from("pipeline_stages")
    .select("name, description, sort_order")
    .eq("id", customerPipeline.item.pipeline_stage_id)
    .single();

  return {
    stage,
    customerPipeline: customerPipeline.item,
  };
};

export const getSuccessCriteriaByPhoneNumber = async (
  phoneNumber: string,
  clientId: string
) => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // TODO: replace created_by with client_id
  const { data: customer } = await supabase
    .from("customer_pipeline_items_with_customers")
    .select("full_name, pipeline_stage_id")
    .eq("phone_number", phoneNumber)
    .eq("created_by", clientId)
    .single();

  console.log("clientId", clientId);
  console.log("customer", customer);

  const { data: stage } = await supabase
    .from("pipeline_stages")
    .select("success_criteria")
    .eq("id", customer?.pipeline_stage_id)
    .single();
  console.log("stage", stage);
  const successCriteria = stage?.success_criteria;
  console.log("successCriteria", successCriteria);
  console.log("full_name", customer?.full_name);
  return { successCriteria, full_name: customer?.full_name };
};

export const sendSMS = async (phone_number: string, smsBody: string) => {
  const telnyxPayload = {
    // from: vapi.data.phone_number,
    from: "+61489900690",
    messaging_profile_id: "400197bf-b007-4314-9f9f-c5cd0b7b67ae",
    to: phone_number as string,
    text: smsBody,
    subject: "From LeadAI!",
    use_profile_webhooks: true,
    type: "SMS",
  };
  try {
    const smsResponse = await axios.post(
      "https://api.telnyx.com/v2/messages",
      telnyxPayload,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
        },
      }
    );
    const smsText = await smsResponse.data;
    console.log("Telnyx SMS response:", smsText);
    return smsText;
  } catch (smsError) {
    console.error("Failed to send Telnyx SMS:", smsError);
    return null;
  }
};

// Helper: encode email to base64url
const createEmailRaw = (
  to: string,
  from: string,
  subject: string,
  body: string
) => {
  const message =
    `To: ${to}\r\n` +
    `From: ${from}\r\n` +
    `Subject: ${subject}\r\n\r\n` +
    body;

  return Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

// Helper: refresh token for email
const handleRefreshToken = async (refreshToken: string, provider: string) => {
  let newAccessToken = null;
  let newRefreshToken = null;
  let newExpiresAt = null;
  if (provider === "azure-ad") {
    const response = await axios.post(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      {
        refresh_token: refreshToken,
        client_id: process.env.MICROSOFT_CLIENT_ID,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET,
        grant_type: "refresh_token",
        scope:
          "https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send offline_access",
      },
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );
    newAccessToken = response.data.access_token;
    newRefreshToken = response.data.refresh_token;
    const now = Math.floor(Date.now() / 1000);
    newExpiresAt = now + response.data.expiresIn;
  } else {
    const response = await axios.post(
      "https://oauth2.googleapis.com/token",
      {
        refresh_token: refreshToken,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        grant_type: "refresh_token",
      },
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );
    newAccessToken = response.data.access_token;
    newRefreshToken = response.data.refresh_token;
    const now = Math.floor(Date.now() / 1000);
    newExpiresAt = now + response.data.expiresIn;
  }

  return {
    access_token: newAccessToken,
    refresh_token: newRefreshToken,
    expires_at: newExpiresAt,
  };
};

export async function sendOutlookMail(
  accessToken: string,
  email: string,
  emailBody: string
) {
  const client = Client.init({
    authProvider: (done) => {
      done(null, accessToken); // use OAuth token from NextAuth
    },
  });

  await client.api("/me/sendMail").post({
    message: {
      subject: "From LeadAI!",
      body: {
        contentType: "Text",
        content: emailBody,
      },
      toRecipients: [
        {
          emailAddress: {
            address: email,
          },
        },
      ],
    },
  });
  return "Email from outlook sent successfully";
}

const sendGmail = async (
  accessToken: string,
  toEmail: string,
  fromEmail: string,
  emailBody: string
) => {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const gmail = google.gmail({ version: "v1", auth });

  const rawMessage = createEmailRaw(
    toEmail,
    fromEmail,
    "From LeadAI!",
    emailBody
  );

  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: rawMessage },
  });
  return response;
};

export const sendEmail = async (
  client_id: string,
  email: string,
  emailBody: string,
  stage_id: string
) => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: stage } = await supabase
    .from("pipeline_stages")
    .select("agent_settings")
    .eq("id", stage_id)
    .single();
  console.log("stage", stage);

  if (!stage?.agent_settings?.email_account) {
    console.log("No email account found for stage", stage_id);
    return null;
  }

  const { data: emailData } = await supabase
    .from("emails")
    .select("*")
    .eq("email", stage?.agent_settings?.email_account || "")
    .eq("client_id", client_id)
    .single();
  console.log("emailData", emailData);

  try {
    // Handle token refresh
    const expiresAt = emailData.expires_at * 1000; // convert to ms
    let accessToken = emailData.access_token;
    let refreshToken = emailData.refresh_token;
    if (Date.now() >= expiresAt) {
      const refreshedToken = await handleRefreshToken(
        refreshToken,
        emailData.provider
      );
      if (refreshedToken) {
        // Store the refreshed token in the database
        const now = Math.floor(Date.now() / 1000);
        await supabase
          .from("emails")
          .update({
            access_token: refreshedToken.access_token,
            refresh_token: refreshedToken.refresh_token,
            expires_at: now + refreshedToken.expires_at,
          })
          .eq("email", emailData.email)
          .eq("client_id", client_id);
        accessToken = refreshedToken.access_token;
        refreshToken = refreshedToken.refresh_token;
      }
    }
    if (emailData?.provider === "azure-ad") {
      const response = await sendOutlookMail(accessToken, email, emailBody);
      console.log("Outlook Email response:", response);
      return response;
    } else {
      const response = await sendGmail(
        accessToken,
        email,
        emailData?.email || "",
        emailBody
      );
      console.log("Email response:", response.data);
      return response.data;
    }
  } catch (smsError) {
    console.error("Failed to send Email:", smsError);
    return null;
  }
};


/**
 * Get agent assigned to a calendar connection
 */
export const getAgentByCalendarConnection = async (calendarConnectionId: string, clientId: number) => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: assignment, error } = await supabase
    .schema("lead_dialer")
    .from("agent_calendar_assignments")
    .select(`
      agent_id,
      agents!inner (
        id,
        name,
        profile_id,
        client_id,
        is_active,
        agent_type,
        profiles (
          id,
          name,
          office_hours,
          timezone
        )
      )
    `)
    .eq("calendar_connection_id", calendarConnectionId)
    .eq("client_id", clientId)
    .single();

  if (error) {
    console.error("Error getting agent by calendar connection:", error);
    return null;
  }

  return assignment;
};

/**
 * Get calendar connection assigned to a specific agent
 * This is the key function for the booking workflow
 */
export const getCalendarConnectionByAgent = async (
  agentId: number,
  clientId: number
): Promise<{
  success: boolean;
  connection?: {
    id: string;
    email: string;
    display_name: string;
    access_token: string;
    refresh_token: string;
    expires_at: string;
  };
  agent?: {
    id: number;
    name: string;
    agent_type: string;
    profiles: {
      id: number;
      name: string;
      office_hours: Record<string, { start: string; end: string; enabled: boolean }>;
      timezone: string;
    };
  };
  error?: string;
}> => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  try {
    console.log(`🔍 Looking up calendar for agent ${agentId} in client ${clientId}`);

    // Get the agent's calendar assignment
    const { data: assignment, error: assignmentError } = await supabase
      .schema("lead_dialer")
      .from("agent_calendar_assignments")
      .select(`
        id,
        client_id,
        agent_id,
        calendar_connection_id,
        agents!inner (
          id,
          name,
          agent_type,
          profile_id,
          profiles!inner (
            id,
            name,
            office_hours,
            timezone
          )
        ),
        calendar_connections!inner (
          id,
          email,
          display_name,
          access_token,
          refresh_token,
          expires_at,
          is_connected
        )
      `)
      .eq("agent_id", agentId)
      .eq("client_id", clientId)
      .single();

    if (assignmentError) {
      console.error("Error fetching agent calendar assignment:", assignmentError);
      return {
        success: false,
        error: `No calendar assignment found for agent ${agentId}. Please assign a calendar to this agent.`
      };
    }

    if (!assignment) {
      return {
        success: false,
        error: `Agent ${agentId} does not have a calendar assigned. Please assign a calendar to this agent.`
      };
    }

    // Check if calendar connection is active
    const calendarConnection = assignment.calendar_connections as unknown as {
      id: string;
      email: string;
      display_name: string;
      access_token: string;
      refresh_token: string;
      expires_at: string;
      is_connected: boolean;
    };

    if (!calendarConnection.is_connected) {
      return {
        success: false,
        error: `Calendar connection for agent ${agentId} is not active. Please reconnect the calendar.`
      };
    }

    const agent = assignment.agents as unknown as {
      id: number;
      name: string;
      agent_type: string;
      profile_id: number;
      profiles: {
        id: number;
        name: string;
        office_hours: Record<string, { start: string; end: string; enabled: boolean }>;
        timezone: string;
      };
    };

    console.log(`✅ Found calendar assignment for agent ${agent.name} (${agent.agent_type})`);
    console.log(`📧 Calendar: ${calendarConnection.email} (${calendarConnection.display_name})`);

    return {
      success: true,
      connection: {
        id: calendarConnection.id,
        email: calendarConnection.email,
        display_name: calendarConnection.display_name,
        access_token: calendarConnection.access_token,
        refresh_token: calendarConnection.refresh_token,
        expires_at: calendarConnection.expires_at,
      },
      agent: {
        id: agent.id,
        name: agent.name,
        agent_type: agent.agent_type,
        profiles: agent.profiles,
      }
    };

  } catch (error) {
    console.error("Error in getCalendarConnectionByAgent:", error);
    return {
      success: false,
      error: `Failed to get calendar connection: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
};

/**
 * Check if a time slot is within office hours
 * Handles both UTC and local timezone formats properly
 */
export const isWithinOfficeHours = (
  dateTime: string,
  officeHours: Record<string, { start: string; end: string; enabled: boolean }>,
  timezone: string = 'Australia/Melbourne'
): { isWithin: boolean; reason?: string } => {
  if (!officeHours) {
    return { isWithin: true }; // No office hours restriction
  }

  try {
    let date: Date;
    let interpretationMethod = '';

    // SMART TIMEZONE DETECTION:
    // If datetime ends with 'Z' or has timezone info, it's UTC/absolute time
    // If datetime has no timezone info, interpret it as client's local time
    if (dateTime.endsWith('Z') || dateTime.includes('+') || dateTime.includes('-', 10)) {
      // Has timezone info - use as-is
      date = new Date(dateTime);
      interpretationMethod = 'UTC/Absolute';
    } else {
      // No timezone info - interpret as client's local time
      // Convert "2025-10-15T09:00:00" to "2025-10-15T09:00:00" in client timezone
      const localTime = DateTime.fromISO(dateTime, { zone: timezone });
      date = localTime.toJSDate();
      interpretationMethod = 'Client Local Time';
    }
    
    const dayOfWeek = date.toLocaleDateString('en-US', { 
      weekday: 'long',
      timeZone: timezone 
    }).toLowerCase();
    
    const timeString = date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone
    });
    
    console.log(`🕐 OFFICE HOURS DEBUG:`)
    console.log(`   Input dateTime: "${dateTime}"`)
    console.log(`   Interpretation: ${interpretationMethod}`)
    console.log(`   Parsed date (UTC): ${date.toISOString()}`)
    console.log(`   Day of week in ${timezone}: ${dayOfWeek}`)
    console.log(`   Time string in ${timezone}: ${timeString}`)
    console.log(`   Office hours for ${dayOfWeek}:`, officeHours[dayOfWeek])

    // Convert office hours format - assuming it's like:
    // { "monday": { "start": "09:00", "end": "17:00", "enabled": true }, ... }
    const daySchedule = officeHours[dayOfWeek];
    
    if (!daySchedule || !daySchedule.enabled) {
      return { 
        isWithin: false, 
        reason: `Agent is not available on ${dayOfWeek}s` 
      };
    }

    const startTime = daySchedule.start;
    const endTime = daySchedule.end;

    if (timeString < startTime || timeString > endTime) {
      return { 
        isWithin: false, 
        reason: `Time ${timeString} is outside office hours (${startTime} - ${endTime}) on ${dayOfWeek}s` 
      };
    }

    console.log(`✅ OFFICE HOURS: ${timeString} is within ${startTime}-${endTime} on ${dayOfWeek}s`);
    return { isWithin: true };
  } catch (error) {
    console.error("Error checking office hours:", error);
    return { isWithin: true }; // Default to allowing if there's an error
  }
};

/**
 * Get available time slots within office hours
 */
export const getOfficeHoursSlots = (
  date: string,
  officeHours: Record<string, { start: string; end: string; enabled: boolean }>,
  timezone: string = 'Australia/Melbourne',
  slotDurationMinutes: number = 60
): Array<{ start: string; end: string }> => {
  if (!officeHours) {
    return []; // No office hours defined
  }

  try {
    const targetDate = new Date(date);
    const dayOfWeek = targetDate.toLocaleDateString('en-US', { 
      weekday: 'long',
      timeZone: timezone 
    }).toLowerCase();

    const daySchedule = officeHours[dayOfWeek];
    
    if (!daySchedule || !daySchedule.enabled) {
      return []; // Not available on this day
    }

    const slots: Array<{ start: string; end: string }> = [];
    const startTime = daySchedule.start; // e.g., "09:00"
    const endTime = daySchedule.end;     // e.g., "17:00"

    // Parse start and end times
    const [startHour, startMinute] = startTime.split(':').map(Number);
    const [endHour, endMinute] = endTime.split(':').map(Number);

    // Create datetime objects for the target date
    const startDateTime = new Date(targetDate);
    startDateTime.setHours(startHour, startMinute, 0, 0);

    const endDateTime = new Date(targetDate);
    endDateTime.setHours(endHour, endMinute, 0, 0);

    // Generate slots every 30 minutes within office hours
    let currentSlot = new Date(startDateTime);
    
    while (currentSlot.getTime() + (slotDurationMinutes * 60 * 1000) <= endDateTime.getTime()) {
      const slotEnd = new Date(currentSlot.getTime() + (slotDurationMinutes * 60 * 1000));
      
      slots.push({
        start: currentSlot.toISOString(),
        end: slotEnd.toISOString()
      });

      // Move to next slot (30-minute increments)
      currentSlot = new Date(currentSlot.getTime() + (30 * 60 * 1000));
    }

    return slots;
  } catch (error) {
    console.error("Error generating office hours slots:", error);
    return [];
  }
};
