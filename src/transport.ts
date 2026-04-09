import { randomUUID } from "crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { server, client } from "./server.js";

async function startStdio() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startHTTP() {
  const port = parseInt(process.env.PORT || "8080", 10);

  const transports = new Map<string, StreamableHTTPServerTransport>();

  async function handleMcp(req: IncomingMessage, res: ServerResponse) {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && transports.has(sessionId)) {
      await transports.get(sessionId)!.handleRequest(req, res);
      return;
    }

    if (req.method === "GET" || req.method === "DELETE") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Invalid or missing session ID" },
        id: null,
      }));
      return;
    }

    for (const [sid, old] of transports) {
      try { await old.close(); } catch {}
      transports.delete(sid);
    }
    try { await server.close(); } catch {}

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        transports.set(sid, transport);
      },
    });

    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) transports.delete(sid);
    };

    await server.connect(transport);
    await transport.handleRequest(req, res);
  }

  const httpServer = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, DELETE, OPTIONS",
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, mcp-session-id, Last-Event-ID",
    );
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const path = req.url?.split("?")[0];

    try {
      if (path === "/mcp" || path === "/sse") {
        await handleMcp(req, res);
        return;
      }

      if (path === "/health" || path === "/readyz") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            authenticated: client.isAuthenticated,
          }),
        );
        return;
      }

      if (path === "/") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            name: "hubthe-mcp",
            version: "1.0.0",
            transport: "streamable-http",
            mcp: "/mcp",
          }),
        );
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    } catch (error) {
      console.error("Request error:", error);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          }),
        );
      }
    }
  });

  httpServer.listen(port, "0.0.0.0", () => {
    console.error(
      `HubThe MCP server listening on http://0.0.0.0:${port}`,
    );
    console.error(`  MCP endpoint:  POST/GET/DELETE /mcp`);
    console.error(`  Health probe:  GET /health`);
    console.error(`  Status:        GET /`);
  });
}

export function startTransport(): Promise<void> {
  const mode = process.argv.some(
    (arg) => arg === "--http" || arg === "--sse",
  )
    ? "http"
    : "stdio";

  return mode === "http" ? startHTTP() : startStdio();
}
