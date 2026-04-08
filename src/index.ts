#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer } from "http";
import { z } from "zod";
import { HubTheClient, getCredentials } from "./hubthe-client.js";

const client = new HubTheClient(process.env.HUBTHE_URL);

let authPromise: Promise<void> | null = null;

function autoAuth(): Promise<void> {
  if (client.isAuthenticated) return Promise.resolve();

  if (authPromise) return authPromise;

  const creds = getCredentials();

  if (!creds) {
    return Promise.reject(
      new Error(
        "No credentials found. Either run ./setup.sh (macOS) " +
          "or set HUBTHE_EMAIL and HUBTHE_PASSWORD environment variables."
      )
    );
  }

  authPromise = client.auth(creds.email, creds.password).then(() => {});
  return authPromise;
}

const server = new McpServer({
  name: "hubthe",
  version: "1.0.0",
});

// --- Tool: hubthe_whoami ---

server.tool(
  "hubthe_whoami",
  "Get information about the currently authenticated user.",
  {},
  async () => {
    try {
      await autoAuth();
      const user = await client.whoami();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(user, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// --- Tool: hubthe_list_projects ---

server.tool(
  "hubthe_list_projects",
  "List all projects accessible to the authenticated user.",
  {},
  async () => {
    try {
      await autoAuth();
      const projects = await client.listProjects();
      const summary = projects.map((p) => ({
        guid: p.guid,
        name: p.name,
        slug: p.slug,
        description: p.description,
        creator: p.creator,
        hidden: p.hidden,
        archive: p.archive,
      }));
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// --- Tool: hubthe_set_project ---

server.tool(
  "hubthe_set_project",
  "Set the active project by GUID. Required before listing tasks.",
  {
    project_guid: z.string().uuid().describe("Project GUID"),
  },
  async ({ project_guid }) => {
    try {
      await autoAuth();
      const project = await client.getProjectDetails(project_guid);
      client.setProject(project_guid);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                status: "project_set",
                project: {
                  guid: project.guid,
                  name: project.name,
                  slug: project.slug,
                  description: project.description,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// --- Tool: hubthe_list_my_tasks ---

server.tool(
  "hubthe_list_my_tasks",
  "List tasks assigned to the current user in the active project. Requires a selected project.",
  {
    top_level_only: z
      .boolean()
      .optional()
      .default(false)
      .describe("Return only top-level tasks (no subtasks)"),
    additional_fields: z
      .array(z.string())
      .optional()
      .describe("Additional custom field slugs to include in response"),
  },
  async ({ top_level_only, additional_fields }) => {
    try {
      await autoAuth();
      const tasks = await client.listMyTasks({
        topLevelOnly: top_level_only,
        additionalFields: additional_fields,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                project: client.currentProject,
                count: tasks.length,
                tasks,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// --- Tool: hubthe_list_sprints ---

server.tool(
  "hubthe_list_sprints",
  "List all sprints in the active project with task counts. Requires a selected project.",
  {},
  async () => {
    try {
      await autoAuth();
      const sprints = await client.listSprints();

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                project: client.currentProject,
                count: sprints.length,
                sprints,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// --- Tool: hubthe_list_sprint_tasks ---

server.tool(
  "hubthe_list_sprint_tasks",
  "List all tasks in a specific sprint by name. Requires a selected project.",
  {
    sprint_name: z
      .string()
      .describe("Sprint name (e.g. 'Спринт 10', 'Отложено')"),
    top_level_only: z
      .boolean()
      .optional()
      .default(false)
      .describe("Return only top-level tasks (no subtasks)"),
    additional_fields: z
      .array(z.string())
      .optional()
      .describe("Additional custom field slugs to include in response"),
  },
  async ({ sprint_name, top_level_only, additional_fields }) => {
    try {
      await autoAuth();
      const tasks = await client.listSprintTasks(sprint_name, {
        topLevelOnly: top_level_only,
        additionalFields: additional_fields,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                project: client.currentProject,
                sprint: sprint_name,
                count: tasks.length,
                tasks,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// --- Start server ---

async function startStdio() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startSSE() {
  const port = parseInt(process.env.PORT || "8080", 10);

  const transports = new Map<string, SSEServerTransport>();

  const httpServer = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    console.error(`[req] ${req.method} ${req.url}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const isSSEPath = req.url === "/sse" || req.url?.startsWith("/sse?")
      || req.url === "/mcp" || req.url?.startsWith("/mcp?");

    if (isSSEPath && req.method === "GET") {
      try { await server.close(); } catch {}
      const transport = new SSEServerTransport("/messages", res);
      transports.clear();
      transports.set(transport.sessionId, transport);
      res.on("close", () => transports.delete(transport.sessionId));
      await server.connect(transport);
      return;
    }

    if (req.url?.startsWith("/messages")) {
      const url = new URL(req.url, `http://localhost:${port}`);
      const sessionId = url.searchParams.get("sessionId");
      const transport = sessionId ? transports.get(sessionId) : undefined;
      if (transport) {
        await transport.handlePostMessage(req, res);
      } else {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid or missing sessionId" }));
      }
      return;
    }

    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", authenticated: client.isAuthenticated }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  httpServer.listen(port, "0.0.0.0", () => {
    console.error(`HubThe MCP server listening on http://0.0.0.0:${port}`);
    console.error(`  SSE endpoint:  /sse`);
    console.error(`  Health check:  /health`);
  });
}

const mode = process.argv.includes("--http") ? "http" : "stdio";

(mode === "http" ? startSSE() : startStdio()).catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
