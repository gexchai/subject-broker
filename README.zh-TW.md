# SubjectBroker

**一個以 subject 綁定、採用 default-deny policy 與 fail-closed audit 的實驗性
context broker。**

[English](README.md) · 繁體中文 · [简体中文](README.zh-CN.md)

目前的 prototype 使用 MCP，但 authority model 本身不依賴特定 protocol。
SubjectBroker 早期以 **ContextGuard** 作為 working name；dated ADR 和保留的 field
evidence 會維持舊名稱，以免改寫歷史紀錄。

SubjectBroker 將每個 server process 固定綁定到一個預先設定的 subject，透過
default-deny policy 判斷讀取權限，並且只有在權限允許及 metadata-only audit
成功寫入後，才會釋放已註冊的資源內容。

> [!WARNING]
> SubjectBroker 是實驗性的 macOS 安全研究原型，不是 production security boundary，
> 也不是 Agent sandbox。如果 Agent 本身擁有直接存取 filesystem、shell、network、
> browser、credential 或其他 process 的能力，它仍可能繞過 Broker。這些路徑必須由
> OS-level sandbox 或 container 等隔離機制控制。

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

## 實際測試過的 Agent 行為

以下結果都綁定到特定版本，不代表未來版本一定維持相同行為。

| Agent harness | 測試中觀察到的 delegation 行為 | 不同 subject 的建議拓撲 |
| --- | --- | --- |
| Claude Code 2.1.220 | 預設子 Agent 繼承父 Agent 的 MCP 權限 | 使用 persistent named custom subagent，並設定明確的 MCP `tools` allowlist |
| Codex CLI 0.144.4 | Native child 繼承父 Agent 的 MCP 連線 | 每個 subject 使用獨立 process 和 `CODEX_HOME`；已測試至第二層 delegation |
| Hermes Agent 0.19.0 | Native delegation 繼承 profile 內的連線 | 每個 subject 使用獨立的 top-level process/profile |
| Pi 0.82.1 | 測試版本沒有 native subagent 機制 | 使用獨立 single-subject process；直接讀取路徑仍需要 sandbox |

完整限制和部署方式請參考：

- [Claude Code integration](docs/integration-claude-code.md)
- [Codex integration](docs/integration-codex.md)
- [Hermes integration](docs/integration-hermes.md)
- [Pi integration](docs/integration-pi.md)

## 五分鐘示範

需要：

- macOS；
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

- OS sandboxing；
- 強迫 Agent 的所有讀取都必須經過 Broker；
- 防止直接使用 filesystem、shell、network、browser、clipboard、credential 或
  process；
- encryption、redaction、classification、search 或 write operation；
- daemon 或 cloud control plane；以及
- 保證第三方 Agent framework 正確隔離自己的 delegated context。

最重要的部署條件是：

> 每個 Agent context 只能看見屬於其 assigned subject 的 SubjectBroker 連線。

如果同一個 context 可以看見多個 subject-bound connections，它的實際權限就是這些
連線的聯集。SubjectBroker 無法從第三方 harness 內部修復這種錯誤配置。

## 證據與項目狀態

SubjectBroker 目前是 **experimental、working、attack-tested spike**。

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

在 production 使用前，direct-read path 必須由獨立驗證的 OS sandbox 關閉，並重新
進行安全審查。

Contribution 請參考 [CONTRIBUTING.md](CONTRIBUTING.md)，潛在漏洞請依照
[SECURITY.md](SECURITY.md) 私下回報。

本項目採用 [Apache License 2.0](LICENSE)。
