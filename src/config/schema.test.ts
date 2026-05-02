import { describe, expect, it } from "vitest";
import {
  CredentialEntrySchema,
  CredentialsFileSchema,
  ProjectConfigSchema,
  UserConfigSchema,
} from "./schema.js";

describe("ProjectConfigSchema", () => {
  it("parses a valid full config object", () => {
    const input = {
      target: "minor",
      pre: false,
      cooldown: 7,
      allowDowngrade: false,
      include: ["com.example:*"],
      exclude: ["org.test:lib"],
    };
    const result = ProjectConfigSchema.parse(input);
    expect(result).toEqual(input);
  });

  it("parses an empty object (all fields optional)", () => {
    const result = ProjectConfigSchema.parse({});
    expect(result).toEqual({});
  });

  it("rejects an unknown key (strict enforcement)", () => {
    expect(() => ProjectConfigSchema.parse({ unknownKey: "value" })).toThrow();
  });

  it("rejects cacheDir (user-level only)", () => {
    expect(() => ProjectConfigSchema.parse({ cacheDir: "/tmp/x" })).toThrow();
  });

  it("rejects noCache (user-level only)", () => {
    expect(() => ProjectConfigSchema.parse({ noCache: true })).toThrow();
  });

  it("rejects a non-enum target value", () => {
    expect(() => ProjectConfigSchema.parse({ target: "latest" })).toThrow();
  });

  it("rejects a negative cooldown", () => {
    expect(() => ProjectConfigSchema.parse({ cooldown: -1 })).toThrow();
  });

  it("rejects a non-integer cooldown", () => {
    expect(() => ProjectConfigSchema.parse({ cooldown: 1.5 })).toThrow();
  });

  it("accepts each valid target enum value", () => {
    for (const target of ["major", "minor", "patch"] as const) {
      expect(() => ProjectConfigSchema.parse({ target })).not.toThrow();
    }
  });
});

describe("UserConfigSchema", () => {
  it("parses a valid full config object including user-only fields", () => {
    const input = {
      target: "minor",
      pre: false,
      cooldown: 7,
      allowDowngrade: false,
      include: ["com.example:*"],
      exclude: ["org.test:lib"],
      cacheDir: "/tmp/gcu-cache",
      noCache: false,
    };
    const result = UserConfigSchema.parse(input);
    expect(result).toEqual(input);
  });

  it("parses an empty object (all fields optional)", () => {
    expect(UserConfigSchema.parse({})).toEqual({});
  });

  it("accepts cacheDir on its own", () => {
    expect(UserConfigSchema.parse({ cacheDir: "/x" })).toEqual({ cacheDir: "/x" });
  });

  it("accepts noCache on its own", () => {
    expect(UserConfigSchema.parse({ noCache: true })).toEqual({ noCache: true });
  });

  it("accepts every project field for parity", () => {
    const input = {
      target: "patch" as const,
      pre: true,
      cooldown: 0,
      allowDowngrade: true,
      include: [],
      exclude: [],
    };
    expect(UserConfigSchema.parse(input)).toEqual(input);
  });

  it("rejects an unknown key (strict enforcement)", () => {
    expect(() => UserConfigSchema.parse({ unknownKey: "value" })).toThrow();
  });

  it("rejects a non-string cacheDir", () => {
    expect(() => UserConfigSchema.parse({ cacheDir: 123 })).toThrow();
  });
});

describe("CredentialEntrySchema", () => {
  it("accepts username + password credentials with a url", () => {
    const result = CredentialEntrySchema.parse({
      url: "https://nexus.example.com/",
      username: "alice",
      password: "secret123",
    });
    expect(result).toEqual({
      url: "https://nexus.example.com/",
      username: "alice",
      password: "secret123",
    });
  });

  it("accepts token credentials with a url", () => {
    const result = CredentialEntrySchema.parse({
      url: "https://nexus.example.com/",
      token: "mytoken123",
    });
    expect(result).toEqual({ url: "https://nexus.example.com/", token: "mytoken123" });
  });

  it("rejects combined username+password and token (both auth modes)", () => {
    expect(() =>
      CredentialEntrySchema.parse({
        url: "https://nexus.example.com/",
        username: "alice",
        password: "secret",
        token: "tok",
      }),
    ).toThrow();
  });

  it("rejects a non-URL value for url", () => {
    expect(() =>
      CredentialEntrySchema.parse({ url: "not-a-url", token: "tok" }),
    ).toThrow();
  });

  it("rejects empty username", () => {
    expect(() =>
      CredentialEntrySchema.parse({
        url: "https://nexus.example.com/",
        username: "",
        password: "secret",
      }),
    ).toThrow();
  });

  it("rejects empty password", () => {
    expect(() =>
      CredentialEntrySchema.parse({
        url: "https://nexus.example.com/",
        username: "alice",
        password: "",
      }),
    ).toThrow();
  });

  it("rejects empty token", () => {
    expect(() =>
      CredentialEntrySchema.parse({ url: "https://nexus.example.com/", token: "" }),
    ).toThrow();
  });

  it("rejects missing password when username is present", () => {
    expect(() =>
      CredentialEntrySchema.parse({
        url: "https://nexus.example.com/",
        username: "alice",
      }),
    ).toThrow();
  });

  it("rejects object with no auth fields", () => {
    expect(() =>
      CredentialEntrySchema.parse({ url: "https://nexus.example.com/" }),
    ).toThrow();
  });

  it("rejects missing url field", () => {
    expect(() => CredentialEntrySchema.parse({ token: "mytoken123" })).toThrow();
  });
});

describe("CredentialsFileSchema", () => {
  it("parses a valid repositories array", () => {
    const input = {
      repositories: [
        { url: "https://nexus.example.com/", username: "alice", password: "pass1" },
        { url: "https://artifactory.example.com/", token: "tok123" },
      ],
    };
    const result = CredentialsFileSchema.parse(input);
    expect(result).toEqual(input);
  });

  it("parses an empty repositories array", () => {
    const result = CredentialsFileSchema.parse({ repositories: [] });
    expect(result).toEqual({ repositories: [] });
  });

  it("rejects missing repositories key", () => {
    expect(() => CredentialsFileSchema.parse({})).toThrow();
  });

  it("rejects old flat object format", () => {
    expect(() =>
      CredentialsFileSchema.parse({ "https://nexus.example.com/": { token: "abc" } }),
    ).toThrow();
  });

  it("rejects an invalid entry within repositories", () => {
    expect(() =>
      CredentialsFileSchema.parse({
        repositories: [
          {
            url: "https://repo.example.com/",
            username: "alice",
            password: "pass",
            token: "extra",
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects repositories that is not an array", () => {
    expect(() =>
      CredentialsFileSchema.parse({
        repositories: { "https://nexus.example.com/": { token: "tok" } },
      }),
    ).toThrow();
  });
});
