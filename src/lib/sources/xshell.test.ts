import { describe, expect, it } from "vitest";
import { parseXshellSession } from "./xshell";
import { parseTabby } from "./tabby";

const XSH = `Description=Xshell session file
[CONNECTION]
Host=192.168.1.10
Port=2222
Protocol=SSH
[CONNECTION:AUTHENTICATION]
UserName=ops
Method=PUBLICKEY
UserKey=node01
`;

describe("parseXshellSession", () => {
  it("maps connection and auth sections", () => {
    const e = parseXshellSession(XSH, "vpc/web01.xsh")!;
    expect(e).toMatchObject({
      source: "xshell",
      alias: "vpc/web01",
      hostname: "192.168.1.10",
      port: 2222,
      user: "ops",
      proxyJump: null,
    });
    // key not among the dragged files: surfaced as a structured note, agent fallback
    expect(e.note).toEqual({ kind: "xshell_key_missing", keyName: "node01" });
    expect(e.identityFiles).toEqual([]);
  });

  it("resolves UserKey when the dragged folder carried its PEM", () => {
    const e = parseXshellSession(XSH, "web01.xsh", new Set(["node01"]))!;
    expect(e.identityFiles).toEqual(["node01"]);
    expect(e.note).toBeNull();
  });

  it("password method notes that passwords do not migrate", () => {
    const e = parseXshellSession(
      XSH.replace("Method=PUBLICKEY", "Method=PASSWORD").replace("UserKey=node01\n", ""),
      "plain.xsh",
    )!;
    expect(e.note).toEqual({ kind: "password" });
  });

  it("skips non-SSH protocols and files without a host", () => {
    expect(parseXshellSession(XSH.replace("Protocol=SSH", "Protocol=TELNET"), "t.xsh")).toBeNull();
    expect(parseXshellSession("[CONNECTION]\nPort=22\n", "x.xsh")).toBeNull();
  });
});

const TABBY = `
profiles:
  - type: ssh
    name: web1
    options:
      host: 10.0.0.1
      port: 2222
      user: alice
      auth: publicKey
      privateKeys:
        - /home/alice/.ssh/id_ed25519
        - |
          -----BEGIN OPENSSH PRIVATE KEY-----
          tabby-inline
          -----END OPENSSH PRIVATE KEY-----
  - type: ssh
    name: token-key
    options:
      host: 10.0.0.9
      user: carol
      auth: publicKey
      privateKeys:
        - ~/.ssh/keys/%h/id_rsa
  - type: ssh
    name: via-jump
    options:
      host: 10.0.0.2
      user: bob
      auth: password
      jumpHost: web1
  - type: serial
    name: com1
`;

describe("parseTabby", () => {
  it("maps ssh profiles: key paths to the pool, inline PEMs, jumpHost", () => {
    const entries = parseTabby(TABBY);
    expect(entries.map((e) => e.alias)).toEqual(["web1", "token-key", "via-jump"]); // serial skipped
    const web1 = entries[0];
    expect(web1.hostname).toBe("10.0.0.1");
    expect(web1.port).toBe(2222);
    expect(web1.user).toBe("alice");
    // path → identity pool (matched later against picked key files by basename)
    expect(web1.identityFiles).toEqual(["/home/alice/.ssh/id_ed25519"]);
    // pasted PEM stays inline and migrates losslessly
    expect(web1.inlineKeys[0]).toContain("-----BEGIN");
    // %h/%r tokens expand to the profile's host/user like Tabby's session does
    expect(entries[1].identityFiles).toEqual(["~/.ssh/keys/10.0.0.9/id_rsa"]);
    expect(entries[2].proxyJump).toBe("web1");
    expect(entries[2].note).toEqual({ kind: "password" });
  });
});
