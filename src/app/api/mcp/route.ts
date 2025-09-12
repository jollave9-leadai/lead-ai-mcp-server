import { z } from "zod";
import { createMcpHandler } from "mcp-handler";
import {
  getCustomerWithFuzzySearch,
  getAvailableAgent,
  initiateCall,
} from "@/lib/helpers";
import axios from "axios";

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "send-message-to-crm-agent",
      "Send a message to the CRM agent",
      { message: z.string() },
      async ({ message }) => {
        const response = await axios.post(process.env.CRM_AGENT_URL!, {
          message,
        });
        console.log("response", response);
        return {
          content: [
            {
              type: "text",
              text: `Message sent to CRM agent: ${JSON.stringify(
                response.data.tool_calls_result
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
        const [customer] = await getCustomerWithFuzzySearch(name);
        console.log("customer", customer);
        console.log("clientId", clientId);
        if (!customer) {
          return {
            content: [
              {
                type: "text",
                text: `No customer found with the name ${name}.`,
              },
            ],
          };
        }
        if (!customer.item.phone_number) {
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
          customer.item.phone_number,
          message,
          agent,
          clientId
        );
        return {
          content: [
            {
              type: "text",
              text: `Successfully called ${name}. Call ID: 0`,
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
