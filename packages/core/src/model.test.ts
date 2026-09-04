import { describe, expect, it } from "vitest";
import { canonicalModelId } from "./model.js";

describe("canonicalModelId", () => {
  it("collapses the named suffixes so Cursor rows can meet OMP rows", () => {
    expect(canonicalModelId("claude-opus-5-thinking-high")).toBe("claude-opus-5");
    expect(canonicalModelId("cursor-grok-4.6-high-fast")).toBe("cursor-grok-4.6-high");
    expect(canonicalModelId("cursor-grok-4.5-high-fast")).toBe("cursor-grok-4.5-high");
    // Same canonical id from both sources — what the (source, model) table needs.
    expect(canonicalModelId("claude-opus-5-thinking-high")).toBe(canonicalModelId("claude-opus-5"));
  });

  it("leaves the rest of the observed Cursor set alone", () => {
    // Cursor-hosted: the prefix is never stripped, it may price differently.
    expect(canonicalModelId("cursor-grok-4.6-high")).toBe("cursor-grok-4.6-high");
    // `-medium` is not a named suffix — no invented stripping.
    expect(canonicalModelId("gpt-5.6-sol-medium")).toBe("gpt-5.6-sol-medium");
    // Auto: real tokens, no public rate. Stays `default`, never a real model.
    expect(canonicalModelId("default")).toBe("default");
  });

  it("passes OMP ids and unknown strings through unchanged", () => {
    expect(canonicalModelId("claude-opus-5")).toBe("claude-opus-5");
    expect(canonicalModelId("glm-5.3-flash")).toBe("glm-5.3-flash");
    expect(canonicalModelId("some-model-nobody-mapped")).toBe("some-model-nobody-mapped");
    expect(canonicalModelId("")).toBe("");
  });

  it("keeps a bare suffix verbatim rather than emptying it", () => {
    expect(canonicalModelId("-thinking-high")).toBe("-thinking-high");
    expect(canonicalModelId("-high-fast")).toBe("-high-fast");
  });

  it("is idempotent", () => {
    for (const raw of ["claude-opus-5-thinking-high", "cursor-grok-4.6-high-fast", "default"]) {
      const once = canonicalModelId(raw);
      expect(canonicalModelId(once)).toBe(once);
    }
  });
});
