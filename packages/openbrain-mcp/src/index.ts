#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

interface CliOptions {
  apiKey: string;
  baseUrl: string;
}

interface MemoryRecord {
  id: string;
  content: string;
  source: string;
  metadata: Record<string, unknown>;
  embedding_model?: string;
  created_at: string;
  updated_at: string;
  embedded_at?: string;
  similarity?: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      options.set(rawKey, inlineValue);
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for --${rawKey}`);
    }

    options.set(rawKey, next);
    index += 1;
  }

  const apiKey = options.get("api-key") ?? process.env.OPENBRAIN_API_KEY;
  const baseUrl = options.get("base-url") ?? process.env.OPENBRAIN_BASE_URL;

  if (!apiKey) {
    throw new Error(
      "Missing API key. Pass --api-key or set OPENBRAIN_API_KEY.",
    );
  }

  if (!baseUrl) {
    throw new Error(
      "Missing base URL. Pass --base-url or set OPENBRAIN_BASE_URL.",
    );
  }

  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ""),
  };
}

async function postJson<T>(
  options: CliOptions,
  path: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(`${options.baseUrl}/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": options.apiKey,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  const parsed = text
    ? (JSON.parse(text) as T & { error?: string })
    : ({} as T & { error?: string });

  if (!response.ok) {
    const message =
      typeof parsed.error === "string"
        ? parsed.error
        : `Request failed with ${response.status}`;
    throw new Error(message);
  }

  return parsed;
}

function renderMemory(memory: MemoryRecord): string {
  return [
    `id: ${memory.id}`,
    `source: ${memory.source}`,
    `created_at: ${memory.created_at}`,
    `updated_at: ${memory.updated_at}`,
    memory.embedded_at ? `embedded_at: ${memory.embedded_at}` : undefined,
    memory.embedding_model
      ? `embedding_model: ${memory.embedding_model}`
      : undefined,
    memory.similarity !== undefined
      ? `similarity: ${memory.similarity.toFixed(4)}`
      : undefined,
    `metadata: ${JSON.stringify(memory.metadata)}`,
    "",
    memory.content,
  ]
    .filter(Boolean)
    .join("\n");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const server = new McpServer({
    name: "openbrain-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "create_memory",
    {
      description: "Create a memory in Open Brain.",
      inputSchema: z.object({
        content: z.string().min(1),
        source: z.string().min(1).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    },
    async ({ content, source, metadata }) => {
      const result = await postJson<{ memory: MemoryRecord }>(
        options,
        "create_memory",
        {
          content,
          source,
          metadata,
        },
      );

      return {
        content: [{ type: "text", text: renderMemory(result.memory) }],
      };
    },
  );

  server.registerTool(
    "delete_memory",
    {
      description: "Delete a memory from Open Brain by UUID.",
      inputSchema: z.object({
        id: z.string().uuid(),
      }),
    },
    async ({ id }) => {
      const result = await postJson<{ memory: MemoryRecord; deleted: boolean }>(
        options,
        "delete_memory",
        { id },
      );

      return {
        content: [
          {
            type: "text",
            text: `Deleted memory.\n\n${renderMemory(result.memory)}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "search_memories",
    {
      description: "Search memories by semantic similarity.",
      inputSchema: z.object({
        query: z.string().min(1),
        limit: z.number().int().min(1).max(25).optional(),
        source: z.string().min(1).optional(),
      }),
    },
    async ({ query, limit, source }) => {
      const result = await postJson<{ matches: MemoryRecord[] }>(
        options,
        "search_memories",
        {
          query,
          limit,
          source,
        },
      );

      if (result.matches.length === 0) {
        return {
          content: [{ type: "text", text: `No memories matched "${query}".` }],
        };
      }

      const text = result.matches
        .map((memory, index) => `${index + 1}.\n${renderMemory(memory)}`)
        .join("\n\n---\n\n");

      return {
        content: [{ type: "text", text }],
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("openbrain-mcp running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in openbrain-mcp:", error);
  process.exit(1);
});
