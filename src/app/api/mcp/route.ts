import { z } from "zod";
import { createMcpHandler } from "mcp-handler";
import {
  getCustomerWithFuzzySearch,
  getAvailableAgent,
  initiateCall,
} from "@/lib/helpers";

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "roll_dice",
      "Rolls an N-sided die",
      { sides: z.number().int().min(2) },
      async ({ sides }) => {
        const value = 1 + Math.floor(Math.random() * sides);
        return {
          content: [{ type: "text", text: `🎲 You rolled a ${value}!` }],
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
        initiateCall(customer.item.phone_number, message, agent, clientId);
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
