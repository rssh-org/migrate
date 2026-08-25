import { describe, expect, it } from "vitest";
import { buildRsshImport, stripJumpDecorations, type KeyMap } from "./rssh";
import type { MigEntry } from "./types";

// The bastion/credential matrix — ported 1:1 from rssh's
// commands/profile.rs test suite so both implementations stay pinned to the
// same golden behavior.

function entry(alias: string, over: Partial<MigEntry> = {}): MigEntry {
  return {
    source: "ssh",
    alias,
    hostname: `${alias}.example`,
    port: 22,
    user: "root",
    identityFiles: [],
    inlineKeys: [],
    proxyJump: null,
    note: null,
    ...over,
  };
}

const noKeys: KeyMap = new Map();
const sel = (...names: string[]) => names;
const byName = (r: ReturnType<typeof buildRsshImport>["json"], n: string) =>
  r.profiles.find((p) => p.name === n)!;

describe("buildRsshImport — bastion rules", () => {
  it("auto-creates an unchecked bastion and links it", () => {
    const res = buildRsshImport({
      entries: [entry("target", { proxyJump: "ser111" }), entry("ser111")],
      selected: sel("target"),
      keyMap: noKeys,
      defaultUser: "",
    });
    expect(res.json.profiles).toHaveLength(2);
    expect(byName(res.json, "target").bastion_profile_id).toBe(
      byName(res.json, "ser111").id,
    );
    expect(byName(res.json, "ser111").bastion_profile_id).toBeNull();
  });

  it("a checked bastion is not duplicated", () => {
    const res = buildRsshImport({
      entries: [entry("gw"), entry("t1", { proxyJump: "gw" }), entry("t2", { proxyJump: "gw" })],
      selected: sel("gw", "t1", "t2"),
      keyMap: noKeys,
      defaultUser: "",
    });
    expect(res.json.profiles).toHaveLength(3);
    const gw = byName(res.json, "gw");
    expect(res.json.profiles.filter((p) => p.bastion_profile_id === gw.id)).toHaveLength(2);
  });

  it("comma chain maps to target→j2→j1", () => {
    const res = buildRsshImport({
      entries: [entry("target", { proxyJump: "j1,j2" }), entry("j1"), entry("j2")],
      selected: sel("target"),
      keyMap: noKeys,
      defaultUser: "",
    });
    const { target, j1, j2 } = {
      target: byName(res.json, "target"),
      j1: byName(res.json, "j1"),
      j2: byName(res.json, "j2"),
    };
    expect(target.bastion_profile_id).toBe(j2.id);
    expect(j2.bastion_profile_id).toBe(j1.id);
    expect(j1.bastion_profile_id).toBeNull();
  });

  it("self jump resolves to no bastion", () => {
    const res = buildRsshImport({
      entries: [entry("n", { proxyJump: "n" })],
      selected: sel("n"),
      keyMap: noKeys,
      defaultUser: "",
    });
    expect(res.json.profiles).toHaveLength(1);
    expect(res.json.profiles[0].bastion_profile_id).toBeNull();
  });

  it("jump cycles terminate and break at the earliest edge", () => {
    const res = buildRsshImport({
      entries: [entry("a", { proxyJump: "b" }), entry("b", { proxyJump: "a" })],
      selected: sel("a", "b"),
      keyMap: noKeys,
      defaultUser: "",
    });
    expect(res.json.profiles).toHaveLength(2);
    expect(byName(res.json, "a").bastion_profile_id).toBe(byName(res.json, "b").id);
    expect(byName(res.json, "b").bastion_profile_id).toBeNull();
  });

  it("deep chains stop at MAX_HOPS", () => {
    const entries = [entry("target", { proxyJump: "h1" })];
    for (let i = 1; i < 12; i++) entries.push(entry(`h${i}`, { proxyJump: `h${i + 1}` }));
    const res = buildRsshImport({
      entries,
      selected: sel("target"),
      keyMap: noKeys,
      defaultUser: "",
    });
    // target + h1..h8 = 9 rows; h9+ never materialize
    expect(res.json.profiles).toHaveLength(9);
    expect(byName(res.json, "h8").bastion_profile_id).toBeNull();
  });

  it("user@host:port decorations are stripped for matching", () => {
    const res = buildRsshImport({
      entries: [entry("target", { proxyJump: "root@gw.example:2222" }), entry("gw")],
      selected: sel("target"),
      keyMap: noKeys,
      defaultUser: "",
    });
    expect(byName(res.json, "target").bastion_profile_id).toBe(byName(res.json, "gw").id);
  });

  it("unresolvable jump leaves bastion null without an error", () => {
    const res = buildRsshImport({
      entries: [entry("target", { proxyJump: "ghost" })],
      selected: sel("target"),
      keyMap: noKeys,
      defaultUser: "",
    });
    expect(res.json.profiles).toHaveLength(1);
    expect(res.errors).toEqual([]);
    expect(res.json.profiles[0].bastion_profile_id).toBeNull();
  });

  it("unchecked, unreferenced entries are not emitted", () => {
    const res = buildRsshImport({
      entries: [entry("picked"), entry("skipped")],
      selected: sel("picked"),
      keyMap: noKeys,
      defaultUser: "",
    });
    expect(res.json.profiles.map((p) => p.name)).toEqual(["picked"]);
  });
});

describe("buildRsshImport — credentials", () => {
  const PEM = "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END-----";

  it("a chosen key with picked file content becomes a key credential", () => {
    const keyMap: KeyMap = new Map([["pool_key", PEM]]);
    const res = buildRsshImport({
      entries: [entry("h", { identityFiles: ["~/.ssh/pool_key"] })],
      selected: sel("h"),
      keyMap,
      defaultUser: "",
    });
    expect(res.json.credentials).toHaveLength(1);
    const c = res.json.credentials[0];
    expect(c).toMatchObject({ username: "root", type: "key", name: "root@pool_key" });
    expect(c.secret).toBe(PEM);
    expect(res.json.profiles[0].credential_id).toBe(c.id);
  });

  it("a chosen key without file content falls back to agent with an error", () => {
    const res = buildRsshImport({
      entries: [entry("h", { identityFiles: ["~/.ssh/missing"] })],
      selected: sel("h"),
      keyMap: noKeys,
      defaultUser: "",
    });
    expect(res.json.credentials[0].type).toBe("agent");
    expect(res.errors).toEqual([{ alias: "h", kind: "no_key_content" }]);
  });

  it("Tabby inline PEMs become key credentials without any file picking", () => {
    const res = buildRsshImport({
      entries: [entry("h", { source: "tabby", inlineKeys: [PEM] })],
      selected: sel("h"),
      keyMap: noKeys,
      defaultUser: "",
    });
    expect(res.json.credentials[0]).toMatchObject({ type: "key", secret: PEM });
  });

  it("shares one credential per (user, key) and per agent user", () => {
    const keyMap: KeyMap = new Map([["k", PEM]]);
    const res = buildRsshImport({
      entries: [
        entry("a", { identityFiles: ["~/.ssh/k"] }),
        entry("b", { identityFiles: ["~/.ssh/k"] }),
        entry("c", { user: "bob" }),
        entry("d"),
      ],
      selected: sel("a", "b", "c", "d"),
      keyMap,
      defaultUser: "",
    });
    // (root,k) + (bob,agent) + (root,agent)
    expect(res.json.credentials).toHaveLength(3);
  });

  it("distinct inline PEMs never share a credential; identical PEMs do", () => {
    const PEM2 = PEM.replace("abc", "different");
    const res = buildRsshImport({
      entries: [
        entry("h1", { source: "tabby", inlineKeys: [PEM] }),
        entry("h2", { source: "tabby", inlineKeys: [PEM2] }),
        entry("h3", { source: "tabby", inlineKeys: [PEM] }),
      ],
      selected: sel("h1", "h2", "h3"),
      keyMap: noKeys,
      defaultUser: "",
    });
    const keys = res.json.credentials.filter((c) => c.type === "key");
    expect(keys).toHaveLength(2);
    expect(new Set(keys.map((c) => c.secret))).toEqual(new Set([PEM, PEM2]));
    // h1 and h3 share; h2 gets its own
    const credOf = (n: string) =>
      res.json.credentials.find((c) => c.id === byName(res.json, n).credential_id)!;
    expect(credOf("h1").id).toBe(credOf("h3").id);
    expect(credOf("h2").id).not.toBe(credOf("h1").id);
  });

  it("each generation mints fresh UUIDs with identical structure (one-shot tool)", () => {
    const input = {
      entries: [entry("t", { proxyJump: "gw" }), entry("gw")],
      selected: sel("t"),
      keyMap: noKeys,
      defaultUser: "root",
    };
    const a = buildRsshImport(input);
    const b = buildRsshImport(input);
    expect(a.json.profiles.map((p) => p.name)).toEqual(b.json.profiles.map((p) => p.name));
    expect(a.json.credentials.map((c) => c.username)).toEqual(b.json.credentials.map((c) => c.username));
    const idsA = new Set([...a.json.profiles.map((p) => p.id), ...a.json.credentials.map((c) => c.id)]);
    const idsB = new Set([...b.json.profiles.map((p) => p.id), ...b.json.credentials.map((c) => c.id)]);
    for (const id of idsA) expect(idsB.has(id)).toBe(false);
  });

  it("one unchecked bastion shared by two targets still yields a single row", () => {
    const res = buildRsshImport({
      entries: [
        entry("t1", { proxyJump: "gw" }),
        entry("t2", { proxyJump: "gw" }),
        entry("gw"),
      ],
      selected: sel("t1", "t2"),
      keyMap: noKeys,
      defaultUser: "",
    });
    expect(res.json.profiles).toHaveLength(3);
    const gw = byName(res.json, "gw");
    expect(res.json.profiles.filter((p) => p.bastion_profile_id === gw.id)).toHaveLength(2);
  });

  it("entries without any username and no default are skipped with an error", () => {
    const res = buildRsshImport({
      entries: [entry("bare", { user: null })],
      selected: sel("bare"),
      keyMap: noKeys,
      defaultUser: "",
    });
    expect(res.json.profiles).toHaveLength(0);
    expect(res.errors).toEqual([{ alias: "bare", kind: "missing_user" }]);
  });
});

describe("buildRsshImport — schema shape", () => {
  it("matches rssh merge_import field names exactly", () => {
    const res = buildRsshImport({
      entries: [entry("t", { proxyJump: "gw" }), entry("gw", { user: null })],
      selected: sel("t"),
      keyMap: noKeys,
      defaultUser: "root",
    });
    expect(res.json.version).toBe(1);
    const c = res.json.credentials[0];
    expect(Object.keys(c).sort()).toEqual(
      ["id", "name", "save_to_remote", "secret", "type", "username"].sort(),
    );
    expect(c.type).toBe("agent");
    expect(c.save_to_remote).toBe(false);
    const p = res.json.profiles[0];
    expect(Object.keys(p).sort()).toEqual(
      ["bastion_profile_id", "credential_id", "host", "id", "init_command", "name", "port"].sort(),
    );
    expect(p.credential_id).toBe(c.id);
  });
});

describe("stripJumpDecorations", () => {
  it("strips user and port, keeps IPv6 literals", () => {
    expect(stripJumpDecorations("root@1.2.3.4:2222")).toBe("1.2.3.4");
    expect(stripJumpDecorations("gw")).toBe("gw");
    expect(stripJumpDecorations("[::1]:22")).toBe("[::1]");
    expect(stripJumpDecorations("::1")).toBe("::1"); // bare IPv6: two colons ≠ host:port
  });
});
