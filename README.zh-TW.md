# SubjectBroker

**一個以 subject 綁定、採用 default-deny policy 與 fail-closed audit 的實驗性
context broker。**

[English](README.md) · 繁體中文 · [简体中文](README.zh-CN.md)

> 這是精簡概覽。完整安裝、設定及操作說明請參閱 [English README](README.md)。

目前的 prototype 使用 MCP，但 authority model 本身不依賴特定 protocol。
SubjectBroker 早期以 **ContextGuard** 作為 working name；dated ADR 和保留的 field
evidence 會維持舊名稱，以免改寫歷史紀錄。

SubjectBroker 將每個 server process 固定綁定到一個預先設定的 subject，透過
default-deny policy 判斷讀取權限，並且只有在權限允許及 metadata-only audit
成功寫入後，才會釋放已註冊的資源內容。

> [!WARNING]
> SubjectBroker 是實驗性的 macOS 安全研究原型，不是 production security boundary，
> 也不是通用 Agent sandbox。Broker 本身仍可被直接 filesystem 存取繞過。項目現在有
> 一個實驗性 OpenCode launcher，會在經版本固定測試的 macOS 拓撲中封鎖指定 trust
> root；它不隔離任意 credential、network、process 或未來 macOS 版本。

## 這個項目要解決甚麼問題？

Agent framework 在將工作委派給子 Agent 時，不一定會同時降低權限。

假設父 Agent 同時持有兩條 MCP 連線：

```text
sb-orchestrator → 可以讀取受保護資源
sb-worker       → 不可以讀取受保護資源
```

如果 framework 將父 Agent 的所有 MCP 工具完整交給子 Agent：

```text
父 Agent：orchestrator + worker
└── 子 Agent：orchestrator + worker
```

這個子 Agent 的實際權限就是兩條連線的聯集。即使它原本被稱為「worker」，仍可能
直接使用 `orchestrator` 連線讀取秘密。

SubjectBroker 不依賴 prompt 中的角色名稱。每個 SubjectBroker process 都在啟動時固定
自己的 subject：

```text
orchestrator process → 只代表 orchestrator
worker process       → 只代表 worker
```

呼叫者不能在 `read_resource` request 中自行改成另一個身份。

## SubjectBroker 如何處理一次讀取？

```text
MCP client
   │ read_resource("contract")
   ▼
綁定 subject 的 SubjectBroker process
   │
   ├── 評估明確的 policy rule
   ├── 驗證註冊資源及檔案身份
   ├── 讀取有限大小的 strict UTF-8 內容
   ├── 寫入不包含受保護內容的 audit event
   └── 所有步驟成功後才釋放內容
```

目前實作的 macOS 路徑包括：

- process-level subject binding；
- default-deny policy；
- 使用已註冊的 resource ID，而不是接受任意 filesystem path；
- symlink、檔案替換及 file-identity 檢查；
- 有大小限制的 strict UTF-8 讀取；
- audit failure 時 fail closed；
- denial、error、diagnostic 和 audit 不包含受保護內容；以及
- 明確列出涵蓋及未涵蓋路徑的 capability report。

## 執行邊界一致性測試

在 macOS 上執行：

```bash
npm ci
npm run --silent conformance
```

此命令會執行一個不依賴模型的 finance/support MCP 情境，並輸出帶 schema version 的
JSON 報告。它驗證 SubjectBroker 層的允許、拒絕、隱藏資源直接呼叫、身份偽造及
metadata-only audit；同時明確把 agent harness 的連線隔離、host 直接存取及不可轉移
身份標記為 `not-provided`。

整體 `pass` 只代表已測試的 Broker 路徑通過，不代表完整 Agent sandbox。詳見
[安全邊界說明](docs/security-boundary.md)及
[finance/support 範例](examples/finance-support/README.md)。

另一個不依賴模型的命令會驗證實驗性 host 隔離差異：

```bash
npm run --silent conformance:host
```

它證明 sandbox 內的 probe 無法直接讀取 dedicated trust root 或透過 workspace symlink
繞過限制，同時授權 Broker 路徑仍然可用。報告仍會把 agent harness 標記為
`not-exercised`，把不可轉移身份標記為 `not-provided`。

## 實驗性 host-isolated OpenCode 啟動

```bash
examples/finance-support/scripts/prepare.sh

OPENCODE_BIN=/absolute/path/to/opencode \
  examples/finance-support/scripts/launch-opencode-isolated.sh finance-agent
```

Trusted launcher 會在 sandbox 外啟動已綁定 subject 的 Broker；OpenCode 只取得通往
owner-only Unix socket 的 stdio relay，不會取得 policy、storage、audit 或 subject
啟動參數。Policy、storage 和 audit 必須位於 workspace 外同一個 dedicated trust root，
該 root 會被禁止讀取及寫入。已有 hard link 的 registered resource 會被拒絕，因為
path-based sandbox 無法安全封鎖這類 alias。

Apple 已把 `sandbox-exec` 標記為 deprecated，因此這只是版本固定的研究證據，不是可攜
的 production sandbox。Socket 仍是可轉移的本地 capability，也不提供通用 credential、
process 或 network 隔離。

## 實際測試過的 Agent 行為

以下結果都綁定到特定版本，不代表未來版本一定維持相同行為。

| Agent harness | 測試中觀察到的 delegation 行為 | 不同 subject 的建議拓撲 |
| --- | --- | --- |
| Claude Code 2.1.220 | 預設子 Agent 繼承父 Agent 的 MCP 權限 | 使用 persistent named custom subagent，並設定明確的 MCP `tools` allowlist |
| Codex CLI 0.144.4 | Native child 繼承父 Agent 的 MCP 連線 | 每個 subject 使用獨立 process 和 `CODEX_HOME`；已測試至第二層 delegation |
| Hermes Agent 0.19.0 | Native delegation 繼承 profile 內的連線 | 每個 subject 使用獨立的 top-level process/profile |
| Pi 0.82.1 | 測試版本沒有 native subagent 機制 | 使用獨立 single-subject process；直接讀取路徑仍需要 sandbox |
| OpenCode 1.18.10 | 內置 `general` 繼承父 Agent 權限；named exact allowlist 會拒絕排除的工具 | 每層 delegation 都使用 wildcard deny 和 exact MCP-tool allowlist；已測試至第二層 |

完整限制和部署方式請參考：

- [Claude Code integration](docs/integration-claude-code.md)
- [Codex integration](docs/integration-codex.md)
- [Hermes integration](docs/integration-hermes.md)
- [Pi integration](docs/integration-pi.md)
- [OpenCode integration](docs/integration-opencode.md)

## 五分鐘示範

目前所有 security、integration 與 demo 驗證均在 macOS 完成。在其他平台上，
hard-enforcement path 和 demo 會以 `PLATFORM_UNSUPPORTED` fail closed，不會宣稱未經
驗證的 security boundary。

執行目前的 demo 需要安裝：

- Node.js 20 或更新版本；以及
- npm。

```bash
npm ci
npm run demo
```

預期結果：

```text
SubjectBroker subject-bound read demo

orchestrator → {"decision":"allow","reasonCode":"ALLOWED","resourceId":"secret","content":"SUBJECT_BROKER_DEMO_SECRET\n"}
worker       → {"decision":"deny","reasonCode":"ACCESS_DENIED","resourceId":"secret"}

Both outcomes were written to separate metadata-only audit logs.
```

Demo 會建立一個臨時受保護資源、同一份 policy，以及兩個分別綁定
`orchestrator` 和 `worker` 的 Broker。結束時會清理臨時檔案。

執行全部 unit、integration 和 security tests：

```bash
npm test
```

## SubjectBroker 不能做甚麼？

SubjectBroker 目前不提供：

- 可攜、production-supported 的 OS sandboxing 或 mandatory routing；
- ADR-027 指定 trust root 和 launcher 拓撲之外的 direct-path protection；
- 通用 shell、network、browser、clipboard、credential 或 process isolation；
- encryption、redaction、classification、search 或 write operation；
- daemon 或 cloud control plane；以及
- 保證第三方 Agent framework 正確隔離自己的 delegated context。

最重要的部署條件是：

> 每個 Agent context 只能看見屬於其 assigned subject 的 SubjectBroker 連線。

如果同一個 context 可以看見多個 subject-bound connections，它的實際權限就是這些
連線的聯集。SubjectBroker 無法從第三方 harness 內部修復這種錯誤配置。

## 證據與項目狀態

SubjectBroker 目前是 **experimental、working、attack-tested research prototype**。

- [Threat model](THREAT_MODEL.md)
- [Architecture decisions](DECISIONS.md)
- [Questions answered and still open](QUESTIONS.md)
- [Multi-agent field evidence](docs/field-evidence-2026-07-28.md)
- [Evidence minimization policy](results/README.md)
- [Claude Code confirmation results](results/claude-code-confirmation/RESULTS.md)
- [Codex confirmation results](results/codex-confirmation/RESULTS.md)

公開 field evidence 只保留與結論有關的 prompts、actor relationships、tool events、
normalized configuration 和 Broker audits。帳戶、本機、plugin、session、request、
thinking signature 及其他無關 provider metadata 不會公開。

ADR-027 的 direct-read 結果只適用於其明確測試的 deprecated macOS 機制。在
production 使用前，仍需採用受支援的 host-isolation 設計並重新進行安全審查。

Contribution 請參考 [CONTRIBUTING.md](CONTRIBUTING.md)，潛在漏洞請依照
[SECURITY.md](SECURITY.md) 私下回報。

本項目採用 [Apache License 2.0](LICENSE)。
