import { z } from "zod";
import { createMcpHandler } from "mcp-handler";
import {
  getAvailableAgent,
  initiateCall,
  getStageItemByWithFuzzySearch,
} from "@/lib/helpers";
import axios from "axios";

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "send-message-to-crm-agent",
      "Send a message to the CRM agent",
      { message: z.string(), clientId: z.string() },
      async ({ message, clientId }) => {
        const response = await axios.post(process.env.CRM_AGENT_URL!, {
          message: `clientId: ${clientId}\n\n${message}`,
        });
        console.log("response", response);
        return {
          content: [
            {
              type: "text",
              text: `Message sent to CRM agent: ${JSON.stringify(
                response.data.tool_calls_result || response.data.content
              )}`,
            },
          ],
        };
      }
    );
    server.tool(
      "call-customer",
      "Call by Name",
      {
        name: z.string(),
        message: z.string(),
        clientId: z.string(), // Injected from the prompt
      },
      async ({ name, message, clientId }) => {
        const [stageItem] = await getStageItemByWithFuzzySearch(name, clientId);
        console.log("stageItem", stageItem);
        console.log("clientId", clientId);
        if (!stageItem?.item?.party?.contact?.name) {
          return {
            content: [
              {
                type: "text",
                text: `No customer found with the name ${name}.`,
              },
            ],
          };
        }
        if (!stageItem.item.party?.contact?.phoneNumber) {
          return {
            content: [
              {
                type: "text",
                text: `Customer's phone number not found.`,
              },
            ],
          };
        }
        const agent = await getAvailableAgent(clientId);
        if (!agent) {
          return {
            content: [
              {
                type: "text",
                text: `No available agent found.`,
              },
            ],
          };
        }
        await initiateCall(
          stageItem.item.party.contact.phoneNumber,
          agent,
          clientId,
          "Relaying message: " + message
        );
        return {
          content: [
            {
              type: "text",
              text: `Successfully called ${name}`,
            },
          ],
        };
      }
    );
  },
  {},
  { basePath: "/api" }
);

export { handler as GET, handler as POST, handler as DELETE };
