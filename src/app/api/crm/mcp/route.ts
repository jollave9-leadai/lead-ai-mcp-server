import { z } from "zod";
import { createMcpHandler } from "mcp-handler";
import {
  getNextPipeLineStage,
  moveLeadToNextStage,
  getAvailableAgent,
  initiateCall,
  sendSMS,
  sendEmail,
  getSuccessCriteriaByPhoneNumber,
  getStageItemByWithFuzzySearch,
} from "@/lib/helpers";
// import { CreateMessageRequestSchema } from "@modelcontextprotocol/sdk/types.js";
const handler = createMcpHandler(
  (server) => {
    server.tool(
      "move-customer-pipeline",
      "Move a customer to the next pipeline stage",
      { fullName: z.string() },
      async ({ fullName }) => {
        const [stageItem] = await getStageItemByWithFuzzySearch(fullName);
        if (!stageItem || !stageItem.item.party.contact.name) {
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
          stageItem.item.pipelineStage.pipeline.id,
          stageItem.item.pipelineStageId
        );
        console.log("nextStage", nextStage);
        if (!nextStage) {
          return {
            content: [
              {
                type: "text",
                text: `No next pipeline stage found for ${stageItem.item.party.contact.name}.`,
              },
            ],
          };
        }
        await moveLeadToNextStage(stageItem.item.id, nextStage.id);
        return {
          content: [
            {
              type: "text",
              text: `${stageItem.item.party.contact.name} successfully moved to ${nextStage.name}`,
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
        const [stageItem] = await getStageItemByWithFuzzySearch(
          fullName,
          clientId
        );
        if (!stageItem?.item?.party?.contact?.name) {
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
                stageItem.item.party.contact.name
              } Information: ${JSON.stringify(stageItem.item)}`,
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
        if (!stageItem.item.party.contact.phoneNumber) {
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
        await initiateCall(
          stageItem.item.party.contact.phoneNumber,
          agent,
          clientId,
          script
        );
        return {
          content: [
            {
              type: "text",
              text: `Successfully called ${stageItem.item.party.contact.name}`,
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
        if (!stageItem.item.party.contact.phoneNumber) {
          return {
            content: [
              {
                type: "text",
                text: `Customer's phone number not found.`,
              },
            ],
          };
        }
        const response = await sendSMS(
          stageItem.item.party.contact.phoneNumber,
          message
        );
        if (!response) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to send SMS to ${stageItem.item.party.contact.name}.`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `Successfully sent SMS to ${stageItem.item.party.contact.name}`,
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
        emailFrom: z.string(),
        emailSubject: z.string(),
        emailBody: z.string(),
      },
      async ({
        name,
        clientId,
        emailSubject,
        emailBody,
        emailFrom,
      }) => {
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
        if (!stageItem.item.party.contact.email) {
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
          emailSubject,
          emailBody,
          emailFrom,
          stageItem.item.party.contact.email
        );
        console.log("response", response);
        if (!response) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to send Email to ${stageItem.item.party.contact.name}.`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `Successfully sent Email to ${stageItem.item.party.contact.name}`,
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
        console.log("clientId", clientId);
        const { successCriteria, full_name } =
          await getSuccessCriteriaByPhoneNumber(phoneNumber, clientId);
        console.log("successCriteria", successCriteria);
        console.log("full_name", full_name);
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
              text: `Success criteria found with the phone number ${phoneNumber}: ${successCriteria} for ${full_name}`,
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
