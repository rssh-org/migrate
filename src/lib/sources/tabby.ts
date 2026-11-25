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
// profile by ID (or an unambiguous legacy name).

const isPem = (s: unknown): s is string =>
  typeof s === "string" && s.startsWith("-----BEGIN");

export function parseTabby(text: string): MigEntry[] {
  const doc = parseYaml(text) as {
    profiles?: Array<Record<string, unknown>>;
  };
  const profiles = (doc?.profiles ?? []).filter(
    (p) => p?.type === "ssh" && typeof p.name === "string",
  );

  // IDs take precedence over legacy names. Never choose the first match for
  // an ambiguous reference, and keep even ID-less rows separately selectable.
  const byId = new Map<string, number | null>();
  const byName = new Map<string, number | null>();
  const index = (map: Map<string, number | null>, value: string, i: number) =>
    map.set(value, map.has(value) ? null : i);
  profiles.forEach((p, i) => {
    if (typeof p.id === "string" && p.id) index(byId, p.id, i);
    index(byName, p.name as string, i);
  });
  const keysByRow = profiles.map((p, i) =>
    typeof p.id === "string" && byId.get(p.id) === i
      ? `tabby:id:${p.id}`
      : `tabby:row:${i}`,
  );

  return profiles.map((p, i) => {
    const o = (p.options ?? {}) as Record<string, unknown>;
    const alias = p.name as string;
    const reference = typeof o.jumpHost === "string" && o.jumpHost ? o.jumpHost : null;
    const target = reference === null
      ? null
      : byId.has(reference) ? byId.get(reference) : byName.get(reference);
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
    return {
      source: "tabby",
      alias,
      hostname: host,
      port: typeof o.port === "number" ? o.port : 22,
      user,
      identityFiles,
      inlineKeys: keys.filter(isPem),
      proxyJump: null,
      tabby: {
        key: keysByRow[i],
        jump: reference === null ? null : {
          reference,
          key: target == null ? null : keysByRow[target],
        },
      },
      note: o.auth === "password" ? { kind: "password" } : null,
    };
  });
}
