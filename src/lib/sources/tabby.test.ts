import { describe, expect, it } from "vitest";
import { buildRsshImport } from "../rssh";
import { entryKey, type MigEntry } from "../types";
import { parseTabby } from "./tabby";

const fixture = (jump: string) => `
profiles:
  - { id: "ssh:gateway:a", name: "Gate, west", type: ssh, options: { host: a.invalid, user: alice } }
  - { id: "ssh:gateway:b", name: "Gate, west", type: ssh, options: { host: b.invalid, user: bob, port: 2222 } }
  - { id: "ssh:target", name: Target, type: ssh, options: { host: target.invalid, user: test, jumpHost: "${jump}" } }
`;

function exportRows(entries: MigEntry[], picked = entries) {
  return buildRsshImport({
    entries, selected: picked.map(entryKey), keyMap: new Map(), defaultUser: "",
  });
}

describe("Tabby profile identity", () => {
  it("preserves both same-name profiles and links the target by exact ID", () => {
    const entries = parseTabby(fixture("ssh:gateway:b"));
    expect(entries.map((e) => e.alias)).toEqual(["Gate, west", "Gate, west", "Target"]);
    expect(new Set(entries.map(entryKey)).size).toBe(3);
    const { json, errors } = exportRows(entries);
    expect(errors).toEqual([]);
    expect(json.profiles).toHaveLength(3);
    const target = json.profiles.find((p) => p.host === "target.invalid")!;
    const jump = json.profiles.find((p) => p.id === target.bastion_profile_id);
    expect(jump).toMatchObject({ host: "b.invalid", port: 2222 });
    expect(json.credentials.find((c) => c.id === jump?.credential_id)?.username).toBe("bob");
  });

  it("selects same-name rows independently and pulls in only the referenced jump", () => {
    const entries = parseTabby(fixture("ssh:gateway:b"));
    expect(exportRows(entries, [entries[1]]).json.profiles.map((p) => p.host))
      .toEqual(["b.invalid"]);
    expect(exportRows(entries, [entries[2]]).json.profiles.map((p) => p.host))
      .toEqual(["b.invalid", "target.invalid"]);
  });

  it("allows an exact, unambiguous legacy name without treating punctuation as SSH syntax", () => {
    const entries = parseTabby(fixture("Gate, west").replace('id: "ssh:gateway:b", name: "Gate, west"', 'name: "Gate, east"'));
    const { json, errors } = exportRows(entries, [entries[2]]);
    expect(errors).toEqual([]);
    expect(json.profiles.map((p) => p.host)).toEqual(["a.invalid", "target.invalid"]);
    expect(json.profiles[1].bastion_profile_id).toBe(json.profiles[0].id);
  });

  it("looks up an ID before considering an identical display name", () => {
    const entries = parseTabby(fixture("ssh:gateway:b").replace(
      'id: "ssh:gateway:a", name: "Gate, west"',
      'id: "ssh:gateway:a", name: "ssh:gateway:b"',
    ));
    const { json, errors } = exportRows(entries, [entries[2]]);
    expect(errors).toEqual([]);
    expect(json.profiles.map((p) => p.host)).toEqual(["b.invalid", "target.invalid"]);
  });

  it.each(["Gate, west", "ssh:missing"])("does not fall back to a direct connection for %s", (jump) => {
    const entries = parseTabby(fixture(jump));
    const { json, errors } = exportRows(entries);
    expect(json.profiles.map((p) => p.host)).toEqual(["a.invalid", "b.invalid"]);
    expect(errors).toEqual([{ alias: "Target", kind: "unresolved_tabby_jump" }]);
  });

  it("never chooses between distinct rows sharing a malformed duplicate ID", () => {
    const entries = parseTabby(fixture("ssh:gateway:b").replace("ssh:gateway:a", "ssh:gateway:b"));
    expect(new Set(entries.map(entryKey)).size).toBe(3);
    const { json, errors } = exportRows(entries);
    expect(json.profiles.map((p) => p.host)).toEqual(["a.invalid", "b.invalid"]);
    expect(errors).toEqual([{ alias: "Target", kind: "unresolved_tabby_jump" }]);
  });

  it("does not silently break a bastion cycle into a direct connection", () => {
    const entries = parseTabby(fixture("ssh:gateway:b").replace(
      "port: 2222", 'port: 2222, jumpHost: "ssh:target"',
    ));
    const { json, errors } = exportRows(entries, [entries[2]]);
    expect(json.profiles).toEqual([]);
    expect(errors.map((e) => e.kind)).toEqual([
      "unresolved_tabby_jump", "unresolved_tabby_jump",
    ]);
  });
});
