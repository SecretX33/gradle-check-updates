import { XMLParser } from "fast-xml-parser";

const xmlParser = new XMLParser({ ignoreAttributes: true, parseTagValue: false });

export type MavenMetadata = {
  versions: string[];
  lastUpdated?: string;
};

export function parseMavenMetadata(xml: string): MavenMetadata {
  if (!xml.trim()) return { versions: [] };
  const parsed = xmlParser.parse(xml) as Record<string, unknown>;
  const metadata = parsed?.metadata as Record<string, unknown> | undefined;
  const versioning = metadata?.versioning as Record<string, unknown> | undefined;
  if (!versioning) return { versions: [] };
  const versionContainer = versioning.versions as Record<string, unknown> | undefined;
  let rawVersions = versionContainer?.version;
  if (rawVersions === undefined || rawVersions === null) rawVersions = [];
  if (!Array.isArray(rawVersions)) rawVersions = [rawVersions];
  return {
    versions: (rawVersions as unknown[]).map(String),
    lastUpdated:
      versioning.lastUpdated !== undefined ? String(versioning.lastUpdated) : undefined,
  };
}

export function gavToMetadataPath(group: string, artifact: string): string {
  const groupPath = group.replace(/\./g, "/");
  return `${groupPath}/${artifact}/maven-metadata.xml`;
}
