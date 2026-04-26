import { describe, expect, it } from "vitest";
import { gavToMetadataPath, parseMavenMetadata } from "./metadata.js";

const FULL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter</artifactId>
  <versioning>
    <release>3.2.0</release>
    <versions>
      <version>2.7.0</version>
      <version>3.0.0</version>
      <version>3.1.0</version>
      <version>3.2.0</version>
    </versions>
    <lastUpdated>20240101120000</lastUpdated>
  </versioning>
</metadata>`;

const SINGLE_VERSION_XML = `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
  <groupId>com.example</groupId>
  <artifactId>my-lib</artifactId>
  <versioning>
    <versions>
      <version>1.0.0</version>
    </versions>
    <lastUpdated>20230601000000</lastUpdated>
  </versioning>
</metadata>`;

const NO_VERSIONING_XML = `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
  <groupId>com.example</groupId>
  <artifactId>bare-artifact</artifactId>
</metadata>`;

describe("parseMavenMetadata", () => {
  it("extracts versions array and lastUpdated from full XML", () => {
    const result = parseMavenMetadata(FULL_XML);
    expect(result.versions).toEqual(["2.7.0", "3.0.0", "3.1.0", "3.2.0"]);
    expect(result.lastUpdated).toBe("20240101120000");
  });

  it("handles single version entry (not wrapped in array by fast-xml-parser)", () => {
    const result = parseMavenMetadata(SINGLE_VERSION_XML);
    expect(result.versions).toEqual(["1.0.0"]);
    expect(result.lastUpdated).toBe("20230601000000");
  });

  it("returns empty versions when <versioning> block is missing", () => {
    const result = parseMavenMetadata(NO_VERSIONING_XML);
    expect(result.versions).toEqual([]);
    expect(result.lastUpdated).toBeUndefined();
  });

  it("returns empty versions for empty string input", () => {
    const result = parseMavenMetadata("");
    expect(result.versions).toEqual([]);
    expect(result.lastUpdated).toBeUndefined();
  });
});

describe("gavToMetadataPath", () => {
  it("converts group with three parts correctly", () => {
    const result = gavToMetadataPath("org.foo.bar", "lib");
    expect(result).toBe("org/foo/bar/lib/maven-metadata.xml");
  });

  it("converts group with two parts and hyphenated artifact", () => {
    const result = gavToMetadataPath("com.example", "my-lib");
    expect(result).toBe("com/example/my-lib/maven-metadata.xml");
  });

  it("handles single-segment group", () => {
    const result = gavToMetadataPath("junit", "junit");
    expect(result).toBe("junit/junit/maven-metadata.xml");
  });
});
