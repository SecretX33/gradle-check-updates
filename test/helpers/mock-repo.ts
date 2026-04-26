import { vi } from "vitest";

export type MockResponse = {
  status: number;
  body: string;
  headers?: Record<string, string>;
};

const responses = new Map<string, MockResponse>();
let lastRequestOptions: Record<string, unknown> = {};

export function mockRepo(map: Record<string, string | MockResponse>): void {
  responses.clear();
  for (const [url, value] of Object.entries(map)) {
    responses.set(url, typeof value === "string" ? { status: 200, body: value } : value);
  }
}

export function getLastRequestOptions(): Record<string, unknown> {
  return lastRequestOptions;
}

vi.mock("undici", () => ({
  request: async (url: string, options?: Record<string, unknown>) => {
    lastRequestOptions = options ?? {};
    const mockResponse = responses.get(url);
    if (!mockResponse) throw new Error(`mock-repo: unexpected request to ${url}`);
    return {
      statusCode: mockResponse.status,
      headers: mockResponse.headers ?? {},
      body: { text: async () => mockResponse.body },
    };
  },
  Agent: class {},
}));
