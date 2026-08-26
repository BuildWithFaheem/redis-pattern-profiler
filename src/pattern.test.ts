import { keyToPattern } from "./pattern";

describe("keyToPattern", () => {
  it("strips UUID segment → {id}", () => {
    expect(keyToPattern("session:a1b2c3d4-e5f6-7890-abcd-ef1234567890:data")).toBe(
      "session:{id}:data"
    );
  });

  it("strips pure-numeric segment → {n}", () => {
    expect(keyToPattern("user:42:profile")).toBe("user:{n}:profile");
  });

  it("strips short hex segment ≥8 chars → {hex}", () => {
    expect(keyToPattern("session:a1b2c3d4:data")).toBe("session:{hex}:data");
  });

  it("preserves nested path structure with no strippable segments", () => {
    expect(keyToPattern("config:global:settings")).toBe("config:global:settings");
  });

  it("handles multiple replacements in one key", () => {
    expect(keyToPattern("user:99:token:deadbeef")).toBe("user:{n}:token:{hex}");
  });

  it("returns key unchanged when nothing to strip", () => {
    expect(keyToPattern("health:check")).toBe("health:check");
  });
});
