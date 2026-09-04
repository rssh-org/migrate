# rssh-migrate

[中文](#中文) · [English](#english)

## 中文

把 Xshell / Tabby / `~/.ssh/config` 的连接配置转成 [rssh](https://github.com/rssh-org/rssh) 可导入的 JSON。**纯静态页面,全程在浏览器本地完成,零网络请求** — 主机名、用户名、密钥都不会离开你的机器。

### 使用

1. 打开 `dist/index.html`(单文件,可直接双击打开,也可挂任意静态托管),右上角可切换中英文。
2. 选择来源:
   - **~/.ssh/config** — 单文件。支持 `Host *` 默认段继承、多把 `IdentityFile` 组成的密钥池(下拉选择)、`ProxyJump` 堡垒自动关联(含 `j1,j2` 多跳与 `user@host:port` 形式)。跳板目标没有自己的 Host 块时(只被通配段罩着),按通配段自动补全一行 —— 跳板写法里的 user/port 优先,与 ssh 解析跳板时看到的完全一致。
   - **Xshell** — 选择 `Sessions` 文件夹(可整个目录拖入)。子目录会变成名称前缀。
   - **Tabby** — `~/.config/tabby/config.yaml`。内置私钥(privateKeys 中粘贴的 PEM)直接迁移进 JSON。
3. (可选)挑选私钥文件:按文件名与 IdentityFile 匹配,PEM 内容直接写入 JSON,rssh 导入后即可免重选;未挑选或匹配不到的密钥回退 ssh-agent 认证。
4. 勾选条目、检查每行的密钥下拉(默认池中第一把,即 OpenSSH 实际先尝试的),生成 JSON。
5. 在 rssh 中:设置 → 导入导出 → 导入文件。增量合并,不影响已有数据。

### 明确不做的事

- **密码不迁移**。Xshell/Tabby 的密码是加密存储,网页不做解密;导入后连接时 rssh 会交互询问。
- **Xshell 用户密钥**:密钥管理器存放在 `Documents\NetSarang Computer\<版本>\Xshell\UserKeys`(文件名即密钥名)。**把整个 Xshell 目录拖进来**(含 Sessions 与 UserKeys)即可按名字自动接回私钥;若密钥是 NetSarang/SECSH 私有格式,需先在密钥管理器里导出为 OpenSSH 格式(条目上有 ! 标记提醒)。
- ssh config 的 `Include` 指令暂不拼接,请先合并为单文件。

### 产品规则

1. **定位**:新用户从其它软件一次性迁移到 rssh。每次生成都铸造全新 UUID ——
   同一份 JSON 重复导入,rssh 按 id 覆盖不重复;重新生成则是新 id。
   工具不做跨会话去重,不用担心多次生成导致数据膨胀。
2. **交互**:先 parse,用户勾选条目、为每行选择 identity(池中某把 / 内置密钥 / agent)后,
   一次性生成 JSON。
3. **输出去重**:多个 profile 引用同一凭证时,输出里只有一个凭证
   (按 `(用户名, 密钥)` 合并,内置密钥按内容区分);堡垒机同理 ——
   被多个目标共享或自身也被勾选,都只产生一行 profile。

以上规则由 `src/lib/rssh.test.ts` 钉死(堡垒两条件、`ProxyJump` 剥壳与多跳方向、
凭证去重矩阵、8 跳上限、逐次生成全新 UUID)。

### 开发

```sh
npm install
npm test     # vitest
npm run dev  # 开发服务器
npm run build  # 产出单文件 dist/index.html
```

---

## English

Converts connection configs from Xshell / Tabby / `~/.ssh/config` into JSON that [rssh](https://github.com/rssh-org/rssh) can import. **A purely static page — everything runs locally in your browser, zero network requests.** Hostnames, usernames and keys never leave your machine. Toggle Chinese/English in the top-right corner.

### Usage

1. Open `dist/index.html` (a single file — double-click it, or host it anywhere static).
2. Pick a source:
   - **~/.ssh/config** — a single file. Supports `Host *` defaults inheritance, identity pools made of multiple `IdentityFile`s (dropdown pick), and automatic `ProxyJump` bastion linking (including `j1,j2` chains and `user@host:port` forms). A jump target with no `Host` block of its own (covered only by wildcards) is synthesized from those wildcard blocks — the user/port written in the jump win, exactly what ssh itself sees when resolving the hop.
   - **Xshell** — pick your `Sessions` folder (dragging the whole directory works). Subfolders become name prefixes.
   - **Tabby** — `~/.config/tabby/config.yaml`. Embedded private keys (PEMs pasted into privateKeys) migrate straight into the JSON.
3. (Optional) Pick private-key files: they are matched to IdentityFile entries by filename and their PEM content is written into the JSON, so rssh needs no re-picking after import. Unpicked or unmatched keys fall back to ssh-agent auth.
4. Check entries, review each row's key dropdown (defaults to the first in the pool — the one OpenSSH actually tries first), generate the JSON.
5. In rssh: Settings → Import/Export → Import file. Merges incrementally; existing data is untouched.

### Deliberately not done

- **Passwords are not migrated.** Xshell/Tabby store them encrypted; this page does not decrypt anything. rssh prompts interactively on connect.
- **Xshell user keys** live in the key manager at `Documents\NetSarang Computer\<version>\Xshell\UserKeys` (files are named after the keys). **Drag the whole Xshell directory in** (Sessions + UserKeys) and keys are re-attached by name. Keys in NetSarang/SECSH private format must be exported as OpenSSH from the key manager first (flagged with a `!` on the row).
- `Include` directives in ssh configs are not spliced — merge into a single file first.

### Product rules

1. **Positioning**: a one-shot migration tool for new users moving to rssh. Every
   generation mints fresh UUIDs — re-importing the same JSON overwrites by id
   without duplicating; regenerating produces new ids. The tool never dedupes
   across sessions, so repeated use cannot bloat your data.
2. **Interaction**: parse first; the user checks entries and picks an identity per
   row (a pool key / an embedded key / agent), then generates the JSON once.
3. **Output dedup**: profiles sharing a credential get exactly one credential in
   the output (merged by `(username, key)`, embedded keys by content); bastions
   likewise — shared by several targets or checked itself, still one profile row.

These rules are pinned by `src/lib/rssh.test.ts` (the two bastion conditions,
`ProxyJump` decoration stripping and chain direction, the credential dedup
matrix, the 8-hop cap, fresh UUIDs per generation).

### Development

```sh
npm install
npm test     # vitest
npm run dev  # dev server
npm run build  # emits the single-file dist/index.html
```
