import { readFile, stat } from "node:fs/promises";
import type { RepoCredentials } from "../repos/index.js";
import { CredentialsFileSchema } from "./schema.js";
import { parseConfig } from "../util/error.js";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function resolveEnvVar(value: string, fieldName: string): string {
  if (!value.startsWith("$")) return value;
  const envVarName = value.slice(1);
  const resolved = process.env[envVarName];
  if (resolved === undefined) {
    throw new ConfigError(`Env var ${envVarName} (for ${fieldName}) is not set`);
  }
  return resolved;
}

export async function loadCredentials(
  filePath: string,
): Promise<Map<string, RepoCredentials>> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw err;
  }

  if (process.platform !== "win32") {
    const fileStat = await stat(filePath);
    const fileMode = fileStat.mode & 0o777;
    if (fileMode !== 0o600) {
      process.stderr.write(
        `Warning: ${filePath} should have mode 0600 (currently ${fileMode.toString(8)})\n`,
      );
    }
  }

  const parsed = JSON.parse(text) as unknown;
  const validated = parseConfig(CredentialsFileSchema, parsed);

  const result = new Map<string, RepoCredentials>();
  for (const entry of validated.repositories) {
    const { url } = entry;
    if ("token" in entry) {
      result.set(url, { token: resolveEnvVar(entry.token, "token") });
    } else {
      result.set(url, {
        username: resolveEnvVar(entry.username, "username"),
        password: resolveEnvVar(entry.password, "password"),
      });
    }
  }
  return result;
}
