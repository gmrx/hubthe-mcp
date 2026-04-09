import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { HubTheClient } from "./client/api.js";
import { getCredentials } from "./client/auth.js";

export const client = new HubTheClient(process.env.HUBTHE_URL);

let authPromise: Promise<void> | null = null;

export function autoAuth(): Promise<void> {
  if (client.isAuthenticated) return Promise.resolve();

  if (authPromise) return authPromise;

  const creds = getCredentials();

  if (!creds) {
    return Promise.reject(
      new Error(
        "No credentials found. Either run ./setup.sh (macOS) " +
          "or set HUBTHE_EMAIL and HUBTHE_PASSWORD environment variables.",
      ),
    );
  }

  const pendingAuth = client
    .auth(creds.email, creds.password)
    .then(() => {});
  authPromise = pendingAuth.finally(() => {
    authPromise = null;
  });
  return authPromise;
}

export const server = new McpServer({
  name: "hubthe",
  version: "1.0.0",
});
