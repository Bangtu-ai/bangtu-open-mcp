import "dotenv/config";
import cors from "cors";
import express, { type Request, type Response } from "express";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

type JsonRecord = Record<string, unknown>;
type TaskStatus = "RUNNING" | "SUCCESS" | "FAILED";
type Product = "architecture";

type BangtuResponse<T> = {
  code: number;
  message: string;
  data: T;
  timestamp?: number;
};

type TaskData = {
  taskId: string;
  status: TaskStatus;
  type: string;
  createTime?: string;
  endTime?: string | null;
  logs?: unknown[];
};

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const apiBaseUrl = new URL(process.env.BANGTU_API_BASE_URL ?? "https://openapi.bangtu-ai.com/openApi/");
const pollIntervalMs = Number(process.env.BANGTU_POLL_INTERVAL_MS ?? 5000);
const maxTaskDurationMinutes = Number(process.env.BANGTU_MAX_TASK_DURATION_MINUTES ?? 120);
// Keep one wait call below common Agent tool-call timeouts. Long jobs use repeated status calls.
const defaultWaitSeconds = Number(process.env.BANGTU_DEFAULT_WAIT_SECONDS ?? 20);
const maxWaitSeconds = Number(process.env.BANGTU_MAX_WAIT_SECONDS ?? 45);

const architectureDataTypes = [
  "axisNumber",
  "indexNumber",
  "texts",
  "textelvation",
  "arrows",
  "alignedDims",
  "subFrame",
  "planRoom",
  "planStair",
  "planLift",
  "planDoor",
  "planWindow",
  "facadeStorey",
  "sectionStorey",
  "stairPlanDetWall",
  "stairPlanDetSeg",
  "stairPlanDetPlatform",
  "stairPlanDetRail",
  "stairSecDetPlatform",
  "stairSecDetSeg",
  "wallDetContour",
  "doorWinDetail",
  "doorWinTable",
] as const;

// 电气专业接口暂未上线，相关 dataType 枚举与工具实现暂时停用。
// API 上线后恢复 electricalDataTypes、Product 枚举值和下方电气工具注册即可。

const apiKeySchema = z.string().min(1).describe("帮图 API Key。本次调用会转发为上游 apiKey 请求头，不会由 MCP 服务保存或打印。收费环境请使用你自己的 API Key。 ");

function createServer(): McpServer {
  const server = new McpServer({
    name: "bangtu-open-api",
    version: "1.0.0",
  });

  server.tool(
    "bangtu_create_dwg_task",
    "上传 DWG 图纸并创建图纸基本信息识别任务。远程 Agent 优先传 fileBase64 和 fileName（平台附件转 Base64）；本地部署也支持 filePath 或 fileUrl，三种方式必须且只能选择一种。任务创建成功只表示后台任务已启动；请保存返回的 taskId，随后使用 bangtu_get_task_status 轮询至 SUCCESS，再调用 bangtu_get_frame_result 获取图框、图签和坐标等结构化解析结果。",
    {
      apiKey: apiKeySchema,
      fileBase64: z.string().min(1).max(70_000_000).optional().describe("远程平台附件的 Base64 内容，可包含或不包含 data:*;base64, 前缀。与 fileName 一起传入；与 filePath、fileUrl 三选一。"),
      fileName: z.string().min(1).optional().describe("fileBase64 对应的 DWG 文件名，必须以 .dwg 结尾。使用 fileBase64 时必填。"),
      filePath: z.string().min(1).optional().describe("MCP 服务器可读取的本地 DWG 文件绝对路径。与 fileBase64、fileUrl 三选一。"),
      fileUrl: z.string().url().optional().describe("MCP 服务器可访问的 DWG 文件下载 URL。与 fileBase64、filePath 三选一。"),
    },
    async ({ apiKey, fileBase64, fileName, filePath, fileUrl }) => {
      const sources = [fileBase64, filePath, fileUrl].filter(Boolean).length;
      if (sources !== 1) throw new Error("Provide exactly one of fileBase64, filePath, or fileUrl");
      if (fileBase64 && !fileName) throw new Error("fileName is required when fileBase64 is provided");
      if (!fileBase64 && fileName) throw new Error("fileName is only valid with fileBase64");
      const file = fileBase64
        ? decodeBase64File(fileBase64, fileName!)
        : filePath
          ? await readLocalFile(filePath)
          : await downloadFile(fileUrl!);
      const data = await uploadDwg(file, apiKey);
      return textResult({ data, _hint: "DWG 任务已创建。请保存 taskId，并使用 bangtu_get_task_status 每 3 至 5 秒轮询任务状态。" });
    },
  );

  server.tool(
    "bangtu_create_cv_task",
    "根据已完成的 DWG 图框 frameId 创建建筑专业构件识别任务。必须传入 apiKey。任务创建后必须用 bangtu_get_task_status 轮询至 SUCCESS；不要根据创建接口返回成功就直接取结果。",
    {
      apiKey: apiKeySchema,
      product: z.enum(["architecture"]).describe("要识别的专业：architecture（建筑）。"),
      frameId: z.string().min(1).describe("来自 bangtu_get_frame_result 返回值的图框唯一标识 frameId。"),
    },
    async ({ apiKey, product, frameId }) => {
      const data = await callBangtuApi<TaskData>("/cv/building_cv/createTask", {
        method: "POST",
        form: { frameId },
        apiKey,
      });
      return textResult({ data, _hint: "建筑构件识别任务已创建。请保存 taskId，并使用 bangtu_get_task_status 轮询至 SUCCESS。" });
    },
  );

  server.tool(
    "bangtu_get_task_status",
    `查询帮图异步识别任务状态。任务为异步执行，返回 data.status：RUNNING 表示任务执行中，请等待约 ${Math.round(pollIntervalMs / 1000)} 秒后再次调用本工具；SUCCESS 表示任务完成，可继续调用对应结果获取工具；FAILED 表示任务失败，请查看 data.logs。DWG 图纸解析是耗时操作，复杂图纸最长可能需要约 ${maxTaskDurationMinutes} 分钟，请耐心轮询，不要因短时间未完成而判定失败。任务是否完成以 data.status 为准，不是本次查询的 code 字段。`,
    {
      apiKey: apiKeySchema,
      taskId: z.string().min(1).describe("任意帮图异步任务的 taskId。必须按字符串传递，不能转换为数字。"),
    },
    async ({ apiKey, taskId }) => textResult(await getTaskStatusWithHint(taskId, apiKey)),
  );

  server.tool(
    "bangtu_wait_task",
    `短时便捷轮询工具：本次调用最多持续 ${maxWaitSeconds} 秒，按 ${Math.round(pollIntervalMs / 1000)} 秒间隔反复查询，遇到 SUCCESS 或 FAILED 立即返回。返回值包含 pollCount、elapsedSeconds 和 timedOut，用于确认本次实际查询次数；RUNNING 且 timedOut=true 只表示本次等待窗口结束，不表示任务失败。复杂 DWG 图纸可能需要约 ${maxTaskDurationMinutes} 分钟，超时后请稍后再次调用 bangtu_wait_task 或 bangtu_get_task_status。`,
    {
      apiKey: apiKeySchema,
      taskId: z.string().min(1).describe("任意帮图异步任务的 taskId。"),
      maxWaitSeconds: z.number().int().min(1).max(maxWaitSeconds).optional().describe(`本次最多等待秒数，默认 ${defaultWaitSeconds} 秒，最大 ${maxWaitSeconds} 秒。建议使用默认值，避免超过 Agent 单次工具调用超时。`),
    },
    async ({ apiKey, taskId, maxWaitSeconds: requestedWaitSeconds }) => {
      const waitSeconds = Math.min(requestedWaitSeconds ?? defaultWaitSeconds, maxWaitSeconds);
      const startedAt = Date.now();
      const deadline = startedAt + waitSeconds * 1000;
      let pollCount = 1;
      let task = await getTaskStatusWithHint(taskId, apiKey);
      while (task.data.status === "RUNNING" && Date.now() < deadline) {
        await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
        task = await getTaskStatusWithHint(taskId, apiKey);
        pollCount += 1;
      }
      const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
      const timedOut = task.data.status === "RUNNING";
      if (timedOut) {
        task._hint = `本次便捷轮询已实际查询 ${pollCount} 次，耗时约 ${elapsedSeconds} 秒，任务仍在执行中。这不是失败；复杂图纸最长可能需约 ${maxTaskDurationMinutes} 分钟。请稍后继续调用 bangtu_wait_task 或 bangtu_get_task_status。`;
      }
      return textResult({
        ...task,
        pollCount,
        elapsedSeconds,
        timedOut,
        _nextAction: timedOut ? "Wait and call bangtu_wait_task again with the same taskId." : "Continue with the result tool for this task type.",
      });
    },
  );

  server.tool(
    "bangtu_get_frame_result",
    "获取 DWG 图纸基本信息识别的图框结果。仅当 PRE 任务状态为 SUCCESS 时调用。返回 data 图框数组，数组元素含 frameId、layoutName、frameWcsLoc、signInfo（图签识别内容）和 rotation。frameId 用于后续创建建筑构件识别任务。",
    {
      apiKey: apiKeySchema,
      taskId: z.string().min(1).describe("DWG 基本信息识别 PRE 任务的 taskId。"),
    },
    async ({ apiKey, taskId }) => {
      const data = await callBangtuApi<unknown[]>("/result/pre/frameBaseInfo", { query: { id: taskId }, apiKey });
      return textResult({ data, _hint: "已返回图框结果。选择需要识别的 frameId 后，可调用 bangtu_create_cv_task 创建建筑专业任务。" });
    },
  );

  server.tool(
    "bangtu_get_arch_result",
    "获取建筑构件识别结果。仅当 BUILDING_CV 任务状态为 SUCCESS 时调用。dataType 决定返回的结构化结果类型；接口路径、请求方法及 taskId 参数名均由本工具固化，调用者不需要也不能填写 endpoint。",
    {
      apiKey: apiKeySchema,
      taskId: z.string().min(1).describe("建筑构件识别 BUILDING_CV 任务的 taskId。"),
      dataType: z.enum(architectureDataTypes).describe("建筑结果类型：axisNumber 轴号、indexNumber 索引号、texts 图框文字、textelvation 标高符号、arrows 箭头、alignedDims 标尺线、subFrame 子图框、planRoom 房间、planStair 楼梯、planLift 电梯、planDoor 门、planWindow 窗、facadeStorey 立面楼层、sectionStorey 剖面楼层、stairPlanDetWall/stairPlanDetSeg/stairPlanDetPlatform/stairPlanDetRail 楼梯平面详图、stairSecDetPlatform/stairSecDetSeg 楼梯剖面详图、wallDetContour 墙身节点、doorWinDetail 门窗详图、doorWinTable 门窗表。"),
    },
    async ({ apiKey, taskId, dataType }) => {
      const data = await callBangtuApi<unknown[]>(`/result/building_cv/${dataType}`, { query: { id: taskId }, apiKey });
      return textResult({ dataType, data });
    },
  );

  // 电气专业接口暂未上线，暂不向 MCP 客户端注册 bangtu_get_electrical_result。
  // 上线后恢复此工具注册，并同步恢复 electricalDataTypes 与 bangtu_create_cv_task 的 electrical 分支。

  return server;
}

async function readLocalFile(filePath: string): Promise<{ bytes: Uint8Array; fileName: string }> {
  const bytes = await readFile(filePath);
  if (!filePath.toLowerCase().endsWith(".dwg")) throw new Error("filePath must point to a .dwg file");
  return { bytes, fileName: basename(filePath) };
}

async function downloadFile(fileUrl: string): Promise<{ bytes: Uint8Array; fileName: string }> {
  const response = await fetch(fileUrl);
  if (!response.ok) throw new Error(`Could not download DWG file: ${response.status} ${response.statusText}`);
  const url = new URL(fileUrl);
  const fileName = basename(url.pathname) || "drawing.dwg";
  if (!fileName.toLowerCase().endsWith(".dwg")) throw new Error("fileUrl must point to a .dwg file");
  return { bytes: new Uint8Array(await response.arrayBuffer()), fileName };
}

function decodeBase64File(fileBase64: string, fileName: string): { bytes: Uint8Array; fileName: string } {
  if (!fileName.toLowerCase().endsWith(".dwg")) throw new Error("fileName must end with .dwg");
  const normalized = fileBase64.replace(/^data:.*?;base64,/, "").replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1) {
    throw new Error("fileBase64 is invalid");
  }
  const bytes = Buffer.from(normalized, "base64");
  if (!bytes.length) throw new Error("fileBase64 is empty or invalid");
  return { bytes: new Uint8Array(bytes), fileName: basename(fileName) };
}

async function uploadDwg(file: { bytes: Uint8Array; fileName: string }, apiKey: string): Promise<TaskData> {
  const form = new FormData();
  const bytes = new Uint8Array(file.bytes);
  form.append("file", new Blob([bytes.buffer], { type: "application/octet-stream" }), file.fileName);
  return callBangtuApi<TaskData>("/pre/createPreTask", { method: "POST", formData: form, apiKey });
}

async function getTaskStatusWithHint(taskId: string, apiKey: string): Promise<{ data: TaskData; _hint: string }> {
  const data = await callBangtuApi<TaskData>("/result/taskStatusData", { query: { taskId }, apiKey });
  const intervalSeconds = Math.max(1, Math.round(pollIntervalMs / 1000));
  const hint =
    data.status === "SUCCESS"
      ? "任务已完成，可调用对应的结果获取工具。"
      : data.status === "FAILED"
        ? "任务失败，请查看 data.logs 了解原因。"
        : `任务仍在执行中，建议 ${intervalSeconds} 秒后再次查询。复杂图纸最长可能需约 ${maxTaskDurationMinutes} 分钟。`;
  return { data, _hint: hint };
}

async function callBangtuApi<T>(
  path: string,
  input: {
    method?: "GET" | "POST";
    query?: Record<string, string | number | boolean>;
    json?: JsonRecord;
    form?: Record<string, string>;
    formData?: FormData;
    apiKey: string;
  },
): Promise<T> {
  const target = new URL(path.replace(/^\/+/, ""), apiBaseUrl);
  if (target.origin !== apiBaseUrl.origin || !target.pathname.startsWith(apiBaseUrl.pathname)) {
    throw new Error("BangTu API path must stay within BANGTU_API_BASE_URL");
  }
  for (const [key, value] of Object.entries(input.query ?? {})) target.searchParams.set(key, String(value));

  const headers: Record<string, string> = { Accept: "application/json", apiKey: input.apiKey };

  let body: BodyInit | undefined;
  if (input.json) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(input.json);
  } else if (input.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(input.form);
  } else if (input.formData) {
    body = input.formData;
  }

  const response = await fetch(target, { method: input.method ?? "GET", headers, body });
  const raw = await response.text();
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(`BangTu API returned non-JSON response: ${raw.slice(0, 500)}`);
  }
  if (!response.ok) throw new Error(`BangTu API HTTP ${response.status} ${response.statusText}: ${JSON.stringify(parsed)}`);
  if (!isBangtuResponse(parsed)) throw new Error(`BangTu API returned an invalid response: ${JSON.stringify(parsed)}`);
  if (parsed.code !== 200) throw new Error(`BangTu API business error ${parsed.code}: ${parsed.message}`);
  return parsed.data as T;
}

function isBangtuResponse(value: unknown): value is BangtuResponse<unknown> {
  return Boolean(value && typeof value === "object" && "code" in value && "message" in value && "data" in value);
}

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

const app = express();
app.use(cors());
app.use(express.json({ limit: process.env.JSON_LIMIT ?? "10mb" }));
app.use(express.static("public", { index: "index.html" }));
app.get("/health", (_req, res) => res.json({ ok: true, service: "bangtu-open-api-mcp", version: "1.0.0" }));

const sseTransports = new Map<string, SSEServerTransport>();
const streamableTransports = new Map<string, StreamableHTTPServerTransport>();

app.get("/sse", async (_req: Request, res: Response) => {
  const transport = new SSEServerTransport("/messages", res);
  sseTransports.set(transport.sessionId, transport);
  res.on("close", () => sseTransports.delete(transport.sessionId));
  await createServer().connect(transport);
});

app.post("/messages", async (req: Request, res: Response) => {
  const sessionId = String(req.query.sessionId ?? "");
  const transport = sseTransports.get(sessionId);
  if (!transport) {
    res.status(404).json({ error: "Unknown SSE session" });
    return;
  }
  await transport.handlePostMessage(req, res, req.body);
});

app.post("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport = sessionId ? streamableTransports.get(sessionId) : undefined;
  if (!transport && isInitializeRequest(req.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        streamableTransports.set(id, transport!);
      },
    });
    transport.onclose = () => {
      if (transport?.sessionId) streamableTransports.delete(transport.sessionId);
    };
    await createServer().connect(transport);
  }
  if (!transport) {
    res.status(400).json({ error: "Missing or unknown MCP session" });
    return;
  }
  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? streamableTransports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).json({ error: "Missing or unknown MCP session" });
    return;
  }
  await transport.handleRequest(req, res);
});

app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? streamableTransports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).json({ error: "Missing or unknown MCP session" });
    return;
  }
  await transport.handleRequest(req, res);
});

app.listen(port, host, () => {
  console.log(`BangTu MCP listening on http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
  console.log(`Streamable HTTP: http://localhost:${port}/mcp`);
  console.log(`Legacy SSE: http://localhost:${port}/sse`);
});
