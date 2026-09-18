# WorkBuddy 连接器市场上线材料包说明

本目录是针对帮图CAD建筑图纸解析的 WorkBuddy 连接器市场上线材料，按 [连接器接入文档](https://open.workbuddy.cn/docs/connector) 整理生成。

## 接入方案

- **方案**：MCP + Skill（推荐），远程服务使用 Streamable HTTP（`/mcp`）。
- **凭证形态**：公开远端 MCP + 工具参数凭证。帮图 MCP 服务连接本身无需鉴权，业务凭证 `apiKey` 在**每次工具调用时作为参数**传入，由服务端转发为上游 `apiKey` 请求头。这一形态与当前服务端实现（`src/index.ts`）完全一致，**无需改动服务端代码**。

> 说明：本材料选择「公开远端 + 工具参数凭证」，而不是 WorkBuddy 文档中的「用户自填 Token（`auth_mode=token`）」模式。原因是当前服务端从工具参数读取 `apiKey`，并不读取请求头/环境变量；若走 token 模式，需要改服务端以支持从请求头读取（见文末“可选演进”）。

## 本版临时凭证（重要）

本版（1.0.0）`mcp.json` 内置了固定测试 `apiKey`（`btzlbnfhwr1dkndirgq5h6gy3838b8rh`），便于评审与联调，不需要用户每次手动传 Key。该值来自 README 测试配置，**并非客户生产凭证**。

- **正式版必须处理**：将 `mcp.json` 中的 `apiKey` 字段删除，或改为用户自填 Key（可演进为自填 Token 模式，见「可选演进」）。
- **风险提示**：该 Key 属于凭证，**不要写进任何公开分发文档**。若声明了 `headers` 注入，请确保使用占位符而非明文 Key。

## 目录结构

```
connector-market/
├── connector-meta.json      # 连接器元信息（必须）
├── mcp.json                 # MCP Server 连接配置（必须）
├── icon.svg                 # 市场图标（必须）
├── skills/
│   └── bangtu-open-api/
│       └── SKILL.md         # AI 使用说明（推荐，含全部 12 个工具）
└── SUBMISSION_NOTES.md      # 本说明文件（可不上传，仅辅助对齐）
```

## 各文件要点

| 文件 | 内容 |
| --- | --- |
| `connector-meta.json` | `source=bangtu-open-api`（kebab-case）、`type=mcp`、`version=1.0.0`、`minWorkbuddyVersion=4.24.0`（因使用了 `examples_zh/en`，该字段 4.24.0 起必填）、中英文名称/描述/示例均已填写。未声明 `auth_mode`（连接无需鉴权）。 |
| `mcp.json` | 远端地址 `https://mcp.bangtu-ai.com/mcp`。本版内置固定测试 `apiKey`（README 测试配置值 `btzlbnfhwr1dkndirgq5h6gy3838b8rh`）用于联调，详见「本版临时凭证」。正式版应移除该字段，改为用户自填 Key。 |
| `icon.svg` | 64×64 透明背景的简洁图标（蓝色圆角底 + 建筑图纸线稿 + 放大镜）。 |
| `skills/bangtu-open-api/SKILL.md` | 覆盖 12 个工具的参数、典型示例、返回格式、异常处理与安全提醒。电气、暖通按「先项目级聚合预处理、再逐图框识别」的顺序说明。明确 `apiKey` 以工具参数传入。 |
| `SUBMISSION_NOTES.md` | 本说明文件。 |

## 审核要点

| 检查项 | 状态 |
| --- | --- |
| 已选 MCP + Skill，目录结构符合规范 | ✅ |
| `source` 使用 kebab-case 且全局唯一 | ✅（`bangtu-open-api`，如被占用改 `bangtu-dwg-recognizer`） |
| 名称、描述、中英文示例完整 | ✅ |
| MCP 仅配置一个 Server，远程地址使用 HTTPS | ✅ |
| 未在任何文件中硬编码生产 Token/密钥 | ⚠️（`mcp.json` 内置 README 测试 Key `btzlbnfhwr1dkndirgq5h6gy3838b8rh`，仅本版联调用，正式版必须移除或改为用户自填，见「本版临时凭证」） |
| Skill 覆盖全部核心能力 | ✅ |
| 图标清晰、版本声明正确 | ✅ |

## 使用流程（面向最终用户）

- 用户在对话中提供自己的帮图 `apiKey`（收费环境建议一客户一 Key）。
- AI 按 `SKILL.md` 调用工具时，把 `apiKey` 作为工具参数传入。
- 调用链：`bangtu_create_dwg_task` → 轮询（`bangtu_get_task_status` / `bangtu_wait_task`）→ `bangtu_get_frame_result` → 各专业创建任务工具（`bangtu_create_architecture_task` / `bangtu_create_plumbing_task` / `bangtu_create_structure_task`，电气与暖通需先分别调用 `bangtu_create_electrical_pre_task` / `bangtu_create_hvac_pre_task` 完成项目级聚合预处理后再调用 `bangtu_create_electrical_task` / `bangtu_create_hvac_task`）→ 轮询 → `bangtu_get_cv_result`。

## 可选演进（如后续需要）

若希望用户在连接器市场里「填一次 Key 即自动注入、无需每次传参」，可改为 WorkBuddy 自填 Token 模式。需：

1. `src/index.ts` 增加从请求头读取 `apiKey` 的逻辑（优先取请求头，退化到工具参数）。
2. `connector-meta.json` 声明 `"auth_mode": "token"`，并声明 `minWorkbuddyVersion >= 4.23.0`。
3. 新增 `token-schema.json`（字段 `key` 与 `mcp.json` 中 `${apiKey}` 对应，`type=password`）。
4. `mcp.json` 的 `headers` 注入 `apiKey: ${apiKey}`。

## 其他合规提醒

- 上线后每次更新需重新提交审核；审核通过后通常 10~15 分钟同步生效。
- MCP 单次请求建议 30 秒内响应、服务可用性建议 ≥ 99.9%；复杂 DWG 属于异步长任务，已用轮询而非同步等待。
- 如需 PNG/JPG 图标，可由 `icon.svg` 转出，文件名须为 `icon.{svg|png|jpg}`。
- 如日后同一服务同时提供 OAuth 与 Token 两种方式，必须拆成两个不同 `source` 的连接器。
