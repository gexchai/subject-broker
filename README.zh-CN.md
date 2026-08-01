# SubjectBroker

**一个与 subject 绑定、采用 default-deny policy 和 fail-closed audit 的实验性
context broker。**

[English](README.md) · [繁體中文](README.zh-TW.md) · 简体中文

> 这是精简概览。完整安装、配置和操作说明请参阅 [English README](README.md)。

当前 prototype 使用 MCP，但 authority model 本身不依赖特定 protocol。
SubjectBroker 早期使用 **ContextGuard** 作为 working name；dated ADR 和保留的 field
evidence 会维持旧名称，以免改写历史记录。

SubjectBroker 将每个 server process 固定绑定到一个预先配置的 subject，通过
default-deny policy 判断读取权限，并且只有在权限允许且 metadata-only audit
成功写入后，才会释放已注册的资源内容。

> [!WARNING]
> SubjectBroker 是实验性的 macOS 安全研究原型，不是 production security boundary，
> 也不是 Agent sandbox。如果 Agent 本身拥有直接访问 filesystem、shell、network、
> browser、credential 或其他 process 的能力，它仍然可能绕过 Broker。这些路径必须由
> OS-level sandbox 或 container 等隔离机制控制。

## 这个项目要解决什么问题？

Agent framework 在把工作委派给子 Agent 时，不一定会同时降低权限。

假设父 Agent 同时持有两条 MCP 连接：

```text
sb-orchestrator → 可以读取受保护资源
sb-worker       → 不可以读取受保护资源
```

如果 framework 将父 Agent 的所有 MCP 工具完整交给子 Agent：

```text
父 Agent：orchestrator + worker
└── 子 Agent：orchestrator + worker
```

这个子 Agent 的实际权限就是两条连接的并集。即使它原本被称为“worker”，仍然可能
直接使用 `orchestrator` 连接读取秘密。

SubjectBroker 不依赖 prompt 中的角色名称。每个 SubjectBroker process 都会在启动时
固定自己的 subject：

```text
orchestrator process → 只代表 orchestrator
worker process       → 只代表 worker
```

调用方不能在 `read_resource` request 中自行切换成另一个身份。

## SubjectBroker 如何处理一次读取？

```text
MCP client
   │ read_resource("contract")
   ▼
绑定 subject 的 SubjectBroker process
   │
   ├── 评估明确的 policy rule
   ├── 验证注册资源和文件身份
   ├── 读取大小受限的 strict UTF-8 内容
   ├── 写入不包含受保护内容的 audit event
   └── 所有步骤成功后才释放内容
```

目前实现的 macOS 路径包括：

- process-level subject binding；
- default-deny policy；
- 使用已注册的 resource ID，而不是接受任意 filesystem path；
- symlink、文件替换和 file-identity 检查；
- 有大小限制的 strict UTF-8 读取；
- audit failure 时 fail closed；
- denial、error、diagnostic 和 audit 不包含受保护内容；以及
- 明确列出已覆盖和未覆盖路径的 capability report。

## 运行边界一致性测试

在 macOS 上运行：

```bash
npm ci
npm run --silent conformance
```

命令会执行一个不依赖模型的 finance/support MCP 场景，并输出带 schema version 的 JSON
报告。它验证 SubjectBroker 层的允许、拒绝、隐藏资源直接调用、身份伪造和 metadata-only
audit；同时明确把 agent harness 的连接隔离、host 直接访问和不可转移身份标记为
`not-provided`。

整体 `pass` 只代表已测试的 Broker 路径通过，不代表完整 Agent sandbox。详见
[安全边界说明](docs/security-boundary.md)和
[finance/support 示例](examples/finance-support/README.md)。

## 实际测试过的 Agent 行为

以下结果都绑定到特定版本，不代表未来版本一定保持相同行为。

| Agent harness | 测试中观察到的 delegation 行为 | 不同 subject 的建议拓扑 |
| --- | --- | --- |
| Claude Code 2.1.220 | 默认子 Agent 继承父 Agent 的 MCP 权限 | 使用 persistent named custom subagent，并设置明确的 MCP `tools` allowlist |
| Codex CLI 0.144.4 | Native child 继承父 Agent 的 MCP 连接 | 每个 subject 使用独立 process 和 `CODEX_HOME`；已测试到第二层 delegation |
| Hermes Agent 0.19.0 | Native delegation 继承 profile 内的连接 | 每个 subject 使用独立的 top-level process/profile |
| Pi 0.82.1 | 测试版本没有 native subagent 机制 | 使用独立 single-subject process；直接读取路径仍然需要 sandbox |

完整限制和部署方式请参考：

- [Claude Code integration](docs/integration-claude-code.md)
- [Codex integration](docs/integration-codex.md)
- [Hermes integration](docs/integration-hermes.md)
- [Pi integration](docs/integration-pi.md)

## 五分钟演示

目前所有 security、integration 和 demo 验证均在 macOS 完成。在其他平台上，
hard-enforcement path 和 demo 会以 `PLATFORM_UNSUPPORTED` fail closed，不会宣称未经
验证的 security boundary。

运行当前 demo 需要安装：

- Node.js 20 或更高版本；以及
- npm。

```bash
npm ci
npm run demo
```

预期结果：

```text
SubjectBroker subject-bound read demo

orchestrator → {"decision":"allow","reasonCode":"ALLOWED","resourceId":"secret","content":"SUBJECT_BROKER_DEMO_SECRET\n"}
worker       → {"decision":"deny","reasonCode":"ACCESS_DENIED","resourceId":"secret"}

Both outcomes were written to separate metadata-only audit logs.
```

Demo 会创建一个临时受保护资源、同一份 policy，以及两个分别绑定
`orchestrator` 和 `worker` 的 Broker。结束时会清理临时文件。

运行全部 unit、integration 和 security tests：

```bash
npm test
```

## SubjectBroker 不能做什么？

SubjectBroker 目前不提供：

- OS sandboxing；
- 强制 Agent 的所有读取都必须经过 Broker；
- 防止直接使用 filesystem、shell、network、browser、clipboard、credential 或
  process；
- encryption、redaction、classification、search 或 write operation；
- daemon 或 cloud control plane；以及
- 保证第三方 Agent framework 正确隔离自己的 delegated context。

最重要的部署条件是：

> 每个 Agent context 只能看到属于其 assigned subject 的 SubjectBroker 连接。

如果同一个 context 可以看到多个 subject-bound connections，它的实际权限就是这些
连接的并集。SubjectBroker 无法从第三方 harness 内部修复这种错误配置。

## 证据与项目状态

SubjectBroker 目前是 **experimental、working、attack-tested spike**。

- [Threat model](THREAT_MODEL.md)
- [Architecture decisions](DECISIONS.md)
- [Questions answered and still open](QUESTIONS.md)
- [Multi-agent field evidence](docs/field-evidence-2026-07-28.md)
- [Evidence minimization policy](results/README.md)
- [Claude Code confirmation results](results/claude-code-confirmation/RESULTS.md)
- [Codex confirmation results](results/codex-confirmation/RESULTS.md)

公开 field evidence 只保留与结论有关的 prompts、actor relationships、tool events、
normalized configuration 和 Broker audits。账户、本机、plugin、session、request、
thinking signature 和其他无关 provider metadata 不会公开。

在 production 使用前，direct-read path 必须由经过独立验证的 OS sandbox 关闭，并
重新进行安全审查。

Contribution 请参考 [CONTRIBUTING.md](CONTRIBUTING.md)，潜在漏洞请按照
[SECURITY.md](SECURITY.md) 私下报告。

本项目采用 [Apache License 2.0](LICENSE)。
