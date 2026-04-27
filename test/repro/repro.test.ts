import { describe, it, expect } from "vitest";
import { locateKotlin } from "../../src/formats/kotlin-dsl/locate.js";

describe("repro variations", () => {
  it("platform with interpolated version", () => {
    const src = `dependencies {\n    implementation(platform("tools.jackson:jackson-bom:$jacksonVersion"))\n}\n`;
    const out = locateKotlin("build.gradle.kts", src);
    console.log("interp:", JSON.stringify(out));
    expect(out.length).toBe(1);
  });
  it("platform with trailing config block", () => {
    const src = `implementation(platform("g:a:1.0")) { exclude(group = "x") }`;
    const out = locateKotlin("build.gradle.kts", src);
    console.log("trailing:", JSON.stringify(out));
    expect(out.length).toBe(1);
  });
  it("platform with named arg/comment in middle", () => {
    const src = `implementation(platform("g:a:1.0"));`;
    const out = locateKotlin("build.gradle.kts", src);
    console.log("semicolon:", JSON.stringify(out));
    expect(out.length).toBe(1);
  });
  it("platform inside dependencies block trailing comma/newline", () => {
    const src = `dependencies {\r\n    implementation(platform("tools.jackson:jackson-bom:3.0.0"))\r\n    api("foo:bar:2.0.0")\r\n}\r\n`;
    const out = locateKotlin("build.gradle.kts", src);
    console.log("crlf:", JSON.stringify(out));
    expect(out.length).toBe(2);
  });
});
