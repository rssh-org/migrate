// Intermediate representation shared by all source parsers, and the rssh
// import JSON schema (mirrors rssh's sync/config.rs merge_import — snake_case
// fields, lowercase credential "type", profile.group_id/algorithms omitted
// because rssh fills them via serde defaults).

export type SourceKind = "ssh" | "xshell" | "tabby";

/** Non-fatal parser note — structured, so the UI renders it per language. */
export type MigNote =
  | { kind: "xshell_key_missing"; keyName: string }
  | { kind: "password" }
  | { kind: "bastion_synthesized" };

/** One migratable connection, normalized across sources. */
export type MigEntry = {
  source: SourceKind;
  /** unique key across the batch — the profile name in rssh */
  alias: string;
  hostname: string;
  port: number;
  user: string | null;
  /** ordered identity pool (file paths); UI pick travels back as [chosen] */
  identityFiles: string[];
  /** inline PEM key contents (Tabby stores pasted keys in config.yaml) */
  inlineKeys: string[];
  /** raw ProxyJump value — [user@]host[:port] or comma chain */
  proxyJump: string | null;
  /** non-fatal parser note shown in the UI */
  note: MigNote | null;
};

// ── rssh import JSON ────────────────────────────────────────────────────

export type RsshCredentialType = "password" | "key" | "interactive" | "agent" | "none";

export type RsshCredential = {
  id: string;
  name: string;
  username: string;
  type: RsshCredentialType;
  secret: string | null;
  save_to_remote: boolean;
};

export type RsshProfile = {
  id: string;
  name: string;
  host: string;
  port: number;
  credential_id: string;
  bastion_profile_id: string | null;
  init_command: string | null;
};

export type RsshImport = {
  version: 1;
  credentials: RsshCredential[];
  profiles: RsshProfile[];
};
