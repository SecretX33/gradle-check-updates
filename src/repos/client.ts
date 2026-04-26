import { request } from "undici";
import { Cache } from "./cache.js";
import { gavToMetadataPath, parseMavenMetadata, type MavenMetadata } from "./metadata.js";

export type RepoCredentials = { username: string; password: string } | { token: string };

export type ClientOptions = {
  cache: Cache;
  credentials?: Map<string, RepoCredentials>;
  noCache?: boolean;
  metadataTtlMs?: number;
  verbose?: boolean;
  stderr?: NodeJS.WritableStream;
};

export class RepoNetworkError extends Error {
  constructor(
    message: string,
    readonly url: string,
  ) {
    super(message);
    this.name = "RepoNetworkError";
  }
}

function pickCredentials(
  repoUrl: string,
  credentials?: Map<string, RepoCredentials>,
): RepoCredentials | undefined {
  if (!credentials) return undefined;
  let bestMatch: { prefixLength: number; credentials: RepoCredentials } | undefined;
  for (const [prefix, credential] of credentials) {
    if (
      repoUrl.startsWith(prefix) &&
      (!bestMatch || prefix.length > bestMatch.prefixLength)
    ) {
      bestMatch = { prefixLength: prefix.length, credentials: credential };
    }
  }
  return bestMatch?.credentials;
}

function buildAuthHeader(
  credentials: RepoCredentials | undefined,
): Record<string, string> {
  if (!credentials) return {};
  if ("token" in credentials) {
    return { authorization: `Bearer ${credentials.token}` };
  }
  const encoded = Buffer.from(`${credentials.username}:${credentials.password}`).toString(
    "base64",
  );
  return { authorization: `Basic ${encoded}` };
}

export async function fetchMetadata(
  repoUrl: string,
  group: string,
  artifact: string,
  options: ClientOptions,
): Promise<MavenMetadata> {
  const ttl = options.metadataTtlMs ?? 60 * 60 * 1000;
  const metadataUrl = repoUrl.replace(/\/?$/, "/") + gavToMetadataPath(group, artifact);

  if (!options.noCache) {
    const cached = await options.cache.get(metadataUrl, ttl);
    if (cached !== undefined) return parseMavenMetadata(cached);
  }

  if (options.verbose) options.stderr?.write(`GET ${metadataUrl}\n`);

  const authHeaders = buildAuthHeader(pickCredentials(repoUrl, options.credentials));
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await request(metadataUrl, { headers: authHeaders });
      if (response.statusCode === 404) return { versions: [] };
      if (response.statusCode >= 400) {
        options.stderr?.write(
          `gcu: warning: HTTP ${response.statusCode} from ${metadataUrl}\n`,
        );
        if (options.verbose) {
          const responseBody = await response.body.text();
          options.stderr?.write(`${responseBody}\n`);
        }
        throw new RepoNetworkError(`HTTP ${response.statusCode}`, metadataUrl);
      }
      const body = await response.body.text();
      if (!options.noCache) await options.cache.set(metadataUrl, body);
      return parseMavenMetadata(body);
    } catch (err) {
      lastError = err;
      if (err instanceof RepoNetworkError) throw err;
      await new Promise<void>((resolve) =>
        setTimeout(resolve, 100 * Math.pow(4, attempt)),
      );
    }
  }

  throw new RepoNetworkError(
    `Failed after retries: ${(lastError as Error)?.message}`,
    metadataUrl,
  );
}

export async function fetchVersionTimestamp(
  repoUrl: string,
  group: string,
  artifact: string,
  version: string,
  options: ClientOptions,
): Promise<string | undefined> {
  const groupPath = group.replace(/\./g, "/");
  const pomUrl = `${repoUrl.replace(/\/?$/, "/")}${groupPath}/${artifact}/${version}/${artifact}-${version}.pom`;
  const cacheKey = `timestamp:${pomUrl}`;

  const cached = options.noCache
    ? undefined
    : await options.cache.get(cacheKey, Infinity);
  if (cached !== undefined) return cached;

  const authHeaders = buildAuthHeader(pickCredentials(repoUrl, options.credentials));
  if (options.verbose) options.stderr?.write(`HEAD ${pomUrl}\n`);
  try {
    const response = await request(pomUrl, { method: "HEAD", headers: authHeaders });
    const lastModified = (response.headers as Record<string, string>)["last-modified"];
    if (lastModified) {
      const date = new Date(lastModified);
      if (!isNaN(date.getTime())) {
        const isoDate = date.toISOString();
        if (!options.noCache) await options.cache.set(cacheKey, isoDate);
        return isoDate;
      }
    }
  } catch (error) {
    if (options.verbose)
      options.stderr?.write(
        `fetchVersionTimestamp failed for ${pomUrl}: ${(error as Error)?.message ?? error}\n`,
      );
  }
  return undefined;
}
