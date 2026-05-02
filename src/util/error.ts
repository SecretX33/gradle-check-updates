import type { ZodError, ZodType } from "zod";
import { ConfigError } from "../config/index.js";

/**
 * Formats a ZodError into a human-readable string.
 * Avoids raw JSON output.
 */
export function formatZodError(error: ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? ` at "${issue.path.join(".")}"` : "";
    return `${issue.message}${path}`;
  });

  if (issues.length === 1) {
    return issues[0]!;
  }

  return "\n" + issues.map((i) => ` - ${i}`).join("\n");
}

/**
 * Parses data using a Zod schema. If parsing fails, throws a ConfigError
 * with a human-readable message.
 */
export function parseConfig<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ConfigError(formatZodError(result.error));
  }
  return result.data;
}

/**
 * Returns a human-readable message from an Error, specially handling ZodErrors.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "ZodError") {
      return formatZodError(error as ZodError);
    }
    return error.message;
  }
  return String(error);
}
