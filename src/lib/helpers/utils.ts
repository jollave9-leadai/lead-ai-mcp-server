import { createClient } from "@supabase/supabase-js";
import Fuse from "fuse.js";
import axios from "axios";
import { BASE_SUPABASE_FUNCTIONS_URL } from "./constants";

export const getCustomerWithFuzzySearch = async (name: string) => {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: customers } = await supabase
    .schema("lead_dialer")
    .from("customers")
    .select("full_name, phone_number");

  const fuse = new Fuse(customers || [], {
    keys: ["full_name"], // fields to search
    threshold: 0.5, // how fuzzy (0 = exact, 1 = very fuzzy)
  });
  return fuse.search(name);
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
  message: string,
  agent: { id: string; name: string },
  client_id: string
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
      firstMessage: message,
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
        model: vapiIntegration?.model_configurations?.model || "gpt-4",
        temperature: vapiIntegration?.temperature || 0.2,
        maxTokens: vapiIntegration?.maxToken || 250,
        messages: [
          {
            role: "system",
            content: "You are just relaying a message to a customer.",
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
      ...(vapiIntegration?.voicemailDetection && {
        voicemailDetection: vapiIntegration.voicemailDetection,
      }),
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
    },
    type: "outboundPhoneCall",
    phoneNumberId: vapiIntegration?.phoneNumberId,
    phoneNumber: vapiIntegration?.phoneNumber,
    customer: {
      number: phone_number,
    },
  };
  // console.log("phoneCallPayload", phoneCallPayload);
  console.log("vapiIntegration", vapiIntegration);
  await axios.post(
    "https://api.vapi.ai/call/phone",
    phoneCallPayload,
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${vapiIntegration.auth_token}`,
      },
    }
  );
};

export const getCustomerPipeLineWithFuzzySearch = async (fullName: string) => {
  const supabase = createClient(
    process.env.CRM_SUPABASE_URL!,
    process.env.CRM_SUPABASE_ANON_KEY!
  );
  const { data: customerPipeLines } = await supabase
    .from("customer_pipeline_items_with_customers")
    .select("id, full_name, pipeline_stage_id");

  const fuse = new Fuse(customerPipeLines || [], {
    keys: ["full_name"], // fields to search
    threshold: 0.3, // how fuzzy (0 = exact, 1 = very fuzzy)
  });
  return fuse.search(fullName);
};

export const getNextPipeLineStage = async (pipelineStageId: string) => {
  const supabase = createClient(
    process.env.CRM_SUPABASE_URL!,
    process.env.CRM_SUPABASE_ANON_KEY!
  );
  const { data: pipeline } = await supabase
    .from("pipelines")
    .select("id, pipeline_stages(id, sort_order)")
    .order("sort_order", {
      referencedTable: "pipeline_stages",
      ascending: true,
    })
    .eq("is_default", true)
    .eq("name", "Default Pipeline for LeadAI")
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

export const getCustomerInformation = async (fullName: string) => {
  const supabase = createClient(
    process.env.CRM_SUPABASE_URL!,
    process.env.CRM_SUPABASE_ANON_KEY!
  );
    const { data: customerPipeLines } = await supabase
      .from("customer_pipeline_items_with_customers")
      .select("id, full_name, pipeline_stage_id");

    const fuse = new Fuse(customerPipeLines || [], {
      keys: ["full_name"], // fields to search
      threshold: 0.3, // how fuzzy (0 = exact, 1 = very fuzzy)
    });
  const [customerPipeline] = fuse.search(fullName);
  const { data: stage } = await supabase
    .from("pipeline_stages")
    .select("*")
    .eq("id", customerPipeline.item.pipeline_stage_id)
    .single();

  return {
    stage,
    customerPipeline: customerPipeline.item,
  };
};