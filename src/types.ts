// src/types.ts

export type FileType = "groovy-dsl" | "kotlin-dsl" | "version-catalog" | "properties";

export type VersionShape =
  | "exact"
  | "prerelease"
  | "snapshot"
  | "prefix"
  | "latestQualifier"
  | "strictlyShorthand"
  | "strictlyPreferShort"
  | "mavenRange"
  | "richRequire"
  | "richStrictly"
  | "richPrefer"
  | "richReject";

export type Occurrence = {
  group: string;
  artifact: string;
  file: string;
  byteStart: number;
  byteEnd: number;
  fileType: FileType;
  currentRaw: string;
  shape: VersionShape;
  dependencyKey: string;
  via?: string[];
};

export type Edit = {
  byteStart: number;
  byteEnd: number;
  replacement: string;
};

export type Direction = "up" | "down";

export type DecisionStatus =
  | "upgrade"
  | "no-change"
  | "held-by-target"
  | "cooldown-blocked"
  | "report-only"
  | "conflict";

export type Decision = {
  occurrence: Occurrence;
  status: DecisionStatus;
  /** Selected version literal that will be written, when status === "upgrade". */
  newVersion?: string;
  /** Latest available version on the server (post never-downgrade filter), regardless of status. */
  latestAvailable?: string;
  direction?: Direction;
  reason?: string;
  /** Human-readable warning message (e.g. shared-var consumer disagreement). Surfaced by the CLI layer. */
  warning?: string;
};
