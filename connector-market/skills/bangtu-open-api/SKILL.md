---
name: bangtu-open-api
description: 帮图CAD建筑图纸解析连接器。用于上传 DWG 图纸、识别图框图签、创建建筑专业构件识别任务、查询异步任务状态并获取结构化结果。当用户需要"识别/解析 DWG 图纸、提取图框、房间、门、窗、楼梯、轴号、立面、剖面等建筑信息"时使用。
---

# 帮图CAD建筑图纸解析

把 DWG 图纸交给帮图进行结构识别，返回 JSON 结构化结果。整体为「上传图纸 → 轮询任务 → 取结果」三步走，**所有任务都是异步的**，任务是否完成以 `data.status`（`RUNNING` / `SUCCESS` / `FAILED`）为准，**不要**根据创建接口的返回或单次查询的 `code` 字段判定成功。

## 认证

- `apiKey` 为调用方业务凭证，**以工具参数传入**各帮图工具（连接本身无需凭证；服务端不保存、不打印）。
- **收费环境请为每个客户使用独立的 API Key**。需向用户询问获取其本人的 Key，不要替用户猜测或使用预设默认 Key。
- 不要在工具参数之外把真实 Key 写入任何提示词或正文，不要把其他用户/系统的 Key 提供给当前用户。

## 工具概览

| 工具 | 用途 |
| --- | --- |
| `bangtu_create_dwg_task` | 上传 DWG 并创建「图纸基本信息识别（PRE）」任务。 |
| `bangtu_get_task_status` | 查询任意异步任务状态。 |
| `bangtu_wait_task` | 短时便捷轮询（最多约 45 秒）。 |
| `bangtu_get_frame_result` | 获取 PRE 任务的图框、图签、坐标结果。 |
| `bangtu_create_architecture_task` | 用 `frameId` 创建建筑专业构件识别任务（无需预处理）。 |
| `bangtu_create_electrical_pre_task` | 电气项目级聚合预处理，一次性传入全部电气 `frameIds`，返回 `electricalPreTaskId`。 |
| `bangtu_create_electrical_task` | 用 `electricalPreTaskId` + `frameId` 创建单图框电气构件识别任务。 |
| `bangtu_create_hvac_pre_task` | 暖通项目级聚合预处理，一次性传入全部暖通 `frameIds`，返回 `heatingPreTaskId`。 |
| `bangtu_create_hvac_task` | 用 `heatingPreTaskId` + `frameId` 创建单图框暖通构件识别任务。 |
| `bangtu_create_plumbing_task` | 用 `frameId` 创建给排水专业构件识别任务（无需预处理）。 |
| `bangtu_create_structure_task` | 用 `frameId` 创建结构专业构件识别任务（无需预处理）。 |
| `bangtu_get_cv_result` | 获取建筑、电气、暖通、给排水、结构已开放的普通结果与 `subFrame` 子图框基本信息。 |

## 1. 上传 DWG：`bangtu_create_dwg_task`

创建图纸基本信息识别任务。文件来源必须且只能选择一种。

参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `apiKey` | string | 是 | 帮图 API Key。 |
| `fileBase64` | string | 三选一 | 远程平台附件转成的 Base64（可含/不含 `data:*;base64,` 前缀），与 `fileName` 同传。远程推荐。 |
| `fileName` | string | 当用 `fileBase64` 时必填 | DWG 文件名，必须以 `.dwg` 结尾。 |
| `filePath` | string | 三选一 | MCP 服务器可读取的本地 `.dwg` 绝对路径（仅本地部署）。 |
| `fileUrl` | string | 三选一 | MCP 服务器可访问的 `.dwg` 下载 URL。 |

远程 Agent 示例（附件转 Base64）：

```json
{
  "apiKey": "你的客户API Key",
  "fileBase64": "<DWG 文件的 Base64 内容>",
  "fileName": "drawing.dwg"
}
```

返回：

```json
{
  "data": { "taskId": "xxx", "status": "RUNNING", "type": "pre" },
  "_hint": "DWG 任务已创建。请保存 taskId，并使用 bangtu_get_task_status 每 3 至 5 秒轮询任务状态。"
}
```

- 创建成功只表示后台任务已启动，**请保存 `data.taskId`** 并轮询至 `SUCCESS`。
- 复杂图纸最长可能约 120 分钟，请耐心轮询，不要因短时间未完成判定失败。

## 2. 轮询任务状态：`bangtu_get_task_status`

查询任意异步任务状态。

参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `apiKey` | string | 是 | 帮图 API Key。 |
| `taskId` | string | 是 | 任意帮图异步任务的 `taskId`，必须按字符串传，不能转数字。 |

返回关键字段：

- `data.status`：`RUNNING`（继续轮询）、`SUCCESS`（去取结果）、`FAILED`（看 `data.logs`）。
- `data.logs`：失败时查看原因。

当 `RUNNING` 时，建议间隔约 5 秒再次调用；复杂 DWG 可能需数十分钟。`bangtu_wait_task` 是同步等待式工具，若平台对单次工具调用超时较短，应改用它做重复状态查询。

## 3. 便捷轮询：`bangtu_wait_task`

本次调用内按约 5 秒间隔反复查询，遇到 `SUCCESS`/`FAILED` 立即返回，最多约 45 秒。

参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `apiKey` | string | 是 | 帮图 API Key。 |
| `taskId` | string | 是 | 任意帮图异步任务的 `taskId`。 |
| `maxWaitSeconds` | number | 否 | 最多等待秒数，默认 20，最大 45，建议用默认值。 |

返回额外字段：`pollCount`（本次实际查询次数）、`elapsedSeconds`（耗时秒）、`timedOut`（本次窗口是否超时）。

- `RUNNING` 且 `timedOut=true` 只表示本次等待窗口结束，**不是失败**。
- 超时后使用同一 `taskId` 再次调用本工具或 `bangtu_get_task_status`。

## 4. 取图框结果：`bangtu_get_frame_result`

仅当 PRE 任务状态为 `SUCCESS` 时调用。

参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `apiKey` | string | 是 | 帮图 API Key。 |
| `taskId` | string | 是 | DWG 基本信息识别 PRE 任务的 `taskId`。 |

返回：`data` 为图框数组，元素含 `frameId`、`layoutName`、`frameWcsLoc`、`signInfo`（图签内容）、`rotation`。从中选择 `frameId` 用于下一步创建专业任务；项目有多张 DWG 时，需对每个 PRE 任务各取一次并汇总全部 `frameId`。

## 5. 创建专业识别任务

不同专业调用顺序不同，**必须先判断专业再决定是否做预处理**。

### 5.1 无需预处理：建筑 / 给排水 / 结构

用 `frameId` 直接创建，三个工具参数完全相同（只有 `apiKey` 和 `frameId`）：

| 专业 | 工具 |
| --- | --- |
| 建筑 | `bangtu_create_architecture_task` |
| 给排水 | `bangtu_create_plumbing_task` |
| 结构 | `bangtu_create_structure_task` |

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `apiKey` | string | 是 | 帮图 API Key。 |
| `frameId` | string | 是 | 来自 `bangtu_get_frame_result` 的图框唯一标识。 |

### 5.2 需要先做项目级聚合预处理：电气 / 暖通

电气和暖通必须**先把整个项目所有要识别的图框聚到一起做一次预处理**，拿到统一的全局信息，再做单图框构件识别。顺序如下：

1. 汇总本项目全部目标图框的 `frameId`。
2. 电气调用 `bangtu_create_electrical_pre_task({ apiKey, frameIds })`，暖通调用 `bangtu_create_hvac_pre_task({ apiKey, frameIds })`，一次性把全部 `frameId` 放入 `frameIds` 数组（整个项目只调用一次，不要逐图框调用）。
3. 轮询预处理任务至 `SUCCESS`：电气拿到的 `taskId` 即 `electricalPreTaskId`，暖通即 `heatingPreTaskId`。
4. 再对每个图框分别调用 `bangtu_create_electrical_task({ apiKey, electricalPreTaskId, frameId })` 或 `bangtu_create_hvac_task({ apiKey, heatingPreTaskId, frameId })`，多个图框复用同一个预处理任务 ID。

**预处理任务未 `SUCCESS` 前，创建单图框任务会失败。** 建筑、给排水、结构没有预处理任务，不要调用任何预处理工具。

创建后必须用 `bangtu_get_task_status` 轮询至 `SUCCESS`，**不要**根据创建接口返回值直接取结果。

## 6. 取专业结果：`bangtu_get_cv_result`

仅当对应专业任务状态为 `SUCCESS` 时调用。`product` 选择专业，`dataType` 决定返回类型。

参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `apiKey` | string | 是 | 帮图 API Key。 |
| `product` | enum | 是 | `architecture` / `electrical` / `hvac` / `plumbing` / `structure`。 |
| `taskId` | string | 是 | 对应专业构件识别任务的 `taskId`。 |
| `dataType` | enum | 是 | 结构化结果类型，见下表。 |

建筑 `dataType` 取值：

```text
axisNumber 轴号, indexNumber 索引号, texts 图框文字, textelvation 标高符号,
arrows 箭头, alignedDims 标尺线, subFrame 子图框, planRoom 房间,
planStair 楼梯, planLift 电梯, planDoor 门, planWindow 窗,
facadeStorey 立面楼层, sectionStorey 剖面楼层,
stairPlanDetWall / stairPlanDetSeg / stairPlanDetPlatform / stairPlanDetRail 楼梯平面详图,
stairSecDetPlatform / stairSecDetSeg 楼梯剖面详图,
wallDetContour 墙身节点, doorWinDetail 门窗详图, doorWinTable 门窗表
```

电气当前支持 `texts`、`subFrame`；暖通、给排水、结构当前支持 `subFrame`。这里的 `subFrame` 只是子图框基本信息，子图框内构件需再用各专业独立的 `bangtu_get_*_subframe_result` 工具获取。

返回：`data` 为该类型的结构化数组；同时返回 `dataType` 用于核对。

## 典型调用链

1. `bangtu_create_dwg_task` 上传 DWG，保存 `data.taskId`；项目多张 DWG 需分别上传。
2. 对短任务用 `bangtu_wait_task`；任务较长或平台单次工具超时短时，用 `bangtu_get_task_status` 每 3~5 秒重复查询。
3. 状态为 `SUCCESS` 后调用 `bangtu_get_frame_result`，得到并汇总图框列表。
4. 创建专业任务：
   - 建筑 → `bangtu_create_architecture_task`；给排水 → `bangtu_create_plumbing_task`；结构 → `bangtu_create_structure_task`，直接传 `frameId`。
   - 电气 → 先 `bangtu_create_electrical_pre_task` 传全部 `frameIds`，预处理 `SUCCESS` 后再对每个图框调用 `bangtu_create_electrical_task`。
   - 暖通 → 先 `bangtu_create_hvac_pre_task` 传全部 `frameIds`，预处理 `SUCCESS` 后再对每个图框调用 `bangtu_create_hvac_task`。
5. 对专业任务重复轮询至 `SUCCESS`。
6. 调 `bangtu_get_cv_result({ product, taskId, dataType })` 取结构化结果；需要子图框内构件时再调对应专业的 `bangtu_get_*_subframe_result`。

## 常见错误与处理

| 现象 | 处理 |
| --- | --- |
| 进程长时间处于 `RUNNING` / `timedOut=true` | 这不是失败。复杂 DWG 最长约 120 分钟，用同一 `taskId` 继续重试轮询。 |
| `status=FAILED` | 读取 `data.logs` 定位原因，修正参数或文件后重建任务。 |
| 返回「Provide exactly one of fileBase64, filePath, or fileUrl」 | 三种文件来源必须且只能选一种。 |
| 返回「fileName is required when fileBase64 is provided」 | 使用 `fileBase64` 时必须同时给出 `.dwg` 结尾的 `fileName`。 |
| 返回「BangTu API business error」 | 上游业务错误，按 `code` 与 `message` 判断（如 Key 无效、参数非法、账号额度）。 |
| 返回「BangTu API HTTP ...」 | 上游网络/服务异常，稍后重试。 |

## 安全提醒

- 不输出、不猜测其他用户的 `apiKey`。
- 涉及客户图纸数据，仅供获得授权的用户处理对应图纸。
- 上报任务失败时只给 `data.logs` 摘要，不要粘贴可能包含敏感信息的完整报文。
