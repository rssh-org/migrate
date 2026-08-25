<script lang="ts">
  import { tick } from "svelte";
  import { buildRsshImport, INLINE_KEY, type KeyMap } from "./lib/rssh";
  import { parseSshConfig } from "./lib/sources/sshconfig";
  import { parseXshellSession } from "./lib/sources/xshell";
  import { parseTabby } from "./lib/sources/tabby";
  import { decodeFileBytes, looksLikePem } from "./lib/encoding";
  import { DICTS, noteText, type Lang } from "./lib/i18n";
  import type { MigEntry, RsshImport } from "./lib/types";

  const INLINE = INLINE_KEY;
  const REPO_URL = "https://github.com/rssh-org/migrate";

  function initLang(): Lang {
    try {
      const saved = localStorage.getItem("rssh-migrate-lang");
      if (saved === "zh" || saved === "en") return saved;
    } catch {
      /* storage unavailable (e.g. sandboxed file://) — fall through */
    }
    return navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
  }

  let lang = $state<Lang>(initLang());
  const L = $derived(DICTS[lang]);

  function setLang(next: Lang) {
    lang = next;
    try {
      localStorage.setItem("rssh-migrate-lang", next);
    } catch {
      /* ignore */
    }
  }

  let entries = $state<MigEntry[]>([]);
  let selected = $state<Set<number>>(new Set());
  let keyChoice = $state<Record<number, string>>({});
  let keyMap = $state<KeyMap>(new Map());
  let keyCount = $state(0);
  let defaultUser = $state("");
  let source = $state<{ kind: "ssh" | "xshell" | "tabby"; detail: string } | null>(null);
  let parseErrors = $state<{ kind: "no_xsh" | "tabby_parse" | "file_read"; detail: string }[]>([]);
  let result = $state<{ json: RsshImport; errors: { alias: string; kind: string }[] } | null>(null);

  let sourceLabel = $derived(
    !source
      ? ""
      : source.kind === "xshell"
        ? L.source_xshell(Number(source.detail))
        : source.kind === "ssh"
          ? L.source_ssh(source.detail)
          : L.source_tabby(source.detail),
  );

  function errText(e: { kind: "no_xsh" | "tabby_parse" | "file_read"; detail: string }): string {
    return e.kind === "no_xsh"
      ? L.err_no_xsh
      : e.kind === "tabby_parse"
        ? L.err_tabby_parse(e.detail)
        : L.err_file_read(e.detail);
  }

  function resetRows(
    next: MigEntry[],
    src: { kind: "ssh" | "xshell" | "tabby"; detail: string } | null,
    errs: { kind: "no_xsh" | "tabby_parse" | "file_read"; detail: string }[] = [],
  ) {
    // Svelte keyed-each dies on duplicate keys — enforce first-wins by alias
    // no matter what a source emits.
    const seen = new Set<string>();
    entries = next.filter((e) => !seen.has(e.alias) && seen.add(e.alias));
    source = src;
    parseErrors = errs;
    selected = new Set(entries.map((_, i) => i));
    keyChoice = {};
    result = null;
  }

  async function onSshConfig(ev: Event) {
    const file = (ev.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    resetRows(parseSshConfig(await file.text()), { kind: "ssh", detail: file.name });
  }

  async function onTabby(ev: Event) {
    const file = (ev.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      resetRows(parseTabby(await file.text()), { kind: "tabby", detail: file.name });
    } catch (e) {
      resetRows(null, null, [{ kind: "tabby_parse", detail: String(e) }]);
    }
  }

  async function onXshell(ev: Event) {
    const files = Array.from((ev.currentTarget as HTMLInputElement).files ?? []);
    const relOf = (f: File) =>
      (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const xsh = files.filter((f) => f.name.toLowerCase().endsWith(".xsh"));
    if (xsh.length === 0) {
      resetRows(null, null, [{ kind: "no_xsh", detail: "" }]);
      return;
    }
    // Xshell's key manager lives in a sibling UserKeys folder — files are
    // named after the key, so a whole-directory drag carries the private
    // keys too. Only rssh-parseable PEMs count (SECSH needs an export).
    const nextMap: KeyMap = new Map(keyMap);
    for (const f of files) {
      if (!/UserKeys\//i.test(relOf(f))) continue;
      const text = await f.text();
      if (!looksLikePem(text)) continue;
      const base = f.name.toLowerCase();
      const stem = base.replace(/\.[^.]+$/, "");
      nextMap.set(base, text);
      if (stem !== base) nextMap.set(stem, text);
    }
    keyMap = nextMap;
    keyCount = nextMap.size;
    const available = new Set(nextMap.keys());
    const parsed: MigEntry[] = [];
    const errs: { kind: "no_xsh" | "tabby_parse" | "file_read"; detail: string }[] = [];
    for (const f of xsh) {
      const rel = relOf(f);
      // Sessions 根目录本身没有信息量，剥掉前缀让名字更短
      const relAlias = rel.replace(/^[^/]*Sessions\//i, "");
      try {
        const e = parseXshellSession(decodeFileBytes(await f.arrayBuffer()), relAlias, available);
        if (e) parsed.push(e);
      } catch {
        errs.push({ kind: "file_read", detail: rel });
      }
    }
    resetRows(parsed, { kind: "xshell", detail: String(xsh.length) }, errs);
  }

  async function onKeys(ev: Event) {
    const files = Array.from((ev.currentTarget as HTMLInputElement).files ?? []);
    const map: KeyMap = new Map();
    for (const f of files) {
      const text = await f.text();
      if (looksLikePem(text)) map.set(f.name.toLowerCase(), text);
    }
    keyMap = map;
    keyCount = map.size;
    result = null;
  }

  function chosen(i: number, e: MigEntry): string {
    return keyChoice[i] ?? e.identityFiles[0] ?? (e.inlineKeys.length ? INLINE : "");
  }

  function options(e: MigEntry): { value: string; label: string }[] {
    const opts: { value: string; label: string }[] = [];
    for (const f of e.identityFiles) {
      if (!opts.some((o) => o.value === f)) {
        opts.push({ value: f, label: f.replace(/^.*\//, "") });
      }
    }
    if (e.inlineKeys.length) opts.push({ value: INLINE, label: L.opt_inline });
    opts.push({ value: "", label: L.opt_agent });
    return opts;
  }

  function pick(i: number, value: string) {
    keyChoice = { ...keyChoice, [i]: value };
    result = null;
  }

  function toggle(i: number) {
    const next = new Set(selected);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    selected = next;
  }

  let allChecked = $derived(entries.length > 0 && selected.size === entries.length);
  let headerBox: HTMLInputElement | null = $state(null);
  $effect(() => {
    if (headerBox) headerBox.indeterminate = selected.size > 0 && selected.size < entries.length;
  });

  let resultSection: HTMLElement | null = $state(null);

  async function doExport() {
    if (selected.size === 0) return;
    const payload = entries.map((e, i) => ({
      ...e,
      identityFiles: chosen(i, e) ? [chosen(i, e)] : [],
    }));
    const out = buildRsshImport({
      entries: payload,
      selected: entries.filter((_, i) => selected.has(i)).map((e) => e.alias),
      keyMap,
      defaultUser: defaultUser.trim(),
    });
    result = out;
    // The result block lands below a possibly tall table — without this the
    // click looks like a no-op when it renders off-screen.
    await tick();
    resultSection?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  let jsonText = $derived(result ? JSON.stringify(result.json, null, 2) : "");

  function download() {
    if (!result) return;
    const blob = new Blob([jsonText], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "rssh-migrate.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function copyJson() {
    await navigator.clipboard.writeText(jsonText);
  }

  const bastionOf = (e: MigEntry) => e.proxyJump ?? "—";

</script>

<header>
  <div class="title-row">
    <h1>rssh-migrate</h1>
    <button class="lang" onclick={() => setLang(lang === "zh" ? "en" : "zh")}>
      {lang === "zh" ? "English" : "中文"}
    </button>
  </div>
  <p class="tagline">
    {L.tagline}{L.review_lead}<a href={REPO_URL} target="_blank" rel="noreferrer">{REPO_URL}</a>{L.review_tail}
  </p>
</header>

<section class="sources">
  <label class="card">
    <strong>~/.ssh/config</strong>
    <span>{L.ssh_desc}</span>
    <input type="file" accept=".config,.conf,text/plain" onchange={onSshConfig} />
  </label>
  <label class="card">
    <strong>Xshell</strong>
    <span>{L.xshell_desc}</span>
    <input type="file" webkitdirectory multiple onchange={onXshell} />
  </label>
  <label class="card">
    <strong>Tabby</strong>
    <span>{L.tabby_desc}</span>
    <input type="file" accept=".yaml,.yml" onchange={onTabby} />
  </label>
  <label class="card">
    <strong>{L.keys_title}</strong>
    <span>{L.keys_desc(keyCount)}</span>
    <input type="file" multiple onchange={onKeys} />
  </label>
</section>

{#if parseErrors.length > 0}
  <ul class="errors">
    {#each parseErrors as err}<li>{errText(err)}</li>{/each}
  </ul>
{/if}

{#if entries.length > 0}
  <div class="toolbar">
    <span>{L.toolbar_source}：{sourceLabel} · {L.toolbar_selected(selected.size, entries.length)}</span>
    <label class="default-user">
      {L.default_user}
      <input type="text" bind:value={defaultUser} placeholder={L.default_user_ph} />
    </label>
    <button class="primary" onclick={doExport} disabled={selected.size === 0}>{L.generate}</button>
  </div>

  <div class="table-wrap">
    <table>
      <colgroup>
        <col class="col-check" /><col class="col-alias" /><col class="col-host" />
        <col class="col-user" /><col class="col-key" /><col class="col-bastion" />
      </colgroup>
      <thead>
        <tr>
          <th class="col-check"><input bind:this={headerBox} type="checkbox" checked={allChecked} onchange={() => (selected = allChecked ? new Set() : new Set(entries.map((_, i) => i)))} /></th>
          <th>{L.col_alias}</th><th>{L.col_host}</th><th>{L.col_user}</th><th>{L.col_key}</th><th>{L.col_bastion}</th>
        </tr>
      </thead>
      <tbody>
        {#each entries as e, i (e.alias)}
          <tr class:selected={selected.has(i)} onclick={() => toggle(i)}>
            <td class="col-check"><input type="checkbox" checked={selected.has(i)} onchange={(ev) => { ev.stopPropagation(); toggle(i); }} /></td>
            <td class="alias" title={e.note ? noteText(lang, e.note) : ""}>{e.alias}{#if e.note}<span class="note" title={noteText(lang, e.note)}>!</span>{/if}</td>
            <td class="mono">{e.hostname || "—"}:{e.port}</td>
            <td class="mono">{e.user ?? "—"}</td>
            <td>
              <select value={chosen(i, e)} onclick={(ev) => ev.stopPropagation()} onchange={(ev) => { ev.stopPropagation(); pick(i, ev.currentTarget.value); }}>
                {#each options(e) as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
              </select>
            </td>
            <td class="mono" title={e.proxyJump ?? ""}>{bastionOf(e)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

{#if result}
  <section class="result" bind:this={resultSection}>
    <h2>{L.result_title(result.json.profiles.length, result.json.credentials.length)}</h2>
    {#if result.errors.length > 0}
      <ul class="errors">
        {#each result.errors as err}
          <li>
            {err.alias}：
            {err.kind === "missing_user" ? L.err_missing_user : L.err_no_key_content}
          </li>
        {/each}
      </ul>
    {/if}
    <p>{L.result_hint}</p>
    <div class="actions">
      <button class="primary" onclick={download}>{L.download}</button>
      <button onclick={copyJson}>{L.copy}</button>
    </div>
    <details>
      <summary>{L.preview}</summary>
      <pre>{jsonText}</pre>
    </details>
  </section>
{/if}

<style>
  :global(*, *::before, *::after) { box-sizing: border-box; }
  :global(body) {
    margin: 0;
    background: #0b0e13;
    color: #d7dee7;
    font: 14px/1.6 ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  header { padding: 28px 32px 8px; }
  .title-row { display: flex; align-items: center; justify-content: space-between; }
  h1 { margin: 0; font-size: 22px; color: #fff; letter-spacing: 0.5px; }
  .lang { font-size: 12px; padding: 4px 10px; }
  .tagline { margin: 6px 0 0; color: #8b98a8; font-size: 13px; }
  .tagline a { color: #7aa7ff; }

  .sources { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; padding: 16px 32px; }
  .card {
    display: flex; flex-direction: column; gap: 6px;
    padding: 14px; border: 1px solid #1d2530; border-radius: 10px;
    background: #10151d; cursor: pointer;
  }
  .card:hover { border-color: #2b3d55; }
  .card strong { color: #fff; font-size: 14px; }
  .card span { color: #8b98a8; font-size: 12px; }
  .card input { color: #8b98a8; font-size: 12px; }

  .toolbar { display: flex; align-items: center; gap: 16px; padding: 8px 32px; color: #8b98a8; font-size: 13px; flex-wrap: wrap; }
  .default-user { display: flex; align-items: center; gap: 6px; }
  .default-user input { background: #10151d; border: 1px solid #1d2530; color: #d7dee7; border-radius: 6px; padding: 4px 8px; width: 140px; }
  button {
    background: #1a2230; color: #d7dee7; border: 1px solid #2a3648;
    border-radius: 8px; padding: 6px 14px; font-size: 13px; cursor: pointer;
  }
  button:hover { border-color: #3d5a7a; }
  button.primary { background: #1d4ed8; border-color: #1d4ed8; color: #fff; }
  button.primary:disabled { opacity: 0.4; cursor: not-allowed; }

  .table-wrap { margin: 8px 32px; border: 1px solid #1d2530; border-radius: 10px; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; padding: 8px 12px; font-size: 12px; border-bottom: 1px solid #151c26; }
  thead th { color: #8b98a8; font-weight: 600; background: #10151d; position: sticky; top: 0; }
  tbody tr { cursor: pointer; }
  tbody tr:hover, tbody tr.selected { background: #14203a; }
  .col-check { width: 36px; text-align: center; }
  .col-alias { width: 22%; } .col-host { width: 22%; } .col-user { width: 10%; } .col-key { width: 28%; }
  .alias { color: #fff; font-weight: 600; }
  .mono { color: #8b98a8; font-family: ui-monospace, monospace; }
  .note { color: #f5b944; margin-left: 4px; }
  td select {
    width: 100%; background: #10151d; color: #d7dee7; border: 1px solid #1d2530;
    border-radius: 6px; padding: 2px 4px; font-size: 11px; font-family: ui-monospace, monospace;
  }

  .result { padding: 8px 32px 32px; }
  .result h2 { font-size: 15px; color: #fff; }
  .result p { color: #8b98a8; font-size: 13px; }
  .errors { color: #f0a35e; font-size: 12px; margin: 4px 32px; padding-left: 20px; }
  .actions { display: flex; gap: 8px; margin: 10px 0; }
  details { margin-top: 8px; }
  summary { color: #8b98a8; font-size: 13px; cursor: pointer; }
  pre { background: #10151d; border: 1px solid #1d2530; border-radius: 8px; padding: 12px; overflow: auto; max-height: 320px; font-size: 11px; color: #a8b6c6; }
</style>
