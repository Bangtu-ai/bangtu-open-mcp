# 帮图开放 API MCP 服务介绍

## 当前接入与部署说明

### 正式 MCP 地址

| 协议 | 地址 | 使用场景 |
| --- | --- | --- |
| Streamable HTTP（新版，推荐） | `https://mcp.bangtu-ai.com/mcp` | 支持新版 MCP Streamable HTTP 的客户端 |
| Legacy SSE（旧版兼容） | `https://mcp.bangtu-ai.com/sse` | 尚未支持 Streamable HTTP 的旧版客户端 |
| 健康检查 | `https://mcp.bangtu-ai.com/health` | 仅检查服务状态，不是 MCP Endpoint |

### 正式客户端配置

```json
{
  "mcpServers": {
    "bangtu-api": {
      "url": "https://mcp.bangtu-ai.com/mcp",
      "apiKey": "请填入您的apiKey"
    }
  }
}
```

### 测试客户端配置

```json
{
  "mcpServers": {
    "bangtu-api-test": {
      "url": "https://mcp.bangtu-ai.com/mcp",
      "apiKey": "btzlbnfhwr1dkndirgq5h6gy3838b8rh"
    }
  }
}
```

测试配置仅用于评估和联调，正式使用请切换为专属客户 API Key。`bangtu-api` 和 `bangtu-api-test` 只是客户端显示名称，实际连接地址由 `url` 决定。

### 旧版 SSE 客户端配置

旧客户端不支持 Streamable HTTP 时，将地址改为 `/sse`：

```json
{
  "mcpServers": {
    "bangtu-api": {
      "url": "https://mcp.bangtu-ai.com/sse",
      "apiKey": "请填入您的apiKey"
    }
  }
}
```

### 本地测试配置

```json
{
  "mcpServers": {
    "bangtu-local": {
      "url": "http://localhost:3000/mcp",
      "apiKey": "请填入您的apiKey"
    }
  }
}
```

`apiKey` 作为 MCP 工具调用参数使用，服务端会将其转发为帮图上游 API 的 `apiKey` 请求头；不应拼接到 MCP URL 查询参数中。

### 真实线上连通性验证

已实际请求正式服务：

```text
GET https://mcp.bangtu-ai.com/health
HTTP/1.1 200 OK
```

实际返回：

```json
{"ok":true,"service":"bangtu-open-api-mcp","version":"1.0.0"}
```

已向 `https://mcp.bangtu-ai.com/mcp` 发起 MCP `initialize` 握手，返回 `HTTP/1.1 200 OK`，协议版本为 `2025-06-18`，服务名称为 `bangtu-open-api`，服务版本为 `1.0.0`，可以正常建立 MCP 会话。

### 源码部署

环境要求：Node.js 20 或更高版本。完整源码部署必须先安装依赖：

```bash
npm install
cp .env.example .env
npm run build
npm start
```

项目包含 `package-lock.json` 时，生产环境可以使用 `npm ci` 替代 `npm install`。Windows PowerShell 可使用 `Copy-Item .env.example .env`。

如果使用已经生成好的发布目录，至少需要提供 `dist/`、`public/`、`package.json`、`package-lock.json` 和 `.env`，然后执行：

```bash
npm ci --omit=dev
npm start
```

不能只复制 `dist/` 后执行 `npm start`，运行时仍需要安装 `@modelcontextprotocol/sdk`、`cors`、`dotenv`、`express` 和 `zod` 等生产依赖。

### Docker 部署

项目已提供 `Dockerfile`：

```bash
docker build -t bangtu-open-mcp .
docker run -d --name bangtu-open-mcp -p 3000:3000 --env-file .env bangtu-open-mcp
```

当前 Dockerfile 使用 Node.js 22.19.0 基础镜像，构建阶段执行 `npm install` 和 `npm run build`，运行阶段使用 `pm2-runtime dist/index.js`。`.env` 不写入镜像，通过 `--env-file .env` 或平台环境变量注入。容器内部端口为 `3000`，公网部署时将 `/mcp`、`/sse` 和 `/health` 转发到该端口。

## 一、服务名称

**中文名称：** 帮图工程图纸智能解析 MCP

**英文名称：** Bangtu Engineering Drawing Intelligence MCP

**服务标识建议：** `bangtu-api`

**服务类型：** Model Context Protocol（MCP）远程服务

**服务提供方：** 帮图科技（BANGTU TECHNOLOGY）

**官方服务地址：** `https://mcp.bangtu-ai.com/mcp`

**兼容地址（旧版 SSE 客户端）：** `https://mcp.bangtu-ai.com/sse`

**官方网站：** `https://bangtu-ai.com`

**API 文档：** `https://apidoc.bangtu-ai.com`

## 二、服务简介

帮图工程图纸智能解析 MCP，是面向 AI Agent、智能设计助手、工程审查系统和企业自动化工作流的远程 MCP 服务。

该服务将帮图的 DWG 工程图纸解析能力封装为标准化 MCP 工具，使支持 MCP 的大模型或智能体可以直接完成以下工作：

- 上传或读取 DWG 图纸；
- 创建图纸预处理和识别任务；
- 查询异步任务执行状态；
- 获取图框、图签、坐标等图纸基础信息；
- 根据图框创建建筑专业构件识别任务；
- 获取轴号、房间、门窗、楼梯、文字、立面、剖面和详图等结构化建筑解析结果。

调用方不需要自行拼接上游 API 路径，也不需要处理不同接口之间的请求方式差异。MCP 服务已经将上游接口基础地址、认证 Header、请求方法、参数名称、任务状态和结果路径固化在工具定义中，AI Agent 可以根据工具描述自动完成多步骤调用。

## 三、核心价值

### 1. 让 AI 能够理解 DWG 工程图纸

将传统 CAD 图纸中的图框、图签、图层和工程构件信息转换为 AI 可以读取和继续处理的结构化数据，帮助智能体参与设计辅助、图纸审查、工程信息提取和数据归档。

### 2. 面向 Agent 的任务流程设计

DWG 解析通常是异步任务。服务通过清晰的任务创建、状态查询、等待和结果获取工具，引导 Agent 正确处理长耗时任务，避免将任务创建成功误判为识别完成。

### 3. 固化真实 API 契约

MCP 服务内部已经固化以下真实上游契约：

- API 基础地址：`https://openapi.bangtu-ai.com/openApi/`
- 认证 Header：`apiKey: {客户 API Key}`
- 统一响应结构：`{ code, message, data, timestamp }`
- 业务成功条件：`code === 200`
- 任务状态：`RUNNING`、`SUCCESS`、`FAILED`
- DWG 上传方式：`multipart/form-data`，字段名为 `file`

Agent 不需要知道上述底层细节即可使用 MCP 工具。

### 4. 适合企业集成

服务可以接入支持 MCP 的 AI 客户端、企业知识助手、工程设计平台、自动化编排系统和内部 Agent 平台。客户可以使用自己的 API Key，服务端不会配置、保存或打印客户业务 API Key。

## 四、适用场景

### 工程设计辅助

通过自然语言让 AI 查询图纸中的房间、门窗、楼梯、轴号、文字和图框信息，辅助设计人员快速定位和整理图纸内容。

### 图纸审查辅助

将 DWG 图纸解析结果交给 AI Agent，由 Agent 根据企业规则进行信息核对、完整性检查和审查记录生成。

### 工程数据提取

从图纸中提取图签、图框、坐标、建筑构件和详图数据，用于工程台账、项目归档和数据同步。

### CAD 图纸问答

用户可以直接询问“这张图有哪些房间”“图中有哪些门窗”“某个图框的图签信息是什么”等问题，由 Agent 自动调用对应工具获取结果。

### 企业自动化流程

将图纸解析接入项目管理、设计协同、文档归档、质量检查和工程数据治理流程。

## 五、当前 MCP 工具

当前发布版本注册 6 个工具。

| 工具名称 | 用途 | 计费标识 |
| --- | --- | --- |
| `bangtu_create_dwg_task` | 上传 DWG 并创建图纸基本信息识别任务 | 免费 |
| `bangtu_create_cv_task` | 根据图框创建建筑专业构件识别任务 | 限时免费 |
| `bangtu_get_task_status` | 查询异步任务状态 | 免费 |
| `bangtu_wait_task` | 默认 20 秒、最多 45 秒的短时多次轮询，返回实际查询次数和是否超时 | 免费 |
| `bangtu_get_frame_result` | 获取图框、图签和坐标等基础解析结果 | 免费 |
| `bangtu_get_arch_result` | 获取建筑专业结构化识别结果 | 免费 |

> 以上“免费”和“限时免费”是当前阶段的服务政策标识，具体价格和正式计费规则以帮图官方公布信息为准。

## 六、工具详细说明

### 1. bangtu_create_dwg_task

上传 DWG 图纸并创建图纸基本信息识别任务。

> 重要说明：远程 Agent 优先使用 `fileBase64` 和 `fileName` 传递平台附件内容；本地部署或已有文件地址也可以使用 `filePath` 或 `fileUrl`。这三种参数是本 MCP 工具定义的文件来源参数，不是帮图上游 HTTP API 的原始参数。上游接口真正接收的是 `multipart/form-data` 中名为 `file` 的文件字段，MCP 服务会在内存中还原或读取文件后代替调用方完成上传。

**用途：**

- 创建 PRE 类型图纸预处理任务；
- 读取 DWG 图纸的基础图框信息；
- 为后续图框结果和建筑专业识别提供 taskId。

**输入参数：**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `apiKey` | string | 是 | 客户 API Key，本次调用转发为上游 `apiKey` Header |
| `fileBase64` | string | 与 filePath、fileUrl 三选一 | 远程平台附件的 Base64 内容，可包含或不包含 `data:*;base64,` 前缀，最大约 70 MB Base64 字符 |
| `fileName` | string | 使用 fileBase64 时必填 | DWG 文件名，必须以 `.dwg` 结尾 |
| `filePath` | string | 与 fileBase64、fileUrl 三选一 | MCP 服务所在服务器可读取的本地 `.dwg` 文件路径；不是调用方电脑的路径 |
| `fileUrl` | string | 与 fileBase64、filePath 三选一 | MCP 服务所在服务器可以访问并下载的 DWG 文件 URL |

远程第三方 Agent 推荐将附件转换为 `fileBase64` 并同时传入 `fileName`，不需要内网穿透。`filePath` 和 `fileUrl` 适用于本地部署或已有服务器文件 URL 的场景。三种来源必须且只能选择一种。上传成功只代表任务已经创建，不能代表图纸已经解析完成。

**返回：**

- `data.taskId`：异步任务 ID；
- `_hint`：下一步轮询任务状态的建议。

### 2. bangtu_create_cv_task

根据已经获取的 `frameId` 创建建筑专业构件识别任务。

**用途：**

- 对指定图框执行建筑专业构件识别；
- 将建筑图纸内容转换为结构化结果；
- 为后续 `bangtu_get_arch_result` 提供建筑任务 taskId。

**输入参数：**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `apiKey` | string | 是 | 客户 API Key |
| `product` | enum | 是 | 当前仅支持 `architecture` |
| `frameId` | string | 是 | 来自 `bangtu_get_frame_result` 的图框 ID |

该工具当前标记为“限时免费”。任务创建成功后仍需调用状态查询工具，直到任务状态为 `SUCCESS`。

### 3. bangtu_get_task_status

查询帮图异步识别任务状态。

**输入参数：**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `apiKey` | string | 是 | 客户 API Key |
| `taskId` | string | 是 | 任意帮图异步任务 ID，必须按字符串传递 |

**状态说明：**

- `RUNNING`：任务仍在执行，应等待约 3 至 5 秒后再次查询；
- `SUCCESS`：任务已经完成，可以调用对应结果工具；
- `FAILED`：任务失败，应查看返回的 `data.logs`。

复杂 DWG 图纸可能需要较长时间，最长可能约 120 分钟。`RUNNING` 不是失败，不能因为短时间内没有完成就判定任务失败。

### 4. bangtu_wait_task

短时便捷异步轮询工具，在一次 MCP 调用中按设定间隔反复查询任务状态。默认最多等待 20 秒，最大 45 秒，这是为了避免超过常见 Agent 平台的单次工具调用超时。

**输入参数：**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `apiKey` | string | 是 | 客户 API Key |
| `taskId` | string | 是 | 异步任务 ID |
| `maxWaitSeconds` | number | 否 | 最大等待秒数，默认 20 秒，最大 45 秒；建议使用默认值 |

该工具会先查询一次，任务为 `RUNNING` 时按轮询间隔继续查询，直到 `SUCCESS`、`FAILED` 或达到等待上限。返回值包含 `pollCount`、`elapsedSeconds` 和 `timedOut`，可据此确认是否发生了多次查询。如果 `data.status=RUNNING` 且 `timedOut=true`，这表示本次等待窗口结束，不表示任务失败；保存同一个 `taskId`，稍后再次调用 `bangtu_wait_task`，或改用 `bangtu_get_task_status`。如果 Agent 平台本身的工具调用超时小于 45 秒，应直接重复调用 `bangtu_get_task_status`，不要依赖长时间阻塞的 wait 调用。

### 5. bangtu_get_frame_result

获取 DWG 图纸基本信息识别的图框结果。

**前置条件：**

对应 PRE 任务的 `data.status` 必须为 `SUCCESS`。

**输入参数：**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `apiKey` | string | 是 | 客户 API Key |
| `taskId` | string | 是 | DWG 基本信息识别任务 ID |

**返回内容：**

返回图框数组，常见字段包括：

- `frameId`：图框唯一标识，用于创建建筑专业任务；
- `layoutName`：布局名称；
- `frameWcsLoc`：图框坐标；
- `signInfo`：图签识别内容；
- `rotation`：图框旋转信息。

### 6. bangtu_get_arch_result

获取建筑专业构件识别结果。

**前置条件：**

对应 BUILDING_CV 建筑识别任务的 `data.status` 必须为 `SUCCESS`。

**输入参数：**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `apiKey` | string | 是 | 客户 API Key |
| `taskId` | string | 是 | 建筑识别任务 ID |
| `dataType` | enum | 是 | 建筑结构化结果类型 |

**支持的 dataType：**

| dataType | 说明 |
| --- | --- |
| `axisNumber` | 轴号 |
| `indexNumber` | 索引号 |
| `texts` | 图纸文字 |
| `textelvation` | 标高符号 |
| `arrows` | 箭头 |
| `alignedDims` | 标尺线 |
| `subFrame` | 子图框 |
| `planRoom` | 房间 |
| `planStair` | 楼梯 |
| `planLift` | 电梯 |
| `planDoor` | 门 |
| `planWindow` | 窗 |
| `facadeStorey` | 立面楼层 |
| `sectionStorey` | 剖面楼层 |
| `stairPlanDetWall` | 楼梯平面详图墙体 |
| `stairPlanDetSeg` | 楼梯平面详图分段 |
| `stairPlanDetPlatform` | 楼梯平面详图平台 |
| `stairPlanDetRail` | 楼梯平面详图栏杆 |
| `stairSecDetPlatform` | 楼梯剖面详图平台 |
| `stairSecDetSeg` | 楼梯剖面详图分段 |
| `wallDetContour` | 墙身节点轮廓 |
| `doorWinDetail` | 门窗详图 |
| `doorWinTable` | 门窗表 |

## 七、推荐调用流程

### 完整 DWG 建筑解析流程

```text
1. bangtu_create_dwg_task
   远程 Agent 输入 apiKey、fileBase64 和 fileName
   本地部署也可输入 filePath 或 fileUrl
   保存返回的 taskId

2. bangtu_get_task_status 或 bangtu_wait_task
   查询 PRE 任务状态
   RUNNING 继续等待
   SUCCESS 进入下一步
   FAILED 查看 data.logs

3. bangtu_get_frame_result
   输入 PRE taskId
   获取图框列表和 frameId

4. bangtu_create_cv_task
   product = architecture
   输入 frameId
   保存返回的建筑任务 taskId

5. bangtu_get_task_status 或 bangtu_wait_task
   查询 BUILDING_CV 任务状态
   等待至 SUCCESS

6. bangtu_get_arch_result
   输入建筑任务 taskId 和 dataType
   获取对应建筑专业结构化结果
```

### Agent 使用建议

- 每次调用工具都传入 `apiKey`；
- 不要把 taskId 转换成数字，始终按字符串传递；
- 不要把任务创建接口返回成功当成解析完成；
- 以 `data.status` 判断异步任务是否完成；
- 不要在任务仍为 `RUNNING` 时调用结果工具；
- 复杂图纸需要较长时间时，保存 taskId 后稍后继续查询；
- 获取建筑结果时，根据实际需要选择具体 `dataType`，避免无目的地重复请求全部结果类型。

## 八、认证方式

帮图 MCP 使用客户 API Key 进行身份识别和服务计量。请在 MCP 客户端配置中填写 `apiKey`，不要把 API Key 拼接到连接 URL 中。

正式客户端配置：

```json
{
  "mcpServers": {
    "bangtu-api": {
      "url": "https://mcp.bangtu-ai.com/mcp",
      "apiKey": "请填入您的apiKey"
    }
  }
}
```

测试客户端使用本文开头提供的 `bangtu-api-test` 配置；旧版客户端将 `url` 改为 `https://mcp.bangtu-ai.com/sse`。`mcpServers` 下的名称只是客户端显示别名，实际连接地址由 `url` 决定。

业务工具执行时，MCP 服务会使用本次调用对应的客户 API Key，并转发为帮图上游 API 请求 Header：

```text
apiKey: 你的客户API Key
```

API Key 不写入 MCP 服务端 `.env`，服务端不会持久化客户 API Key，也不会在日志中打印客户 API Key。如需生成专属 API Key，请联系帮图客服。

## 九、上游 API 与响应约定

MCP 服务对应的帮图开放 API 基础地址为：

```text
https://openapi.bangtu-ai.com/openApi/
```

上游接口通常返回以下统一结构：

```json
{
  "code": 200,
  "message": "success",
  "data": {},
  "timestamp": 1700000000000
}
```

业务是否成功以 `code === 200` 为准。HTTP 请求成功不代表业务一定成功。异步任务是否完成以 `data.status` 为准。

## 十、文件与网络要求

### MCP 工具参数与上游 API 参数的区别

帮图上游接口的原始上传契约是：

```text
POST https://openapi.bangtu-ai.com/openApi/pre/createPreTask
Content-Type: multipart/form-data
字段名：file
```

上游接口本身没有 `fileBase64`、`fileName`、`filePath` 或 `fileUrl` 字段。当前 MCP 为了让 JSON 工具能够触发文件上传，额外提供了三种文件来源方式：

- `fileBase64 + fileName`：远程 Agent 传递附件内容，推荐用于第三方平台；
- `filePath`：MCP 服务所在服务器可读取的本地 `.dwg` 文件绝对路径；
- `fileUrl`：MCP 服务所在服务器可以访问并下载的 DWG 文件 URL。

MCP 服务的实际处理过程是：

```text
第三方平台附件
        ↓
Agent 传 fileBase64 + fileName
        ↓
MCP 服务在内存中还原 DWG 文件
        ↓
构造 multipart/form-data
        ↓
以 file 字段上传到帮图 /pre/createPreTask
```

### 远程平台接入限制

如果 MCP 被发布到第三方 Agent 平台，Agent 通常无法直接上传二进制文件，也无法让远程 MCP 服务读取 Agent 所在电脑的本地路径。因此：

- 远程平台支持附件时，优先传 `fileBase64` + `fileName`，不需要内网穿透；
- 不要传调用方电脑上的 `C:\\...`、`/Users/...` 或 `/home/...` 路径；
- `filePath` 仅适用于 MCP 服务服务器本地文件；
- `fileUrl` 仅适用于 MCP 服务服务器可以访问的文件 URL；
- `fileUrl` 必须最终返回真实 `.dwg` 文件内容；
- `filePath`/`fileUrl`/`fileBase64` 是 MCP 层输入，`file` 才是上游 API 层输入，二者不能混为一谈。

MCP 服务需要能够访问：

```text
https://openapi.bangtu-ai.com
```

## 十一、安全与隐私说明

- 客户 API Key 由调用方在工具参数中传入；
- 服务端不设置默认客户 API Key；
- 服务端不保存客户 API Key；
- 服务端不打印客户 API Key；
- 建议平台通过 HTTPS 访问 MCP 服务；
- 建议调用方不要在公开对话、日志或前端页面中暴露生产 API Key；
- DWG 文件可能包含项目、位置、设计单位和工程构件信息，调用方应确保上传行为符合项目授权和数据管理要求；
- 第三方平台接入时建议配置访问控制、请求限流和调用日志脱敏。

## 十二、服务限制与当前版本范围

- 当前支持 DWG 基础信息识别和建筑专业识别流程；
- 当前不支持结构、给排水、暖通等未发布专业结果；
- 建筑任务创建依赖已经获取的 `frameId`；
- DWG 解析为异步任务，复杂图纸可能需要较长等待时间；
- 单次调用的工具参数必须符合工具 schema；
- 文件路径或 URL 必须由 MCP 服务所在服务器访问；
- 具体调用频率、文件大小、套餐和价格以帮图官方服务政策为准。

## 十三、平台上架短描述

### 版本 A：简洁版

帮图工程图纸智能解析 MCP，将 DWG 图纸解析能力接入 AI Agent，支持图框、图签、房间、门窗、楼梯、轴号、文字、立面、剖面和建筑详图等结构化信息提取。

### 版本 B：产品版

帮图 MCP 面向工程设计与图纸审查场景，将 DWG 图纸转换为 AI 可调用的结构化数据。Agent 可以完成图纸上传、异步任务管理、图框识别、建筑构件识别及 23 类建筑专业结果查询。

### 版本 C：技术版

基于 MCP Streamable HTTP 的工程图纸解析服务，固化帮图 Open API 的 DWG 上传、异步任务轮询、图框结果和建筑专业结果接口。支持通过 API Key 按调用方认证，适合 AI 客户端、Agent 平台和企业自动化工作流集成。

## 十四、平台上架详细描述

帮图工程图纸智能解析 MCP 是一个面向 AI Agent 的工程图纸数据服务。它将 DWG 图纸解析能力封装为标准 MCP 工具，帮助大模型和智能体理解传统 CAD 图纸中的图框、图签、坐标、文字和建筑构件信息。

服务支持从 DWG 文件上传开始，自动创建异步解析任务；Agent 可以查询任务状态，在任务完成后获取图框列表；选择目标图框后，还可以创建建筑专业识别任务，并按结果类型获取房间、门、窗、楼梯、电梯、轴号、文字、立面楼层、剖面楼层、墙身节点、门窗详图和门窗表等结构化结果。

服务内部已经固化上游 API 的基础地址、认证方式、接口路径、请求方法、参数名称和建筑结果枚举，调用方无需自行编写 API 请求或处理不同接口之间的差异。每次工具调用传入客户自己的 API Key，服务端将其转发给帮图开放 API，用于客户识别和服务计量。

该 MCP 适用于工程设计辅助、图纸审查辅助、CAD 图纸问答、工程数据提取、项目归档和企业智能化工作流。当前版本支持 DWG 基础信息识别和建筑专业构件识别。

## 十五、上架资料建议填写

| 平台字段 | 建议内容 |
| --- | --- |
| 服务名称 | 帮图工程图纸智能解析 MCP |
| 服务英文名 | Bangtu Engineering Drawing Intelligence MCP |
| 服务分类 | 工程设计 / CAD / 图纸解析 / 企业效率工具 |
| 连接协议 | MCP Streamable HTTP |
| MCP Endpoint | `https://mcp.bangtu-ai.com/mcp` |
| 旧版兼容 Endpoint | `https://mcp.bangtu-ai.com/sse` |
| 官网 | `https://bangtu-ai.com` |
| API 文档 | `https://apidoc.bangtu-ai.com` |
| 认证方式 | 工具调用参数传入 `apiKey`，转发为上游 Header |
| 文件类型 | DWG |
| 当前专业范围 | 建筑专业 |
| 数据返回形式 | JSON 结构化结果 |
| 异步任务 | 支持，状态包括 RUNNING、SUCCESS、FAILED |
| 客服联系 | 如需生成专属 API Key，请联系客服 |

## 十六、版本信息

**项目整体版本：** `1.0.0`

**当前 MCP Server 内部版本：** `1.0.0`

**当前发布能力：** DWG 基础信息识别、建筑专业构件识别

**当前工具数量：** 6 个

**服务地址：** `https://mcp.bangtu-ai.com/mcp`

## 十七、常见问题（FAQ）

### 1. MCP 服务的正式接入地址是什么？

新版 MCP 客户端使用：

```text
https://mcp.bangtu-ai.com/mcp
```

只支持旧版 SSE 协议的客户端可以使用：

```text
https://mcp.bangtu-ai.com/sse
```

### 2. `mcpServers` 下的服务名称必须叫 `bangtu-api` 吗？

不必须。`mcpServers` 下的名称只是客户端中的显示别名，可以使用 `bangtu-api`、`bangtu-api-test` 或其他自定义名称。真正影响连接的是 MCP URL。正式、测试、旧版 SSE 和本地配置请以本文开头的“当前接入与部署说明”为准。

### 3. API Key 应该写在哪里？

API Key 需要作为每次工具调用的参数传入，不是固定写在 MCP 服务端环境变量中。服务端会将本次调用的 API Key 转发为上游请求 Header：

```text
apiKey: 你的客户API Key
```

如需生成专属 API Key，请联系客服。

### 4. 可以在 MCP 配置的 URL 里直接加 API Key 吗？

不建议，也不支持将 API Key 拼接到 URL 查询参数中。应在调用工具时传入 `apiKey` 参数，以避免凭证出现在 URL、代理访问记录和浏览器历史中。

### 5. DWG 文件如何上传？

当前 MCP 支持三种文件来源方式，但它们属于 MCP 工具参数，不是帮图上游 API 的原始参数：

- `fileBase64 + fileName`：远程 Agent 平台支持文件附件时的推荐方式。Agent 将 DWG 附件内容转换为 Base64，并同时传入文件名，不需要内网穿透；
- `filePath`：仅适用于 MCP 服务与 DWG 文件位于同一台服务器的本地部署场景；
- `fileUrl`：适用于 DWG 已经放在 MCP 服务服务器可以访问的对象存储或文件服务器上的场景。

远程第三方平台推荐使用：

```json
{
  "apiKey": "你的客户API Key",
  "fileBase64": "DWG 文件的 Base64 内容（可含 data:*;base64, 前缀）",
  "fileName": "drawing.dwg"
}
```

上游帮图 API 真正接收的是 `multipart/form-data` 中名为 `file` 的文件字段，MCP 会负责将上述文件来源转换为上游需要的上传格式。调用方电脑上的本地路径不会自动出现在远程 MCP 服务器上，因此远程场景不要传本地路径。

### 6. 创建任务成功后，为什么不能马上获取结果？

DWG 解析是异步任务。创建任务接口返回成功只表示任务已经进入后台队列，不表示识别已经完成。必须使用 `bangtu_get_task_status` 或 `bangtu_wait_task` 查询状态：

- `RUNNING`：继续等待；
- `SUCCESS`：调用对应结果工具；
- `FAILED`：查看 `data.logs`。

### 7. `bangtu_wait_task` 超时是不是任务失败？

不是。`bangtu_wait_task` 只负责在本次调用中等待指定时间。如果达到等待上限时任务仍为 `RUNNING`，应保存 taskId，稍后继续调用 `bangtu_get_task_status`。

### 8. 获取建筑结果前需要哪些步骤？

推荐流程为：

1. 使用 `bangtu_create_dwg_task` 创建 DWG 任务；
2. 等待 PRE 任务状态为 `SUCCESS`；
3. 使用 `bangtu_get_frame_result` 获取图框列表；
4. 选择目标 `frameId`；
5. 使用 `bangtu_create_cv_task` 创建建筑识别任务；
6. 等待 BUILDING_CV 任务状态为 `SUCCESS`；
7. 使用 `bangtu_get_arch_result` 和目标 `dataType` 获取结果。

### 9. 当前支持哪些专业？

当前发布版本支持 DWG 基础信息识别和建筑专业构件识别。

### 10. 建筑结果支持哪些类型？

当前支持 23 种建筑结果类型，包括轴号、索引号、文字、标高、箭头、标尺线、子图框、房间、楼梯、电梯、门、窗、立面楼层、剖面楼层、楼梯详图、墙身节点、门窗详图和门窗表。完整枚举请参见本文“`bangtu_get_arch_result`”章节。

### 11. 工具是否免费？

当前服务目录标注为：

- `bangtu_create_cv_task`：限时免费；
- 其他 5 个工具：免费。

正式价格和计费规则仍以帮图官方公布的信息为准。

### 12. MCP 服务返回什么格式？

工具结果以 MCP 文本内容返回，内容中包含帮图 API 的结构化 JSON 数据，常见字段包括 `code`、`message`、`data`、`timestamp`，任务类返回中还会包含 `_hint`，用于指导 Agent 进行下一步调用。

### 13. 服务是否保存 DWG 文件和 API Key？

服务端不会将客户 API Key 写入固定配置、数据库或日志。DWG 文件由服务临时读取或下载后转发给帮图开放 API，解析任务和结果由上游服务处理。调用方仍应按照自身项目的数据授权和隐私要求使用文件。

### 14. 如何确认 MCP 服务是否在线？

可以访问健康检查地址：

```text
https://mcp.bangtu-ai.com/health
```

该地址用于确认服务进程和 HTTP 服务是否正常，不代表某个具体 DWG 任务已经完成。

### 15. 是否支持本地部署？

支持。项目要求 Node.js 20 或更高版本，完整源码部署先执行 `npm install` 或 `npm ci`，再执行 `npm run build` 和 `npm start`。项目已提供 Dockerfile，也可以使用 Docker 部署；生产环境通过 Nginx、Caddy 或云负载均衡提供 HTTPS。

### 16. 服务版本是多少？

当前项目、MCP Server 和上架文档版本均为 `1.0.0`。
