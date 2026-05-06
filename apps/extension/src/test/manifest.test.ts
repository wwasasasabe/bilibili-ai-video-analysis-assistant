import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const manifestSource = readFileSync(path.resolve(process.cwd(), "src/manifest.ts"), "utf8");

describe("extension manifest", () => {
  it("allows Bilibili Akamai audio mirrors used by DASH audio URLs", () => {
    expect(manifestSource).toContain('"https://*.akamaized.net/*"');
  });

  it("can observe real Bilibili media requests like cat-catch-style sniffing", () => {
    expect(manifestSource).toContain('"webRequest"');
  });
});
