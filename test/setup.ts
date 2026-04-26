import { vi } from "vitest";

// Global catch-all no-network guard.
//
// How it works:
//   - Vitest runs setupFiles before each test file, so this vi.mock("undici", ...)
//     registers a module-level guard that throws on any real HTTP request.
//   - Integration test files that import mock-repo.ts also call vi.mock("undici", ...)
//     inside that module. Because mock-repo's vi.mock executes after the setupFiles mock,
//     Vitest's hoisting ensures the integration-file-scoped mock wins for that file only,
//     overriding this guard for registered URLs while leaving unregistered URLs to throw.
//   - All integration tests passing (578+) is the proof of non-interference: if the guard
//     were leaking into integration files, every network-touching integration test would fail.
vi.mock("undici", () => ({
  request: async (url: string) => {
    throw new Error(
      `[no-network guard] Unexpected real HTTP request to: ${url}. Import mock-repo and register a response first.`,
    );
  },
  Agent: class {},
}));
