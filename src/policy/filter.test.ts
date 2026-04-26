import { describe, it, expect } from "vitest";
import { includeExcludeFilter } from "./filter.js";

describe("includeExcludeFilter", () => {
  it("no includes, no excludes → passes", () => {
    expect(includeExcludeFilter("org.foo:bar", [], [])).toBe(true);
  });

  it("exact include match → passes", () => {
    expect(includeExcludeFilter("org.foo:bar", ["org.foo:bar"], [])).toBe(true);
  });

  it("exact include non-match → blocked", () => {
    expect(includeExcludeFilter("org.foo:bar", ["org.foo:baz"], [])).toBe(false);
  });

  it("glob include org.foo:* → matches org.foo:bar, not org.bar:foo", () => {
    expect(includeExcludeFilter("org.foo:bar", ["org.foo:*"], [])).toBe(true);
    expect(includeExcludeFilter("org.bar:foo", ["org.foo:*"], [])).toBe(false);
  });

  it("glob include *:bar → matches org.foo:bar and org.bar:bar", () => {
    expect(includeExcludeFilter("org.foo:bar", ["*:bar"], [])).toBe(true);
    expect(includeExcludeFilter("org.foo:baz", ["*:bar"], [])).toBe(false);
  });

  it("/regex/ include /(foo|bar):baz/ → works correctly", () => {
    expect(includeExcludeFilter("foo:baz", ["/( foo|bar):baz/"], [])).toBe(false);
    expect(includeExcludeFilter("foo:baz", ["/(foo|bar):baz/"], [])).toBe(true);
    expect(includeExcludeFilter("bar:baz", ["/(foo|bar):baz/"], [])).toBe(true);
    expect(includeExcludeFilter("qux:baz", ["/(foo|bar):baz/"], [])).toBe(false);
  });

  it("exact exclude blocks matching dep", () => {
    expect(includeExcludeFilter("org.foo:bar", [], ["org.foo:bar"])).toBe(false);
    expect(includeExcludeFilter("org.foo:baz", [], ["org.foo:bar"])).toBe(true);
  });

  it("exclude glob *.internal:* → blocks matching", () => {
    expect(includeExcludeFilter("com.internal:widget", [], ["*.internal:*"])).toBe(false);
    expect(
      includeExcludeFilter("com.example.internal:widget", [], ["*.internal:*"]),
    ).toBe(false);
    expect(includeExcludeFilter("com.example:widget", [], ["*.internal:*"])).toBe(true);
  });

  it("include matches but exclude also matches → blocked", () => {
    expect(includeExcludeFilter("org.foo:bar", ["org.foo:*"], ["org.foo:bar"])).toBe(
      false,
    );
  });

  it("empty include list with exclude → only exclude applies", () => {
    expect(includeExcludeFilter("org.foo:bar", [], ["org.foo:bar"])).toBe(false);
    expect(includeExcludeFilter("org.foo:baz", [], ["org.foo:bar"])).toBe(true);
  });

  it("multiple includes with OR logic → passes if any match", () => {
    expect(includeExcludeFilter("org.foo:bar", ["org.foo:bar", "org.baz:qux"], [])).toBe(
      true,
    );
    expect(includeExcludeFilter("org.baz:qux", ["org.foo:bar", "org.baz:qux"], [])).toBe(
      true,
    );
    expect(
      includeExcludeFilter("org.other:thing", ["org.foo:bar", "org.baz:qux"], []),
    ).toBe(false);
  });

  it("/regex/ exclude blocks matching dep", () => {
    expect(includeExcludeFilter("org.foo:bar", [], ["/org\\.foo:.*/"])).toBe(false);
    expect(includeExcludeFilter("org.bar:baz", [], ["/org\\.foo:.*/"])).toBe(true);
  });

  it("/foo/ does not match org.foo:bar (no substring matching)", () => {
    expect(includeExcludeFilter("org.foo:bar", ["/foo/"], [])).toBe(false);
  });

  it("/foo/ matches foo exactly", () => {
    expect(includeExcludeFilter("foo", ["/foo/"], [])).toBe(true);
  });

  it("/org\\..*:.*bar/ matches org.acme:foobar", () => {
    expect(includeExcludeFilter("org.acme:foobar", ["/org\\..*:.*bar/"], [])).toBe(true);
  });

  it("/foo|bar/ matches foo and bar but not foobaz", () => {
    expect(includeExcludeFilter("foo", ["/foo|bar/"], [])).toBe(true);
    expect(includeExcludeFilter("bar", ["/foo|bar/"], [])).toBe(true);
    expect(includeExcludeFilter("foobaz", ["/foo|bar/"], [])).toBe(false);
  });
});
