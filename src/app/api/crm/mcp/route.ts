import { z } from "zod";
import { createMcpHandler } from "mcp-handler";
import {
  getCustomerPipeLineWithFuzzySearch,
  getNextPipeLineStage,
  moveLeadToNextStage,
  getCustomerInformation,
} from "@/lib/helpers";

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
              text: `${customerPipeline.item.full_name} successfully moved to ${nextStage}`,
            },
          ],
        };
      }
    );

    server.tool(
      "customer-information",
      "Get information about a customer",
      { fullName: z.string() },
      async ({ fullName }) => {
        const customerInformation = await getCustomerInformation(fullName);
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
  },
  {},
  { basePath: "/api/crm" }
);

export { handler as GET, handler as POST, handler as DELETE };
