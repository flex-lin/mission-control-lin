import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes", () => {
    expect(cn("base", false && "hidden", "visible")).toBe("base visible");
  });

  it("deduplicates tailwind classes", () => {
    // tailwind-merge should resolve conflicting utility classes
    const result = cn("px-4", "px-6");
    expect(result).toBe("px-6");
  });

  it("handles undefined and null inputs", () => {
    expect(cn("base", undefined, null, "extra")).toBe("base extra");
  });

  it("handles empty inputs", () => {
    expect(cn()).toBe("");
  });
});
