import SSHConfig from "ssh-config";
import type { Line } from "ssh-config";
import { parseHop, type JumpHop } from "../rssh";
import type { MigEntry } from "../types";

// ~/.ssh/config via the `ssh-config` npm package: its compute() implements
// OpenSSH first-obtained-wins merging and keeps IdentityFile as an
// accumulating array — the same semantics as rssh's russh-config side.

function hostSectionTokens(line: Line): string[] | null {
  const l = line as unknown as { param?: string; value?: unknown; config?: unknown };
  if (!l.config || typeof l.param !== "string" || l.param.toLowerCase() !== "host") {
    return null;
  }
  const v = l.value;
  const tokens = Array.isArray(v)
    ? v.map((t) => (typeof t === "string" ? t : t.val))
    : [String(v)];
  return tokens.filter(Boolean);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return typeof v === "string" ? [v] : [];
}

export function parseSshConfig(text: string): MigEntry[] {
  // ssh-config's canonicalization pass (CanonicalizeHostname/CanonicalDomains)
  // corrupts multi-IdentityFile accumulation — a library bug, reproducible in
  // node too. Canonicalization is also migration noise (it rewrites hostnames
  // via nslookup), so strip the directives outright.
  const cleaned = text
    .split("\n")
    .filter((line) => !/^\s*Canonicalize\w*/i.test(line) && !/^\s*CanonicalDomains/i.test(line))
    .join("\n");
  const cfg = SSHConfig.parse(cleaned);
  const seen = new Set<string>();
  const entries: MigEntry[] = [];
  const hops: JumpHop[] = [];

  for (const line of cfg) {
    const tokens = hostSectionTokens(line);
    if (!tokens) continue;
    // First non-wildcard, non-negated token is the importable alias —
    // `Host *` carries defaults only, `Host * foo` still yields foo.
    const alias = tokens.find(
      (t) => !t.startsWith("!") && !t.includes("*") && !t.includes("?"),
    );
    if (!alias || seen.has(alias)) continue;
    seen.add(alias);

    const c = cfg.compute(alias, { ignoreCase: true, matchExec: false });
    // ssh-config accumulates IdentityFile across matching blocks WITHOUT
    // deduping — the same file declared by the entry and again by `Host *`
    // would arrive twice. Order-preserving dedupe, mirroring rssh's Rust side.
    const identityFiles = [...new Set(list(c.identityfile))];
    const jump = str(c.proxyjump);
    if (jump) for (const hop of jump.split(",")) {
      const parsed = parseHop(hop);
      if (parsed) hops.push(parsed);
    }
    entries.push({
      source: "ssh",
      alias,
      hostname: str(c.hostname) ?? alias,
      port: Number.parseInt(str(c.port) ?? "22", 10) || 22,
      user: str(c.user),
      identityFiles,
      inlineKeys: [],
      proxyJump: jump === "none" ? null : jump,
      note: null,
    });
  }

  // A ProxyJump target with no Host block of its own (covered only by
  // wildcards) is still a connectable host — ssh resolves the hop through
  // this same config. Synthesize a row for it so the bastion link survives
  // import; the jump's own user/port beat the wildcard defaults.
  for (const hop of hops) {
    if (seen.has(hop.host)) continue;
    if (entries.some((e) => e.hostname === hop.host)) continue; // named via a block's HostName
    seen.add(hop.host);
    const c = cfg.compute(hop.host, { ignoreCase: true, matchExec: false });
    entries.push({
      source: "ssh",
      alias: hop.host,
      hostname: str(c.hostname) ?? hop.host,
      port: hop.port ?? (Number.parseInt(str(c.port) ?? "22", 10) || 22),
      user: hop.user ?? str(c.user),
      identityFiles: [...new Set(list(c.identityfile))],
      inlineKeys: [],
      proxyJump: null,
      note: { kind: "bastion_synthesized" },
    });
  }
  return entries;
}
