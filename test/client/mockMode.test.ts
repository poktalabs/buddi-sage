import { describe, expect, it } from "vitest";
import { mockRequested } from "../../src/client/mockMode";

describe("mock mode", () => {
  it("needs ?mock=1 on a loopback host", () => {
    expect(mockRequested("?mock=1", "localhost")).toBe(true);
    expect(mockRequested("?x=2&mock=1", "127.0.0.1")).toBe(true);
  });
  it("is off without the flag", () => {
    expect(mockRequested("", "localhost")).toBe(false);
    expect(mockRequested("?mock=0", "localhost")).toBe(false);
    expect(mockRequested("?mock=true", "localhost")).toBe(false);
  });
  it("is unreachable on a production host even with the flag", () => {
    expect(mockRequested("?mock=1", "buddi-sage.example.workers.dev")).toBe(false);
    expect(mockRequested("?mock=1", "localhost.evil.com")).toBe(false);
  });
});
