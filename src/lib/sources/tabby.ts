import { load as parseYaml } from "js-yaml";
import type { MigEntry } from "../types";

// Tabby keeps SSH profiles in ~/.config/tabby/config.yaml. Field names below
// are pinned from upstream source (tabby-ssh/src/api/interfaces.ts):
//   { type: "ssh", name, options: { host, port?, user, auth,
//     privateKeys: string[], jumpHost: string | null, ... } }
// privateKeys holds FILE REFERENCES (paths, with %h/%r tokens) — the session
// reads them lazily via fileProviders.retrieveFile — and occasionally pasted
// PEM text. Paths join the identity pool (matched against the user's picked
// key files by basename); PEMs migrate losslessly into the rssh JSON secret.
// Encrypted passwords (vault) are skipped. jumpHost references another
// profile by name or id and becomes proxyJump.

const isPem = (s: unknown): s is string =>
  typeof s === "string" && s.startsWith("-----BEGIN");

export function parseTabby(text: string): MigEntry[] {
  const doc = parseYaml(text) as {
    profiles?: Array<Record<string, unknown>>;
  };
  const profiles = (doc?.profiles ?? []).filter(
    (p) => p?.type === "ssh" && typeof p.name === "string",
  );

  // jumpHost may be a profile name or a profile id — normalize both to names
  const nameById = new Map<string, string>();
  for (const p of profiles) {
    if (typeof p.id === "string") nameById.set(p.id, p.name as string);
  }
  const resolveJump = (j: unknown): string | null => {
    if (typeof j !== "string" || j === "") return null;
    return nameById.get(j) ?? j;
  };

  const entries: MigEntry[] = [];
  const seen = new Set<string>();
  for (const p of profiles) {
    const o = (p.options ?? {}) as Record<string, unknown>;
    const alias = p.name as string;
    if (seen.has(alias)) continue;
    seen.add(alias);
    const host = typeof o.host === "string" ? o.host : "";
    const user = typeof o.user === "string" && o.user !== "" ? o.user : null;
    const keys = Array.isArray(o.privateKeys)
      ? o.privateKeys.filter((k): k is string => typeof k === "string")
      : [];
    // %h/%r expand to the profile's host/user, same as Tabby's session does
    const expand = (p2: string) => p2.replaceAll("%h", host).replaceAll("%r", user ?? "");
    const identityFiles = [
      ...new Set(keys.filter((k) => !isPem(k)).map(expand)),
    ];
    entries.push({
      source: "tabby",
      alias,
      hostname: host,
      port: typeof o.port === "number" ? o.port : 22,
      user,
      identityFiles,
      inlineKeys: keys.filter(isPem),
      proxyJump: resolveJump(o.jumpHost),
      note: o.auth === "password" ? { kind: "password" } : null,
    });
  }
  return entries;
}
