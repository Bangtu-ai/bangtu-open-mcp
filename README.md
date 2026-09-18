# bangtu-open-mcp

帮图开放 API 的 MCP Server。它把已发布的 API 契约固化在工具 schema 和服务端路由中：**MCP 运行时不会访问 API 文档页面**，因此文档页面下线不影响已发布接口的 MCP 调用。

当前支持：

- DWG 图纸基本信息识别：上传 DWG、查询任务状态、获取图框和图签结构化结果
- 建筑专业构件识别：轴号、房间、门窗、楼梯、文字、立剖面和详图等 23 类结果
- 电气专业构件识别：图框文字、子图框，以及指定子图框内按需筛选的 110+ 类电气构件（灯具、插座、配电箱、桥架、消防电气设备等）
- 暖通专业构件识别：子图框定位后按需筛选 60 类暖通构件（风机、风阀、风口、风管、立管、多联机与采暖设备等）
- 给排水专业构件识别：子图框定位后按需筛选 70 类给排水构件（消火栓、喷淋喷头、阀门、水泵、水箱、水表等）
- 结构专业构件识别：子图框定位后按需筛选 12 类结构构件（轴号、标注线、住宅梁、住宅板、墙平面及墙柱/墙身子构件、墙身表、墙柱表等）
- Streamable HTTP MCP 和兼容旧客户端的 SSE MCP

## 已固化的上游契约

| 项目 | 值 |
| --- | --- |
| API 基础地址 | `https://openapi.bangtu-ai.com/openApi/` |
| 认证方式 | 每次 MCP 工具调用传入 `apiKey`，服务端转发为上游 Header：`apiKey: {apiKey}` |
| 成功判断 | 上游 JSON 响应的 `code === 200` |
| 任务状态 | `RUNNING`、`SUCCESS`、`FAILED` |

API Key 属于调用方凭证。MCP 服务端不读取、不保存、不打印默认业务 API Key；收费环境请为每个客户使用独立 API Key。

## 安装与启动

环境要求：Node.js 20 或更高版本。

> 重要：使用 MCP 时有两种方式，不能混用：
> - **直接接入已有远程 MCP**：只填写服务提供方给出的 MCP Endpoint，不需要重新部署本项目。
> - **自行部署本项目**：需要把代码和依赖部署成一个 HTTP 服务，再使用部署平台分配的公网域名加 `/mcp` 作为 MCP Endpoint。此时不能继续填写其他环境的正式服务地址。

```bash
npm install
cp .env.example .env
npm run dev
```

Windows PowerShell 可使用：

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

生产构建与启动：

```bash
npm ci
npm run build
cp .env.example .env
npm start
```

Windows PowerShell 可使用：

```powershell
npm ci
npm run build
Copy-Item .env.example .env
npm start
```

`npm start` 依赖 `node_modules` 中的运行时依赖。仅复制 `dist`、`public`、`package.json` 和 `package-lock.json` 后，必须先在该目录执行 `npm ci`；构建产物不是自包含的单文件程序。

`.env.example` 只配置服务端口、上游基础地址和轮询参数，不配置客户 API Key。调用 MCP 工具时，必须在工具参数中传入客户自己的 `apiKey`。复杂 DWG 图纸最长可能需约 120 分钟，可按实际服务能力调整 `BANGTU_MAX_TASK_DURATION_MINUTES`。

## MCP 地址

### 直接接入已有正式服务

生产环境地址：

| 协议 | 地址 | 使用场景 |
| --- | --- | --- |
| Streamable HTTP（新版，推荐） | `https://mcp.bangtu-ai.com/mcp` | 支持新版 MCP Streamable HTTP 的客户端 |
| Legacy SSE（旧版兼容） | `https://mcp.bangtu-ai.com/sse` | 尚未支持 Streamable HTTP 的旧版客户端 |
| 健康检查 | `https://mcp.bangtu-ai.com/health` | 仅检查服务状态，不是 MCP Endpoint |

#### 新版 Streamable HTTP 配置（推荐）

配置格式与官方主页一致：

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

#### 测试客户端配置

用于测试环境快速验证 MCP 工具调用。配置格式与主页中的测试客户端配置一致：

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

测试配置仅用于评估和联调，正式使用请切换为专属客户 API Key。配置名称 `bangtu-api-test` 只是客户端显示名称，实际连接地址仍由 `url` 决定。

#### 旧版 Legacy SSE 配置

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

`/mcp` 与 `/sse` 只是 MCP 传输协议不同，提供的工具和业务能力相同；新接入优先使用 `/mcp`。

### 本地测试

启动本地服务后，默认地址如下：

| 类型 | 地址 |
| --- | --- |
| Streamable HTTP | `http://localhost:3000/mcp` |
| SSE | `http://localhost:3000/sse` |
| 健康检查 | `http://localhost:3000/health` |

本地测试客户端配置示例：

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

### 自行部署后的 MCP 地址

如果你把本项目部署到云服务器、容器平台或其他托管平台，连接地址应使用平台分配的公网 URL，并追加 `/mcp`，例如：

```text
https://<你的服务域名>/mcp
```

不要使用部署页面地址、代码仓库地址、`/health` 地址或其他环境的正式服务地址代替 MCP Endpoint。部署完成后先检查：

```text
https://<你的服务域名>/health
```

我已实际请求正式服务的健康检查地址：

```text
GET https://mcp.bangtu-ai.com/health
HTTP/1.1 200 OK
```

实际返回值为：

```json
{"ok":true,"service":"bangtu-open-api-mcp","version":"1.0.0"}
```

也已实际向 `https://mcp.bangtu-ai.com/mcp` 发起 MCP `initialize` 握手，返回 `HTTP/1.1 200 OK`，协议版本为 `2025-06-18`，服务名称为 `bangtu-open-api`，服务版本为 `1.0.0`。这说明正式 `/mcp` Endpoint 当前可以建立 MCP 会话。

健康检查和 MCP 初始化阶段不使用业务 `apiKey`；业务 `apiKey` 只在调用具体 MCP 工具时传入。

自行部署至少需要：

1. 上传或关联完整项目文件，包括 `package.json`、`package-lock.json`、`src/`、`tsconfig.json`、`public/` 和 `.env.example`；不要依赖被忽略的文件。
2. 安装依赖：`npm ci`。
3. 构建：`npm run build`。
4. 启动：`npm start`，服务监听平台注入的 `PORT`，不要把端口写死。
5. 将平台公网访问地址配置为 `/mcp`，再执行 MCP 连接测试。

远程部署通常不适合直接传调用方电脑的 `filePath`。DWG 文件应使用 `fileBase64 + fileName`，或使用部署服务器能够访问的公网 `fileUrl`。`.env` 只配置服务运行参数和上游 Base URL，不要把客户 `apiKey` 写入环境变量；`apiKey` 仍然作为每次 MCP 工具调用的工具参数传入。

## 工具

| 工具 | 请求契约 | 用途 |
| --- | --- | --- |
| `bangtu_create_dwg_task` | multipart POST | 通过 MCP 的 `fileBase64 + fileName`、`filePath` 或 `fileUrl` 文件来源读取 `.dwg`，由服务端转成上游 `file` 文件字段并创建 PRE 任务；项目多张 DWG 需分别上传 |
| `bangtu_create_electrical_pre_task` | JSON POST | **电气预处理**：按项目一次性传入全部电气 `frameIds`，聚合出统一全局信息，返回 `electricalPreTaskId` |
| `bangtu_create_hvac_pre_task` | JSON POST | **暖通预处理**：按项目一次性传入全部暖通 `frameIds`，聚合出统一全局信息，返回 `heatingPreTaskId` |
| `bangtu_create_architecture_task` | form POST | 用 `frameId` 创建建筑构件识别任务（无预处理） |
| `bangtu_create_electrical_task` | form POST | 用 `electricalPreTaskId` + `frameId` 创建电气构件识别任务 |
| `bangtu_create_hvac_task` | form POST | 用 `heatingPreTaskId` + `frameId` 创建暖通构件识别任务 |
| `bangtu_create_plumbing_task` | form POST | 用 `frameId` 创建给排水构件识别任务（无预处理） |
| `bangtu_create_structure_task` | form POST | 用 `frameId` 创建结构构件识别任务（无预处理） |
| `bangtu_get_task_status` | query GET | 查询任意异步任务状态，返回下一步 `_hint` |
| `bangtu_wait_task` | query GET（内部轮询） | 默认 20 秒、最多 45 秒的短时多次轮询；返回实际查询次数和是否超时 |
| `bangtu_get_frame_result` | query GET | 获取 PRE 任务的图框、图签与坐标结果 |
| `bangtu_get_cv_result` | query GET | 所有当前专业共用的普通结果工具；获取建筑、电气、暖通、给排水、结构已开放的结果类型，包括各专业 `subFrame` 子图框基本信息 |
| `bangtu_get_electrical_subframe_result` | JSON POST | 电气专业独立的子图框内容工具，获取指定电气子图框内的构件结果，`subFrameId` 必填 |
| `bangtu_get_hvac_subframe_result` | JSON POST | 暖通专业独立的子图框内容工具，获取指定暖通子图框内的构件结果，`subFrameId` 必填 |
| `bangtu_get_plumbing_subframe_result` | JSON POST | 给排水专业独立的子图框内容工具，获取指定给排水子图框内的构件结果，`subFrameId` 必填 |
| `bangtu_get_structure_subframe_result` | JSON POST | 结构专业独立的子图框内容工具，获取指定结构子图框内的构件结果，`subFrameId` 必填 |
| `bangtu_get_frame_entities_download_url` | query GET | 按 `frameId` 获取 30 分钟有效的图元数据下载链接，由调用方自行下载解压 |
| `bangtu_capture_screenshot_in_frame` | JSON POST（文件流） | 按 `frameId` 和 `wcsLoc` 对图框内指定矩形区域截图，返回 PNG 图片 |

## 图框图元与图框内截图

图元下载拆成「取下载链接的标准 JSON 接口」与「下载文件流的 GET 接口」两步，图框截图对应的上游接口最终以**文件流**返回，不是通用的 `{ code, message, data }` 结构；只有失败时才返回通用 JSON 错误结构。

`bangtu_get_frame_entities_download_url({ apiKey, frameId })` 对应 `GET /result/pre/download/drawingFrameEntitiesUrl?frameId={frameId}`，上游网关会把业务结果再包一层，真实地址位于 `data.data`（形如 `http(s)://{host}/openApi/result/pre/drawingFrameEntitiesForUrl/{JWT}`，JWT 的 `sub` 即 `frameId`、`exp` 为 30 分钟后）；**本工具已自动解包**并直接返回 `downloadUrl`。同一 `frameId` 的链接在有效期内可重复使用，上游对该接口启用了 sentinel 限流（返回 429「请求过于频繁」），请勿连续重复调用。**本工具只返回该下载链接，不下载、不解压、不解析文件**，由调用方在有效期内自行 `GET` 下载 `{frameId}-Entities.json.gz`：响应为 `application/octet-stream` 附件流，内容是 gzip 压缩的 UTF-8 JSON，按 CAD 图元类型（`AcDbLine`、`AcDbPolyline`、`AcDbText`、`AcDbBlockReference` 等）分数组存放，每个图元含公共字段 `super`；文件压缩前可能达到几十 MB。返回值包含 `downloadUrl`、`downloadUrlExpiresInSeconds`、`fileName` 和 `contentType`；链接过期或无效时该地址返回通用 JSON 错误结构，重新调用本工具获取新链接即可。

`bangtu_capture_screenshot_in_frame({ apiKey, frameId, wcsLoc })` 对应 `POST /result/pre/download/captureScreenshotInFrame`，请求体为 JSON `{ frameId, wcsLoc }`，成功响应为 `image/png`，以 MCP `image` 内容块返回。`wcsLoc` 与 `frameWcsLoc` 使用同一套布局内相对坐标（WCS），Y 轴向上、必须满足 `top > bottom`，且必须完全位于图框范围内；截取整个图框时可直接使用 `frameWcsLoc` 原值。

## DWG 调用链

1. 调用 `bangtu_create_dwg_task`。远程 Agent 推荐传入附件转换后的 `fileBase64` 和 `fileName`；本地部署也可传 `filePath` 或 `fileUrl`。
2. 保存返回的 `data.taskId`。
3. 对短任务调用 `bangtu_wait_task`，默认会实际查询多次并返回 `pollCount`、`elapsedSeconds` 和 `timedOut`。若返回 `data.status=RUNNING` 且 `timedOut=true`，只表示本次等待窗口结束，不表示失败；使用同一个 `taskId` 再次调用 `bangtu_wait_task`。
4. 复杂图纸或 Agent 平台工具超时限制较短时，直接按约 3 至 5 秒间隔重复调用 `bangtu_get_task_status`。不要把一次工具调用结束、客户端超时或 `RUNNING` 判定为失败。
5. 当状态变为 `SUCCESS`，调用 `bangtu_get_frame_result`，返回 `data[]` 图框列表。项目包含多张 DWG 时，应对每个 PRE 任务各调用一次，汇总出项目全部 `frameId`。
6. 按专业分支创建识别任务：
   - **建筑**：`bangtu_create_architecture_task({ apiKey, frameId })`，无预处理。
   - **给排水**：`bangtu_create_plumbing_task({ apiKey, frameId })`，无预处理。
   - **结构**：`bangtu_create_structure_task({ apiKey, frameId })`，无预处理。
   - **电气**：先 `bangtu_create_electrical_pre_task({ apiKey, frameIds: [本项目全部电气 frameId] })` 完成项目级聚合预处理，轮询其 `taskId` 至 `SUCCESS` 得到 `electricalPreTaskId`；再对每个图框调用 `bangtu_create_electrical_task({ apiKey, electricalPreTaskId, frameId })`。
   - **暖通**：先 `bangtu_create_hvac_pre_task({ apiKey, frameIds: [本项目全部暖通 frameId] })` 完成项目级聚合预处理，轮询其 `taskId` 至 `SUCCESS` 得到 `heatingPreTaskId`；再对每个图框调用 `bangtu_create_hvac_task({ apiKey, heatingPreTaskId, frameId })`。
7. 对任务重复使用 `bangtu_wait_task` 或 `bangtu_get_task_status`，直到状态为 `SUCCESS`。预处理任务必须在创建单图框任务前先变为 `SUCCESS`，否则创建会失败。
8. 建筑任务：调用 `bangtu_get_cv_result({ product: "architecture", taskId, dataType })` 获取 23 种专业结构化结果。
9. 电气文字：调用 `bangtu_get_cv_result({ product: "electrical", taskId, dataType: "texts" })`，直接取得完整图框文字结果。
10. 电气子图框及构件：先调用 `bangtu_get_cv_result({ product: "electrical", taskId, dataType: "subFrame" })` 获取电气子图框，再调用 `bangtu_get_electrical_subframe_result` 获取指定子图框内的电气构件。
11. 暖通子图框及构件：先调用 `bangtu_get_cv_result({ product: "hvac", taskId, dataType: "subFrame" })` 获取暖通子图框，再调用 `bangtu_get_hvac_subframe_result` 获取指定子图框内的暖通构件。
12. 给排水子图框及构件：先调用 `bangtu_get_cv_result({ product: "plumbing", taskId, dataType: "subFrame" })` 获取给排水子图框，再调用 `bangtu_get_plumbing_subframe_result` 获取指定子图框内的给排水构件。
13. 结构子图框及构件：先调用 `bangtu_get_cv_result({ product: "structure", taskId, dataType: "subFrame" })` 获取结构子图框，再调用 `bangtu_get_structure_subframe_result` 获取指定子图框内的结构构件。

任务状态以 `data.status` 为准。`FAILED` 时请读取 `data.logs`；`RUNNING` 不是错误，不能因便捷轮询超时、客户端结束工具调用或短时间内未完成而视为失败。`bangtu_wait_task` 是同步等待式工具，客户端若有更短的单次工具超时，应改用重复的 `bangtu_get_task_status`。

## 文件上传

### MCP 参数与上游接口参数

帮图上游接口 `POST /pre/createPreTask` 不接收 `fileBase64`、`fileName`、`filePath` 或 `fileUrl`，它真正接收的是 `multipart/form-data` 的 `file` 字段。

当前 MCP 工具定义了三种文件来源方式：

- `fileBase64 + fileName`：远程 Agent 平台传递附件内容，推荐方式，不需要内网穿透；
- `filePath`：MCP 服务所在服务器可读取的本地 `.dwg` 文件绝对路径，适合本地部署；
- `fileUrl`：MCP 服务所在服务器可访问且可下载的 `.dwg` 文件 URL。

三种来源必须且只能选择一种。远程平台支持文件附件时，Agent 应将附件内容转换为 Base64（不含或包含 data URL 前缀均可），同时传入 `.dwg` 文件名：

```json
{
  "apiKey": "你的客户API Key",
  "fileBase64": "<DWG 文件的 Base64 内容>",
  "fileName": "drawing.dwg"
}
```

服务端处理链路：

```text
第三方平台附件
    -> Agent 传 fileBase64 + fileName
    -> MCP 服务在内存中还原 DWG 文件
    -> 构造 multipart/form-data
    -> 以 file 字段上传到帮图 API
```

`fileBase64`、`fileName`、`filePath` 和 `fileUrl` 是 MCP 层参数，不是帮图上游 API 参数。远程 Agent 不需要内网穿透，也不应传调用方电脑上的本地路径。

## 跨专业普通结果工具

`bangtu_get_cv_result` 是建筑、电气、暖通、给排水、结构当前已有专业共用的普通结果获取工具。它统一调用 `GET /result/{专业路径}/{dataType}?id={taskId}`；未来任一专业新增相同 GET 契约的结果类型，继续扩展该专业在本工具中的 `dataType` 支持范围。

`subFrame` 在本工具中表示子图框基本信息，不表示指定子图框内的构件内容。子图框内容使用各专业独立的 `subFrameResult` 工具。当前电气、暖通、给排水、结构有该内容接口；建筑目前没有，但以后上游增加建筑子图框内容接口时，应新增建筑专业自己的内容工具。

当前 `product=architecture` 支持以下 `dataType`：

```text
axisNumber, indexNumber, texts, textelvation, arrows, alignedDims, subFrame,
planRoom, planStair, planLift, planDoor, planWindow, facadeStorey,
sectionStorey, stairPlanDetWall, stairPlanDetSeg, stairPlanDetPlatform,
stairPlanDetRail, stairSecDetPlatform, stairSecDetSeg, wallDetContour,
doorWinDetail, doorWinTable
```

## 电气结果类型

电气结果包含两种不同请求契约，不合并在同一个工具中：

- 图框文字：`bangtu_get_cv_result({ product: "electrical", taskId, dataType: "texts" })`，对应 `GET /result/electrical_cv/texts?id={taskId}`。
- 子图框列表：`bangtu_get_cv_result({ product: "electrical", taskId, dataType: "subFrame" })`，对应 `GET /result/electrical_cv/subFrame?id={taskId}`。返回 `subFrameId`、`subFrameName`、`subFrameType`、`wcsLoc`；子图框类型包括 `FRAME_UNK`、`PLAN_DRAWING`、`SYSTEM_DRAWING`。
- 子图框内构件：`bangtu_get_electrical_subframe_result({ taskId, subFrameId, dataTypeList? })`，对应 `POST /result/electrical_cv/subFrameResult`，请求体为 JSON，`subFrameId` 必填。`dataTypeList` 支持 110+ 种构件类型（含 `all`），不传或传空时默认返回全部构件。

建筑、电气、暖通、给排水、结构已开放的普通结果和 `subFrame` 子图框基本信息均由 `bangtu_get_cv_result` 统一获取；指定电气子图框内容由 `bangtu_get_electrical_subframe_result` 独立获取。

## 暖通结果类型

暖通任务类型为 `HEATING_CV`。暖通普通结果和子图框基本信息属于跨专业通用 GET 契约；当前使用 `bangtu_get_cv_result({ product: "hvac", taskId, dataType: "subFrame" })` 获取，对应 `GET /result/heating_cv/subFrame?id={taskId}`。

指定暖通子图框内容使用暖通专业独立工具 `bangtu_get_hvac_subframe_result({ taskId, subFrameId, dataTypeList? })` 获取，对应 `POST /result/heating_cv/subFrameResult`。该工具使用独立暖通枚举，共 60 种取值（含 `all`）：轴号 `axisNumber`、风机（`exhaustFan` 排风机、`supplyFan` 送风机、`smokeExhaustFan` 排烟风机）、风阀（`fireDamper` 防火阀、`smokeExhaustValve` 排烟阀）、风口（`supplyOutlet` 送风口、`smokeExhaustOutlet` 排烟口）、风管与立管（`supplyDuct`、`exhaustDuct`、`supplyRiser` 等）、空调与采暖设备（`vrfIndoorUnit` / `vrfOutdoorUnit` 多联机内外机、`floorHeatingCoil` 地暖盘管）等。

暖通接口的参数、枚举或返回处理发生变化时，只修改暖通工具，不同步影响电气或给排水。

## 给排水结果类型

给排水任务类型为 `WSD_CV`。给排水普通结果和子图框基本信息属于跨专业通用 GET 契约；当前使用 `bangtu_get_cv_result({ product: "plumbing", taskId, dataType: "subFrame" })` 获取，对应 `GET /result/wsd_cv/subFrame?id={taskId}`。

指定给排水子图框内容使用给排水专业独立工具 `bangtu_get_plumbing_subframe_result({ taskId, subFrameId, dataTypeList? })` 获取，对应 `POST /result/wsd_cv/subFrameResult`。该工具使用独立给排水枚举，共 70 种取值（含 `all`）：`indoorFireHydrant` 室内消火栓、`sprinklerHead` 喷头、阀门（`gateValve` 闸阀、`butterflyValve` 蝶阀、`checkValve` 止回阀）、`waterMeter` 水表、水箱与水泵、`floorDrain` 地漏等。

给排水接口的参数、枚举、子图框类型或返回处理发生变化时，只修改给排水工具，不同步影响电气或暖通。

## 结构结果类型

结构任务类型为 `STRUCT_CV`，专业路径为 `struct_cv`。结构普通结果和子图框基本信息属于跨专业通用 GET 契约；当前使用 `bangtu_get_cv_result({ product: "structure", taskId, dataType: "subFrame" })` 获取，对应 `GET /result/struct_cv/subFrame?id={taskId}`。返回 `subFrameId`、`subFrameName`、`subFrameType`、`wcsLoc`、`frameId`；子图框类型包括 `FRAME_UNK`、`AXIS`、`TABLE`、`PLA`、`SEC`、`TABLE_TWO`、`DETAIL`、`SCTL`、`BASIC_DETAIL`，其中 `AXIS` 轴网和 `TABLE` 表格已开放构件结果，其余类型当前只返回基本信息。

指定结构子图框内容使用结构专业独立工具 `bangtu_get_structure_subframe_result({ taskId, subFrameId, dataTypeList? })` 获取，对应 `POST /result/struct_cv/subFrameResult`，请求体为 JSON，`subFrameId` 必填。该工具使用独立结构枚举，共 12 种取值（含 `all`）：`axisNumber` 轴号、`dimInfo` 标注线、`upBeam` 住宅梁、`slab` 住宅板、`wallAxis` 墙平面、`qsTable` 墙身表、`qzTable` 墙柱表，以及子构件 `slab.slabCode` 住宅板-板型号编号、`slab.slabHole` 住宅板-板孔洞列表、`wallAxis.qz_list` 墙平面-墙柱列表、`wallAxis.qs_list` 墙平面-墙身列表。带点号的是子构件，只请求子构件时只返回被请求的那部分字段；同时请求顶层构件及其子构件会自动合并为完整结构。地库梁板柱、桩、筏板、承台、独立基础、楼梯、详图等构件不支持单独查询，传入会返回参数错误。

结构接口的参数、枚举、子图框类型或返回处理发生变化时，只修改结构工具，不同步影响电气、暖通或给排水。

## 服务器部署

这是一个 Node.js 常驻服务，不需要数据库，也不需要挂载本地存储。DWG 文件由 MCP 服务临时读取并转发给帮图 API，任务结果由上游服务保存和查询。

### 配置要求

最低配置适合测试和少量调用：

| 项目 | 最低建议 |
| --- | --- |
| CPU | 1 vCPU |
| 内存 | 1 GB |
| 磁盘 | 10 GB，主要用于系统和日志 |
| 系统 | Ubuntu 22.04/24.04、Debian 12 或其他 Linux |
| 运行时 | Node.js 20 或更高版本 |
| 网络 | 能访问 `openapi.bangtu-ai.com`，公网提供 HTTPS |

生产环境建议使用 2 vCPU、2 GB 内存，并根据并发调用量扩容。DWG 解析任务在帮图上游异步执行，服务器本身不会因为等待任务而持续占用大量 CPU；真正需要关注的是带宽、并发连接数和日志容量。

### 直接部署

完整源码部署。必须先安装项目依赖，不能直接执行 `npm run build` 或 `npm start`：

```bash
# 服务器安装 Node.js 20+
git clone <你的代码仓库地址> bangtu-open-mcp
cd bangtu-open-mcp
npm install
cp .env.example .env
npm run build
npm start
```

如果项目中包含 `package-lock.json`，生产环境也可以使用更严格、可复现的安装命令替换 `npm install`：

```bash
npm ci
```

如果使用已经生成好的发布目录，至少需要一起提供 `dist/`、`public/`、`package.json`、`package-lock.json` 和 `.env`，然后在发布目录执行：

```bash
npm ci --omit=dev
npm start
```

不要只复制 `dist/` 后执行 `npm start`。运行时需要安装 `@modelcontextprotocol/sdk`、`cors`、`dotenv`、`express` 和 `zod` 等生产依赖。

`.env` 至少确认以下配置：

```env
PORT=3000
HOST=127.0.0.1
BANGTU_API_BASE_URL=https://openapi.bangtu-ai.com/openApi/
BANGTU_POLL_INTERVAL_MS=5000
BANGTU_MAX_TASK_DURATION_MINUTES=120
BANGTU_DEFAULT_WAIT_SECONDS=20
BANGTU_MAX_WAIT_SECONDS=45
JSON_LIMIT=200mb
```

服务启动后先检查：

```bash
curl http://127.0.0.1:3000/health
```

### 使用 PM2 守护

推荐用 PM2 保证进程异常退出后自动重启，并设置开机启动：

```bash
npm install -g pm2
pm2 start dist/index.js --name bangtu-open-mcp
pm2 save
pm2 startup
pm2 logs bangtu-open-mcp
```

执行 `pm2 startup` 后，按照终端输出执行它给出的那条系统命令。更新代码时：

```bash
npm ci
npm run build
pm2 restart bangtu-open-mcp
```

### Nginx 反向代理

MCP 服务只监听本机 `127.0.0.1:3000`，由 Nginx 提供 HTTPS。`/mcp` 使用 Streamable HTTP，`/sse` 为兼容旧客户端的 SSE，两个路径都要转发：

```nginx
server {
    listen 443 ssl http2;
    server_name mcp.example.com;

    ssl_certificate     /etc/letsencrypt/live/mcp.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mcp.example.com/privkey.pem;

    # fileBase64 走 JSON-RPC body，Nginx 默认 client_max_body_size 只有 1m，不放大则上传会先被网关以 413 拒绝。
    # 该值需要不小于服务端 JSON_LIMIT（默认 200mb）。
    client_max_body_size 200m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 7200s;
        proxy_send_timeout 7200s;
    }
}
```

配置后验证：

```bash
curl https://mcp.example.com/health
```

生产环境不要直接开放 3000 端口。至少应在 Nginx、云防火墙或网关层配置 HTTPS、访问认证、请求限流和日志脱敏。客户的 `apiKey` 是每次工具调用传入的业务凭证，不要写入服务端 `.env`，也不要打印到日志。

### Docker 部署

项目已提供 [Dockerfile](Dockerfile:1)。当前镜像构建和启动方式如下：

```bash
docker build -t bangtu-open-mcp .
docker run -d --name bangtu-open-mcp -p 3000:3000 --env-file .env bangtu-open-mcp
```

现有 Dockerfile 使用 Node.js 22.19.0 基础镜像，构建阶段执行 `npm install` 和 `npm run build`，运行阶段使用 `pm2-runtime dist/index.js` 启动服务。`.env` 不应写入镜像，运行容器时通过 `--env-file .env` 或平台环境变量注入服务配置。

容器内部服务端口为 `3000`，公网部署时应将平台或反向代理转发到该端口，并使用 HTTPS 对外提供 `/mcp` 和 `/sse`。健康检查地址为 `/health`。
