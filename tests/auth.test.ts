import { describe, expect, it } from "vitest";
import {
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  passwordMatches,
  safeNextPath,
  verifySessionToken,
} from "@/lib/auth";

const SECRET = "correct horse battery staple";

describe("password check", () => {
  it("accepts the right password and rejects others", async () => {
    expect(await passwordMatches(SECRET, SECRET)).toBe(true);
    expect(await passwordMatches(SECRET, "wrong")).toBe(false);
    expect(await passwordMatches(SECRET, "")).toBe(false);
    expect(await passwordMatches(SECRET, SECRET + " ")).toBe(false);
  });

  it("rejects everything when no password is configured", async () => {
    expect(await passwordMatches("", "")).toBe(false);
    expect(await passwordMatches("", "anything")).toBe(false);
  });
});

describe("session tokens", () => {
  const now = 1_800_000_000_000;

  it("verifies a fresh token", async () => {
    const token = await createSessionToken(SECRET, now);
    expect(await verifySessionToken(SECRET, token, now + 1000)).toBe(true);
  });

  it("expires after the max age", async () => {
    const token = await createSessionToken(SECRET, now);
    const justBefore = now + SESSION_MAX_AGE_SECONDS * 1000 - 1;
    const justAfter = now + SESSION_MAX_AGE_SECONDS * 1000 + 1;
    expect(await verifySessionToken(SECRET, token, justBefore)).toBe(true);
    expect(await verifySessionToken(SECRET, token, justAfter)).toBe(false);
  });

  it("rejects a token signed with a different password (changing it signs everyone out)", async () => {
    const token = await createSessionToken(SECRET, now);
    expect(await verifySessionToken("another password", token, now)).toBe(false);
  });

  it("rejects tampered, malformed and missing tokens", async () => {
    const token = await createSessionToken(SECRET, now);
    const [expires, sig] = token.split(".");
    const extended = `${Number(expires) + 10_000_000}.${sig}`; // forged longer expiry
    expect(await verifySessionToken(SECRET, extended, now)).toBe(false);
    expect(await verifySessionToken(SECRET, `${expires}.${sig.slice(0, -2)}xx`, now)).toBe(false);
    expect(await verifySessionToken(SECRET, "garbage", now)).toBe(false);
    expect(await verifySessionToken(SECRET, `${expires}.`, now)).toBe(false);
    expect(await verifySessionToken(SECRET, "", now)).toBe(false);
    expect(await verifySessionToken(SECRET, undefined, now)).toBe(false);
  });

  it("is never valid without a configured secret", async () => {
    const token = await createSessionToken("", now).catch(() => "x.y");
    expect(await verifySessionToken("", token, now)).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("allows same-site paths only", () => {
    expect(safeNextPath("/rules")).toBe("/rules");
    expect(safeNextPath("/runs/abc?x=1")).toBe("/runs/abc?x=1");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath("")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });
});
