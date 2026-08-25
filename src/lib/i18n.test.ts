import { describe, expect, it } from "vitest";
import { DICTS, noteText } from "./i18n";

describe("i18n", () => {
  it("zh and en expose exactly the same keys (no dangling copy)", () => {
    expect(Object.keys(DICTS.en).sort()).toEqual(Object.keys(DICTS.zh).sort());
  });

  it("every note kind renders non-empty text in both languages", () => {
    const notes = [
      { kind: "xshell_key_missing", keyName: "node01" },
      { kind: "password" },
      { kind: "bastion_synthesized" },
    ] as const;
    for (const note of notes) {
      expect(noteText("zh", note)).toBeTruthy();
      expect(noteText("en", note)).toBeTruthy();
      expect(noteText("zh", note)).not.toBe(noteText("en", note));
    }
    expect(noteText("zh", { kind: "xshell_key_missing", keyName: "k1" })).toContain("k1");
    expect(noteText("en", { kind: "xshell_key_missing", keyName: "k1" })).toContain("k1");
  });
});
