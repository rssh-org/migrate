import type { MigNote } from "./types";

// All UI copy in one place, zh/en pinned to the same shape by `typeof zh`.
// Parsers never see natural language — they emit structured notes, and only
// this module knows how to say them.

const zh = {
  tagline:
    "Xshell / Tabby / ~/.ssh/config → rssh 配置，全程在你的浏览器本地完成，零网络请求。",
  review_lead: "代码公开可 review：",
  review_tail: "，由 GitHub Pages 托管。",
  ssh_desc: "支持 Host * 默认继承、IdentityFile 密钥池、ProxyJump 堡垒",
  xshell_desc: "选择 Sessions 文件夹（可整个 Xshell 目录拖入以自动接回用户密钥）；密码不迁移",
  tabby_desc: "~/.config/tabby/config.yaml；内置私钥直接迁移",
  keys_title: "密钥文件（可选）",
  keys_desc: (n: number) =>
    `已选 ${n} 个 PEM；按文件名与 IdentityFile 匹配后写入 JSON，缺失的密钥回退 ssh-agent 认证`,
  source_ssh: (name: string) => `~/.ssh/config（${name}）`,
  source_xshell: (n: number) => `Xshell（${n} 个 .xsh）`,
  source_tabby: (name: string) => `Tabby（${name}）`,
  err_no_xsh: "选择的文件夹里没有 .xsh 会话文件",
  err_tabby_parse: (e: unknown) => `Tabby 配置解析失败：${e}`,
  err_file_read: (path: string) => `${path} 读取失败`,
  toolbar_source: "来源",
  toolbar_selected: (s: number, n: number) => `已选 ${s} / ${n}`,
  default_user: "缺省用户名",
  default_user_ph: "User 未指定时使用",
  generate: "生成 rssh JSON",
  col_alias: "名称",
  col_host: "主机:端口",
  col_user: "用户",
  col_key: "密钥",
  col_bastion: "堡垒",
  opt_inline: "Tabby 内置密钥",
  opt_agent: "ssh-agent / 默认密钥",
  result_title: (p: number, c: number) => `生成完成：${p} 个 Profile、${c} 个凭证`,
  err_missing_user: "没有用户名（填写缺省用户名后重新生成）",
  err_no_key_content: "所选密钥文件未在上方挑选，已回退 ssh-agent",
  result_hint:
    "在 rssh 中：设置 → 导入导出 → 导入文件，选择下载的 JSON（增量合并，不动现有数据）。",
  download: "下载 rssh-migrate.json",
  copy: "复制 JSON",
  preview: "预览 JSON",
};

const en: typeof zh = {
  tagline:
    "Xshell / Tabby / ~/.ssh/config → rssh configs, entirely in your browser — zero network requests.",
  review_lead: "Source open for review at ",
  review_tail: ", hosted on GitHub Pages.",
  ssh_desc: "Host * inheritance, IdentityFile pools, ProxyJump bastions",
  xshell_desc:
    "Pick the Sessions folder (drag the whole Xshell directory to auto-attach user keys); passwords are not migrated",
  tabby_desc: "~/.config/tabby/config.yaml; embedded private keys migrate directly",
  keys_title: "Key files (optional)",
  keys_desc: (n: number) =>
    `${n} PEMs loaded; matched to IdentityFile by filename and written into the JSON — missing keys fall back to ssh-agent auth`,
  source_ssh: (name: string) => `~/.ssh/config (${name})`,
  source_xshell: (n: number) => `Xshell (${n} .xsh files)`,
  source_tabby: (name: string) => `Tabby (${name})`,
  err_no_xsh: "No .xsh session files in the selected folder",
  err_tabby_parse: (e: unknown) => `Failed to parse the Tabby config: ${e}`,
  err_file_read: (path: string) => `Could not read ${path}`,
  toolbar_source: "source",
  toolbar_selected: (s: number, n: number) => `${s} / ${n} selected`,
  default_user: "Default username",
  default_user_ph: "Used when User is unset",
  generate: "Generate rssh JSON",
  col_alias: "Name",
  col_host: "Host:Port",
  col_user: "User",
  col_key: "Key",
  col_bastion: "Bastion",
  opt_inline: "Tabby built-in key",
  opt_agent: "ssh-agent / default key",
  result_title: (p: number, c: number) => `Done: ${p} profiles, ${c} credentials`,
  err_missing_user: "no username (set the default username and regenerate)",
  err_no_key_content: "the chosen key file was not provided above; fell back to ssh-agent",
  result_hint:
    "In rssh: Settings → Import/Export → Import file, pick the downloaded JSON (merged incrementally, existing data untouched).",
  download: "Download rssh-migrate.json",
  copy: "Copy JSON",
  preview: "Preview JSON",
};

export type Lang = "zh" | "en";
export const DICTS = { zh, en };

const NOTES: {
  [K in MigNote["kind"]]: (lang: Lang, note: Extract<MigNote, { kind: K }>) => string;
} = {
  xshell_key_missing: (lang, n) =>
    lang === "zh"
      ? `Xshell 密钥 “${n.keyName}” 无法自动获取：把 UserKeys 目录（或导出的 OpenSSH 私钥）拖入“密钥文件”后重试`
      : `Xshell key “${n.keyName}” not available: drag the UserKeys folder (or an exported OpenSSH private key) into “Key files” and retry`,
  password: (lang) =>
    lang === "zh"
      ? "原密码不迁移，连接时 rssh 会提示输入"
      : "Password is not migrated; rssh prompts for it on connect",
  bastion_synthesized: (lang) =>
    lang === "zh"
      ? "无独立 Host 块：按通配段与 ProxyJump 写法（user/port）自动补全"
      : "No Host block of its own: synthesized from wildcard blocks and the ProxyJump spec (user/port)",
};

export function noteText(lang: Lang, note: MigNote): string {
  return NOTES[note.kind](lang, note);
}
