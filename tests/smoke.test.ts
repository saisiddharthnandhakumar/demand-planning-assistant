import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("setup smoke test", () => {
  it("runs under vitest with the @ alias", () => {
    expect(cn("a", "b")).toBe("a b");
  });
});
