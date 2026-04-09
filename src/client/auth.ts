import { execSync } from "child_process";
import { platform } from "os";

const KEYCHAIN_SERVICE = "hubthe-mcp";

function readKeychain(account: string): string | null {
  if (platform() !== "darwin") return null;
  try {
    return execSync(
      `security find-generic-password -s "${KEYCHAIN_SERVICE}" -a "${account}" -w`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
  } catch {
    return null;
  }
}

export function getCredentials(): {
  email: string;
  password: string;
} | null {
  const kcEmail = readKeychain("email");
  const kcPassword = readKeychain("password");
  if (kcEmail && kcPassword) return { email: kcEmail, password: kcPassword };

  const envEmail = process.env.HUBTHE_EMAIL;
  const envPassword = process.env.HUBTHE_PASSWORD;
  if (envEmail && envPassword) return { email: envEmail, password: envPassword };

  return null;
}
