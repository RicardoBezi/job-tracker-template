import { describe, expect, it } from "vitest";
import { applicationPatch } from "../api/[...path].mjs";

describe("applicationPatch", () => {
  it("does not inject a default status into partial updates", () => {
    expect(applicationPatch.parse({ manual_override: false })).toEqual({ manual_override: false });
  });

  it("still validates an explicitly supplied status", () => {
    expect(applicationPatch.parse({ status: "next-phase" })).toEqual({ status: "next-phase" });
    expect(applicationPatch.safeParse({ status: "unknown" }).success).toBe(false);
  });
});
