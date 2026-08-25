import type { MigEntry, RsshCredential, RsshImport, RsshProfile } from "./types";

// Mirrors rssh's commands/profile.rs do_import_ssh_entries:
//   A profile row exists for exactly two reasons —
//   1. the entry is checked, or
//   2. it is the bastion of a checked entry (transitively).
// Bastions resolve before the rows that reference them; `done` means "the
// alias already has its profile (or failed trying)".

export const MAX_HOPS = 8; // same cap as rssh ssh/bastion.rs

/** sentinel identity_files value: use the entry's inline PEM (Tabby) */
export const INLINE_KEY = "(inline-key)";

/** lowercase file basename → PEM text, from the user's picked key files */
export type KeyMap = Map<string, string>;

export type BuildError = { alias: string; kind: "missing_user" | "no_key_content" };

export type BuildResult = {
  json: RsshImport;
  errors: BuildError[];
};

export function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

export type JumpHop = { user: string | null; host: string; port: number | null };

/** `ProxyJump [user@]host[:port]` — IPv6 in brackets; a bare multi-colon
 *  string is a bare IPv6 host, not host:port. "none" cancels the jump. */
export function parseHop(hop: string): JumpHop | null {
  let h = hop.trim();
  if (!h || h === "none") return null;
  let user: string | null = null;
  if (h.includes("@")) {
    const at = h.lastIndexOf("@");
    user = h.slice(0, at) || null;
    h = h.slice(at + 1);
  }
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    if (end === -1) return { user, host: h, port: null };
    const rest = h.slice(end + 1);
    const port = rest.startsWith(":") ? Number.parseInt(rest.slice(1), 10) : NaN;
    return { user, host: h.slice(0, end + 1), port: Number.isNaN(port) ? null : port };
  }
  const first = h.indexOf(":");
  if (first === -1) return { user, host: h, port: null };
  if (first !== h.lastIndexOf(":")) return { user, host: h, port: null }; // bare IPv6
  const port = Number.parseInt(h.slice(first + 1), 10);
  return { user, host: h.slice(0, first), port: Number.isNaN(port) ? null : port };
}

/** The hop's host — the part profiles are matched against. */
export function stripJumpDecorations(hop: string): string {
  return parseHop(hop)?.host ?? hop;
}

const uuid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

class Emitter {
  private done = new Map<string, string | null>();
  private credCache = new Map<string, string>();
  /** distinct inline PEMs get distinct labels, so dedup keys never collide */
  private inlineLabels = new Map<string, string>();
  private credentials: RsshCredential[] = [];
  private profiles: RsshProfile[] = [];
  private byAlias = new Map<string, MigEntry>();

  constructor(
    private entries: MigEntry[],
    private keyMap: KeyMap,
    private defaultUser: string,
    private errors: BuildError[],
  ) {
    for (const e of entries) this.byAlias.set(e.alias, e);
  }

  build(selected: Set<string>): RsshImport {
    for (const entry of this.entries) {
      if (!selected.has(entry.alias)) continue; // may still arrive as a bastion
      if (this.done.has(entry.alias)) continue; // imported early as a bastion
      this.importEntry(entry, null, []);
    }
    return {
      version: 1,
      credentials: this.credentials,
      profiles: this.profiles,
    };
  }

  private importEntry(
    entry: MigEntry,
    chainBastion: string | null,
    visited: string[],
  ): string | null {
    const { alias } = entry;
    if (this.done.has(alias)) return this.done.get(alias) ?? null;
    if (visited.includes(alias) || visited.length > MAX_HOPS) return null;
    visited.push(alias);

    const bastion = entry.proxyJump
      ? (this.ensureBastion(entry.proxyJump, visited) ?? chainBastion)
      : chainBastion;

    const credId = this.resolveCredential(entry);
    if (!credId) {
      visited.pop();
      this.done.set(alias, null);
      return null;
    }

    const id = uuid();
    const profile: RsshProfile = {
      id,
      name: alias,
      host: entry.hostname || alias,
      port: entry.port,
      credential_id: credId,
      bastion_profile_id: bastion,
      init_command: null,
    };
    this.profiles.push(profile);
    visited.pop();
    this.done.set(alias, id);
    return id;
  }

  /** `ProxyJump j1,j2` connects j1 then j2 — rssh terms: target→j2→j1. */
  private ensureBastion(jump: string, visited: string[]): string | null {
    let prev: string | null = null;
    for (const hop of jump.split(",").map((s) => s.trim()).filter(Boolean)) {
      const alias = stripJumpDecorations(hop);
      prev = this.ensureHop(alias, prev, visited);
      if (!prev) return null;
    }
    return prev;
  }

  private ensureHop(
    alias: string,
    chainBastion: string | null,
    visited: string[],
  ): string | null {
    if (this.done.has(alias)) return this.done.get(alias) ?? null;
    const entry = this.byAlias.get(alias)
      // ProxyJump may name the hostname rather than the alias
      ?? this.entries.find((e) => e.hostname === alias);
    if (!entry) return null; // unresolved: bastion stays empty, same as rssh
    return this.importEntry(entry, chainBastion, visited);
  }

  /** Same inline PEM shares one label (and thus one credential); distinct
   *  PEMs get distinct labels so their dedup keys never collide. */
  private labelForInline(pem: string): string {
    let label = this.inlineLabels.get(pem);
    if (!label) {
      label =
        this.inlineLabels.size === 0
          ? "tabby-key"
          : `tabby-key-${this.inlineLabels.size + 1}`;
      this.inlineLabels.set(pem, label);
    }
    return label;
  }

  private resolveCredential(entry: MigEntry): string | null {
    const username = entry.user ?? this.defaultUser;
    if (!username) {
      this.errors.push({ alias: entry.alias, kind: "missing_user" });
      return null;
    }

    // Key preference: the UI's pick (identity_files holds [chosen] — a pool
    // path, the INLINE_KEY sentinel, or empty for agent), then Tabby's inline
    // PEM, then a picked key file matching the pool path by basename.
    const picked = entry.identityFiles[0];
    let pem: string | null = null;
    let label = "";
    if (picked === INLINE_KEY) {
      pem = entry.inlineKeys[0] ?? null;
      label = pem ? this.labelForInline(pem) : "tabby-key";
    } else if (picked) {
      const content = this.keyMap.get(basename(picked).toLowerCase()) ?? null;
      if (content) {
        pem = content;
        label = basename(picked);
      } else {
        this.errors.push({ alias: entry.alias, kind: "no_key_content" });
        // fall through to agent — the key file wasn't among the picked files
      }
    } else if (entry.inlineKeys[0]) {
      pem = entry.inlineKeys[0];
      label = this.labelForInline(pem);
    }

    const cacheKey = pem ? `key:${username}:${label}` : `agent:${username}`;
    const cached = this.credCache.get(cacheKey);
    if (cached) return cached;

    const id = uuid();
    this.credentials.push(
      pem
        ? {
            id,
            name: `${username}@${label}`,
            username,
            type: "key",
            secret: pem,
            save_to_remote: false,
          }
        : {
            id,
            name: `${username}@ssh-agent`,
            username,
            type: "agent",
            secret: null,
            save_to_remote: false,
          },
    );
    this.credCache.set(cacheKey, id);
    return id;
  }
}

export function buildRsshImport(opts: {
  entries: MigEntry[];
  selected: string[];
  keyMap: KeyMap;
  defaultUser: string;
}): BuildResult {
  const errors: BuildError[] = [];
  // duplicate aliases: first block wins, mirroring rssh's scan
  const deduped: MigEntry[] = [];
  const seen = new Set<string>();
  for (const e of opts.entries) {
    if (seen.has(e.alias)) continue;
    seen.add(e.alias);
    deduped.push(e);
  }
  const selected = new Set(
    opts.selected.filter((s) => deduped.some((e) => e.alias === s)),
  );
  const json = new Emitter(deduped, opts.keyMap, opts.defaultUser, errors).build(
    selected,
  );
  return { json, errors };
}
