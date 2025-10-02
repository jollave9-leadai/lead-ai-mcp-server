import { z } from "zod";
import { createMcpHandler } from "mcp-handler";
import {
  getCustomerPipeLineWithFuzzySearch,
  getNextPipeLineStage,
  moveLeadToNextStage,
  getCustomerInformation,
  getCustomerWithFuzzySearch,
  getAvailableAgent,
  initiateCall,
  sendSMS,
  sendEmail,
  getSuccessCriteriaByPhoneNumber,
} from "@/lib/helpers";
// import { CreateMessageRequestSchema } from "@modelcontextprotocol/sdk/types.js";
const handler = createMcpHandler(
  (server) => {
    server.tool(
      "move-customer-pipeline",
      "Move a customer to the next pipeline stage",
      { fullName: z.string() },
      async ({ fullName }) => {
        const [customerPipeline] = await getCustomerPipeLineWithFuzzySearch(
          fullName
        );
        if (!customerPipeline || !customerPipeline.item.full_name) {
          return {
            content: [
              {
                type: "text",
                text: `No customer found with the name ${fullName}.`,
              },
            ],
          };
        }
        const nextStage = await getNextPipeLineStage(
          customerPipeline.item.pipeline_stage_id,
          customerPipeline.item.created_by
        );
        console.log("nextStage", nextStage);
        if (!nextStage) {
          return {
            content: [
              {
                type: "text",
                text: `No next pipeline stage found for ${customerPipeline.item.full_name}.`,
              },
            ],
          };
        }
        await moveLeadToNextStage(customerPipeline.item.id, nextStage.id);
        return {
          content: [
            {
              type: "text",
              text: `${customerPipeline.item.full_name} successfully moved to ${nextStage.name}`,
            },
          ],
        };
      }
    );

    server.tool(
      "customer-information",
      "Get information about a customer",
      { fullName: z.string(), clientId: z.string() },
      async ({ fullName, clientId }) => {
        const customerInformation = await getCustomerInformation(
          fullName,
          clientId
        );
        if (!customerInformation?.customerPipeline?.full_name) {
          return {
            content: [
              {
                type: "text",
                text: `No customer found with the name ${fullName}.`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `${
                customerInformation.customerPipeline.full_name
              } Information: ${JSON.stringify(customerInformation)}`,
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
        clientId: z.string(), // Injected from the prompt
        script: z.string(),
      },
      async ({ name, clientId, script }) => {
        const [customer] = await getCustomerWithFuzzySearch(name, clientId);
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

        // Use sampling: to generate the script
        // const response = await server.server.createMessage({
        //   messages: [
        //     {
        //       role: "user",
        //       content: {
        //         type: "text",
        //         text: `Generate a script according to the role contents assigned to you.`,
        //       },
        //     },
        //   ],
        //   maxTokens: 200,
        //   temperature: 0.5,
        // });
        // Use sampling: to generate the script
        // const response = await server.server.request(
        //   {
        //     method: "sampling/createMessage",
        //     params: {
        //       messages: [
        //         {
        //           role: "user",
        //           content: {
        //             type: "text",
        //             text: `Generate a script according to the role contents assigned to you.`,
        //           },
        //         },
        //       ],
        //       max_tokens: 200,
        //       temperature: 0.5,
        //     },
        //   },
        //   CreateMessageRequestSchema
        // );
        // const script =
        //   response.params.messages[0].content.type === "text"
        //     ? (response.params.messages[0].content.text as string)
        //     : "Unable to generate script";
        console.log("script", script);
        await initiateCall(customer.item.phone_number, agent, clientId, script);
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

    server.tool(
      "sms-customer",
      "SMS customer by Name",
      {
        name: z.string(),
        clientId: z.string(), // Injected from the prompt
        message: z.string(),
      },
      async ({ name, clientId, message }) => {
        const [customer] = await getCustomerWithFuzzySearch(name, clientId);
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
        const response = await sendSMS(customer.item.phone_number, message);
        if (!response) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to send SMS to ${name}.`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `Successfully sent SMS to ${name}`,
            },
          ],
        };
      }
    );

    server.tool(
      "email-customer",
      "Email customer by Name",
      {
        name: z.string(),
        clientId: z.string(), // Injected from the prompt
        message: z.string(),
      },
      async ({ name, clientId, message }) => {
        const [customer] = await getCustomerWithFuzzySearch(name, clientId);
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
        if (!customer.item.email) {
          return {
            content: [
              {
                type: "text",
                text: `Customer's email not found.`,
              },
            ],
          };
        }
        const response = await sendEmail(
          clientId,
          customer.item.email,
          message,
          customer.item.pipeline_stage_id
        );
        console.log("response", response);
        if (!response) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to send Email to ${name}.`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `Successfully sent Email to ${name}`,
            },
          ],
        };
      }
    );

    server.tool(
      "get-success-criteria",
      "Get success criteria",
      {
        phoneNumber: z.string(),
        clientId: z.string(), // Injected from the prompt
      },
      async ({ phoneNumber, clientId }) => {
        console.log("Getting success criteria");
        const successCriteria = await getSuccessCriteriaByPhoneNumber(
          phoneNumber,
          clientId
        );
        console.log("clientId", clientId);
        if (!successCriteria) {
          return {
            content: [
              {
                type: "text",
                text: `No success criteria found with the phone number ${phoneNumber}.`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `Success criteria found with the phone number ${phoneNumber}: ${successCriteria}`,
            },
          ],
        };
      }
    );
  },
  {},
  { basePath: "/api/crm" }
);

export { handler as GET, handler as POST, handler as DELETE };
