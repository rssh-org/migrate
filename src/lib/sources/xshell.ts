import { parse as parseIni } from "ini";
import type { MigEntry } from "../types";

// Xshell session files (Sessions/*.xsh) are INI text:
//   [CONNECTION]              Host / Port / Protocol
//   [CONNECTION:AUTHENTICATION] UserName / Method / UserKey
// Passwords are NetSarang-encrypted and are deliberately NOT migrated.
// UserKey is a name inside Xshell's own key manager — not a file path — so
// the entry lands with a note and the user re-picks the key in rssh.

type IniDoc = Record<string, Record<string, string> | string>;

function section(doc: IniDoc, name: string): Record<string, string> {
  const direct = doc[name];
  if (direct && typeof direct === "object") return direct;
  const key = Object.keys(doc).find((k) => k.toLowerCase() === name.toLowerCase());
  const s = key ? doc[key] : undefined;
  return s && typeof s === "object" ? s : {};
}

function nameFromPath(relPath: string): string {
  // "vpc/web01.xsh" → "vpc/web01"; folders survive as name prefixes
  return relPath.replace(/\\/g, "/").replace(/\.xsh$/i, "");
}

export function parseXshellSession(
  text: string,
  relPath: string,
  availableUserKeys: ReadonlySet<string> = new Set(),
): MigEntry | null {
  const doc = parseIni(text);
  const conn = section(doc, "CONNECTION");
  const auth = section(doc, "CONNECTION:AUTHENTICATION");

  const host = conn["Host"] ?? conn["host"] ?? "";
  if (!host) return null;
  if ((conn["Protocol"] ?? "SSH").toUpperCase() !== "SSH") return null;

  const method = (auth["Method"] ?? "").toUpperCase();
  const userKey = auth["UserKey"] ?? "";
  // UserKey names a key in Xshell's own manager (Documents\NetSarang
  // Computer\<ver>\Xshell\UserKeys, file named after the key). When the user
  // dragged a folder that contains those key files we can resolve it; only
  // OpenSSH-style PEMs are usable by rssh — NetSarang/SECSH containers need
  // an export from the key manager first.
  const resolvable =
    method === "PUBLICKEY" && userKey !== "" && availableUserKeys.has(userKey.toLowerCase());
  const note =
    method === "PUBLICKEY" && userKey && !resolvable
      ? { kind: "xshell_key_missing", keyName: userKey }
      : method === "PASSWORD"
        ? { kind: "password" }
        : null;

  return {
    source: "xshell",
    alias: nameFromPath(relPath),
    hostname: host,
    port: Number.parseInt(conn["Port"] ?? "22", 10) || 22,
    user: auth["UserName"] || null,
    identityFiles: resolvable ? [userKey] : [],
    inlineKeys: [],
    proxyJump: null, // Xshell jump-host keys are not documented; left null
    note,
  };
}
