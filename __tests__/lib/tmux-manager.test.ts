import { describe, it, expect } from "vitest";
import { getSessionName } from "@/lib/tmux-manager";

describe("getSessionName", () => {
  it("creates session name with mc- prefix", () => {
    expect(getSessionName("myteam", "leader")).toBe("mc-myteam-leader");
  });

  it("handles multi-word names with dashes", () => {
    expect(getSessionName("my-team", "frontend-dev")).toBe(
      "mc-my-team-frontend-dev"
    );
  });

  it("handles single-char names", () => {
    expect(getSessionName("a", "b")).toBe("mc-a-b");
  });
});
