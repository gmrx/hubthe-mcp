import { randomUUID } from "crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { server, client } from "./server.js";

async function startStdio() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startHTTP() {
  const port = parseInt(process.env.PORT || "8080", 10);

  const transports = new Map<string, StreamableHTTPServerTransport>();

  function collectBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        try {
          const raw = Buffer.concat(chunks).toString("utf-8");
          resolve(raw ? JSON.parse(raw) : undefined);
        } catch (err) {
          reject(err);
        }
      });
      req.on("error", reject);
    });
  }

  async function handleMcpPost(req: IncomingMessage, res: ServerResponse) {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const body = await collectBody(req);

    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res, body);
      return;
    }

    if (!sessionId && isInitializeRequest(body)) {
      for (const [sid, old] of transports) {
        try {
          await old.close();
        } catch {}
        transports.delete(sid);
      }
      try {
        await server.close();
      } catch {}

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
      await transport.handleRequest(req, res, body);
      return;
    }

    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      }),
    );
  }

  async function handleMcpGet(req: IncomingMessage, res: ServerResponse) {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: "Invalid or missing session ID" }),
      );
      return;
    }
    await transports.get(sessionId)!.handleRequest(req, res);
  }

  async function handleMcpDelete(
    req: IncomingMessage,
    res: ServerResponse,
  ) {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: "Invalid or missing session ID" }),
      );
      return;
    }
    const transport = transports.get(sessionId)!;
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
    res.setHeader(
      "Access-Control-Expose-Headers",
      "mcp-session-id",
    );

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const path = req.url?.split("?")[0];

    try {
      if (path === "/mcp" || path === "/sse") {
        if (req.method === "POST") {
          await handleMcpPost(req, res);
        } else if (req.method === "GET") {
          await handleMcpGet(req, res);
        } else if (req.method === "DELETE") {
          await handleMcpDelete(req, res);
        } else {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method not allowed" }));
        }
        return;
      }

      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            authenticated: client.isAuthenticated,
          }),
        );
        return;
      }

      if (req.url === "/") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            name: "hubthe-mcp",
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
    console.error(`  MCP endpoint:  /mcp (Streamable HTTP)`);
    console.error(`  Health check:  /health`);
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
