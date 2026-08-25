import { describe, expect, it } from "vitest";
import { buildRsshImport } from "../rssh";
import { parseSshConfig } from "./sshconfig";

const home = (p: string) => `~/.ssh/${p}`;

describe("parseSshConfig", () => {
  it("merges the Host * identity pool (issue #248 verbatim)", () => {
    const cfg = `
# ========== 全局默认配置 ==========
Host *
    IdentityFile ~/.ssh/id_ed25519
    IdentityFile ~/.ssh/ssh-key-2026-08-18.key

Host sername
`;
    const entries = parseSshConfig(cfg);
    expect(entries.map((e) => e.alias)).toEqual(["sername"]);
    // ~ stays unexpanded in the browser — matched by basename later
    expect(entries[0].identityFiles).toEqual([home("id_ed25519"), home("ssh-key-2026-08-18.key")]);
  });

  it("inherits Host * user and port into a bare entry", () => {
    const entries = parseSshConfig("Host *\n    User alice\n    Port 2222\n\nHost real\n");
    expect(entries[0].user).toBe("alice");
    expect(entries[0].port).toBe(2222);
  });

  it("first-obtained-wins: Host * at the TOP wins over later blocks", () => {
    const entries = parseSshConfig("Host *\n    User global\n\nHost h\n    User own\n");
    expect(entries[0].user).toBe("global");
    const reversed = parseSshConfig("Host h\n    User own\n\nHost *\n    User global\n");
    expect(reversed[0].user).toBe("own");
  });

  it("Host * foo yields foo, not the whole line dropped", () => {
    const entries = parseSshConfig("Host * foo\n    HostName x.example\n");
    expect(entries.map((e) => e.alias)).toEqual(["foo"]);
  });

  it("negated tokens are not aliases", () => {
    const entries = parseSshConfig("Host !excluded kept\n");
    expect(entries.map((e) => e.alias)).toEqual(["kept"]);
  });

  it("parses proxy jump verbatim and defaults hostname to the alias", () => {
    const entries = parseSshConfig("Host t\n    ProxyJump root@1.2.3.4:2222\n");
    expect(entries[0].proxyJump).toBe("root@1.2.3.4:2222");
    expect(entries[0].hostname).toBe("t");
    expect(entries[0].port).toBe(22);
  });

  it("Canonicalize directives are stripped so the pool survives them", () => {
    // ssh-config's canonicalize pass drops all but the first IdentityFile —
    // stripped before parsing (library bug, same in node and browser).
    const entries = parseSshConfig(`Host *
    CanonicalizeHostname yes
    CanonicalDomains example.internal
    IdentityFile ~/.ssh/id_ed25519
    IdentityFile ~/.ssh/ssh-key-2026-08-18.key

Host web1
    HostName 10.0.0.1
`);
    expect(entries[0].identityFiles).toEqual([
      home("id_ed25519"),
      home("ssh-key-2026-08-18.key"),
    ]);
  });

  it("the same IdentityFile declared by entry and Host * arrives once", () => {
    // ssh-config accumulates without dedup — this exact shape (own key +
    // identical global default) used to yield a duplicate dropdown value and
    // crashed Svelte's keyed each.
    const entries = parseSshConfig(
      "Host h\n    IdentityFile ~/.ssh/id_ed25519\n\nHost *\n    IdentityFile ~/.ssh/id_ed25519\n",
    );
    expect(entries[0].identityFiles).toEqual([home("id_ed25519")]);
  });

  it("duplicate Host lines produce one row", () => {
    const entries = parseSshConfig("Host a\n    User u1\n\nHost a\n    User u2\n");
    expect(entries).toHaveLength(1);
    expect(entries[0].user).toBe("u1");
  });

  it("synthesizes a row for a ProxyJump target with no Host block of its own", () => {
    // The bastion is only covered by wildcards — ssh itself resolves the hop
    // through those blocks, so the import must too, or the link is dropped.
    const entries = parseSshConfig(`
Host *.corp.example.com
    User ops

Host *
    User alice
    IdentityFile ~/.ssh/id_ed25519

Host prod-web-1
    HostName 10.20.1.11
    User ops
    ProxyJump bastion.corp.example.com:2200
`);
    const bastion = entries.find((e) => e.alias === "bastion.corp.example.com");
    expect(bastion).toBeDefined();
    expect(bastion!.hostname).toBe("bastion.corp.example.com");
    expect(bastion!.port).toBe(2200); // the jump's port beats the wildcard default 22
    expect(bastion!.user).toBe("ops"); // from Host *.corp.example.com
    expect(bastion!.identityFiles).toEqual([home("id_ed25519")]); // Host * pool applies
    expect(bastion!.proxyJump).toBeNull();
    expect(bastion!.note).toEqual({ kind: "bastion_synthesized" });
  });

  it("a user@hop decoration overrides the wildcard-derived user", () => {
    const entries = parseSshConfig(`
Host *
    User alice

Host t
    ProxyJump root@gw.example.com
`);
    expect(entries.find((e) => e.alias === "gw.example.com")!.user).toBe("root");
  });

  it("does not duplicate a block the hop reaches via HostName", () => {
    const entries = parseSshConfig(`
Host bastion
    HostName bastion.example.com
    Port 2200

Host t
    ProxyJump bastion.example.com
`);
    expect(entries.map((e) => e.alias)).toEqual(["bastion", "t"]); // no synthesized third row
  });

  it("ProxyJump none means no bastion at all", () => {
    const entries = parseSshConfig("Host t\n    ProxyJump none\n");
    expect(entries).toHaveLength(1);
    expect(entries[0].proxyJump).toBeNull();
  });

  it("links the synthesized bastion into the generated JSON end to end", () => {
    const entries = parseSshConfig(`
Host *.corp.example.com
    User ops

Host prod-web-1
    HostName 10.20.1.11
    User ops
    ProxyJump bastion.corp.example.com:2200
`);
    const res = buildRsshImport({
      entries,
      selected: ["prod-web-1"],
      keyMap: new Map(),
      defaultUser: "root",
    });
    const target = res.json.profiles.find((p) => p.name === "prod-web-1")!;
    const bastion = res.json.profiles.find((p) => p.name === "bastion.corp.example.com")!;
    expect(bastion).toBeDefined();
    expect(bastion.host).toBe("bastion.corp.example.com");
    expect(bastion.port).toBe(2200);
    expect(target.bastion_profile_id).toBe(bastion.id);
  });

  it("Match exec criteria are never executed (matchExec disabled)", async () => {
    // In node the real spawnSync exists — if the matchExec plumbing ever
    // breaks, the touch command runs and the marker appears.
    const { rmSync, existsSync } = await import("node:fs");
    const marker = "/tmp/rssh-migrate-matchexec-ran";
    try { rmSync(marker); } catch { /* absent */ }
    const entries = parseSshConfig(`Match exec "touch ${marker}"\n    User ghost\n\nHost t\n    HostName x.example\n`);
    expect(entries.map((e) => e.alias)).toEqual(["t"]);
    expect(entries[0].user).toBeNull();
    expect(existsSync(marker)).toBe(false);
  });
});
