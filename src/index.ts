import { createMcpHandler } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

interface Env {}

const SEFARIA_API = "https://www.sefaria.org/api";

async function sefariaFetch(
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(`${SEFARIA_API}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Sefaria API error ${response.status}: ${body.slice(0, 500)}`,
      );
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function result(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function failure(error: unknown) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      },
    ],
  };
}

function createServer() {
  const server = new McpServer({
    name: "sefaria-search",
    version: "1.0.0",
  });

  server.registerTool(
    "search_sefaria",
    {
      description:
        "Search Sefaria's Jewish text library and return matching references and text.",
      inputSchema: {
        query: z.string().min(1).max(500),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ query, limit = 10 }) => {
      try {
        const data = await sefariaFetch("/search-wrapper", {
          method: "POST",
          body: JSON.stringify({
            query,
            type: "text",
            size: limit,
          }),
        });

        return result({
          ok: true,
          query,
          results: data,
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_sefaria_text",
    {
      description:
        "Retrieve a Sefaria text by reference, including available Hebrew, English and metadata.",
      inputSchema: {
        reference: z.string().min(1).max(500),
      },
    },
    async ({ reference }) => {
      try {
        const data = await sefariaFetch(
          `/v3/texts/${encodeURIComponent(reference)}?return_format=text_only`,
        );

        return result({
          ok: true,
          reference,
          data,
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}

const mcpHandler = createMcpHandler(createServer, {
  route: "/mcp",
  legacy: "stateless",
});

export default {
  fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    return mcpHandler(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;


