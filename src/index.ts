import "dotenv/config";
import cors from "cors";
import express, { type Request as ExpressRequest, type Response as ExpressResponse } from "express";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { apidocUrl, defaultApiBaseUrl, demoApiKey, mcpPublicUrl } from "./build-config.js";

type JsonRecord = Record<string, unknown>;
type TaskStatus = "RUNNING" | "SUCCESS" | "FAILED";
type Product = "architecture" | "electrical" | "hvac" | "plumbing" | "structure";

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
const apiBaseUrl = new URL(withTrailingSlash(process.env.BANGTU_API_BASE_URL ?? defaultApiBaseUrl));
const pollIntervalMs = Number(process.env.BANGTU_POLL_INTERVAL_MS ?? 5000);
const maxTaskDurationMinutes = Number(process.env.BANGTU_MAX_TASK_DURATION_MINUTES ?? 120);
// Keep one wait call below common Agent tool-call timeouts. Long jobs use repeated status calls.
const defaultWaitSeconds = Number(process.env.BANGTU_DEFAULT_WAIT_SECONDS ?? 20);
const maxWaitSeconds = Number(process.env.BANGTU_MAX_WAIT_SECONDS ?? 45);
// 与上游 OpenApiResultServiceImpl.PRE_DOWNLOAD_TOKEN_EXPIRE_MILLIS 保持一致：图元下载链接有效期 30 分钟。
const frameEntitiesDownloadUrlTtlSeconds = 30 * 60;

// MCP 服务接收的 JSON 请求体上限。fileBase64 走 JSON-RPC body，Base64 会把原始文件放大约 4/3，
// 因此该值直接决定远程 Agent 能上传的 DWG 大小：默认 200mb 时原始 DWG 上限约 150MB（200000000 / 4 * 3）。
// 生产部署如还有 Nginx / 网关在 MCP 前面，也需要同步放大 client_max_body_size，否则会先被网关以 413 拒绝。
const jsonBodyLimit = process.env.JSON_LIMIT ?? "200mb";
// fileBase64 字符数上限。必须与 jsonBodyLimit 对齐（Base64 字符数不会超过请求体字节数），
// 否则会出现「工具参数校验通过、却在传输层被 413 拒绝」这种难排查的失败。
const maxFileBase64Chars = 200_000_000;

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

const directResultDataTypes = {
  architecture: architectureDataTypes,
  electrical: ["texts", "subFrame"],
  hvac: ["subFrame"],
  plumbing: ["subFrame"],
  structure: ["subFrame"],
} as const satisfies Record<Product, readonly (typeof architectureDataTypes)[number][]>;

// 电气构件类型与后端 DataTypeEnum.java 保持一致：subFrameResult 的 dataTypeList 取值。
// 其中 all 表示全部构件，服务端在 dataTypeList 为空时也默认返回全部构件。
const electricalDataTypes = [
  "all",
  "axisNumber",
  "circuitBreaker",
  "isolationCircuitBreaker",
  "residualCurrentCircuitBreaker",
  "isolationResidualCurrentCircuitBreaker",
  "isolationSwitch",
  "contactor",
  "cps",
  "atse",
  "thermalRelay",
  "fuse",
  "outlet",
  "generatrix",
  "incomingLine",
  "spd",
  "scb",
  "distributionBox",
  "electricEnergyMeter",
  "currentTransformer",
  "overUnderVoltageProtector",
  "emergencyLightingCentralizedPowerSupply",
  "firePowerMonitoringModule",
  "electricalFireMonitoringModule",
  "currentLimitingElectricalFireProtector",
  "busDuct",
  "pluginBox",
  "punctureClamp",
  "transformer",
  "dieselGeneratorSet",
  "tse",
  "lightingTransformer",
  "electricMotor",
  "directionSignLamp",
  "exitLamp",
  "floorSignLamp",
  "lightingLamp",
  "switchDevice",
  "powerOutlet",
  "mainEquipotentialBox",
  "localEquipotentialBox",
  "groundWire",
  "lightningStrip",
  "lightningDownConductor",
  "cableTray",
  "powerRoute",
  "weakCurrentRoute",
  "fireRoute",
  "televisionOutlet",
  "telephoneOutlet",
  "informationOutlet",
  "homeWiringBox",
  "emergencyHelpAlarm",
  "camera",
  "doorContact",
  "videoIntercomHost",
  "videoIntercomExtension",
  "windowContact",
  "infraredDetector",
  "coConcentrationMonitor",
  "cardReader",
  "pointSmokeDetector",
  "pointHeatDetector",
  "shortCircuitIsolator",
  "combustibleGasDetector",
  "fireHydrantButton",
  "manualFireAlarmButton",
  "fireTelephoneExtension",
  "audibleVisualAlarm",
  "fireBroadcast",
  "broadcastModule",
  "fireDoorMonitoringModule",
  "controlModule",
  "moduleBox",
  "controlRoomExternalTelephone",
  "areaDisplay",
  "liquidLevelDisplay",
  "liquidLevelGauge",
  "pressureSwitch",
  "flowSwitch",
  "fireTerminalBox",
  "waterFlowIndicator",
  "signalValve",
  "alarmValve",
  "airOutlet",
  "fireDamper70",
  "fireDamper150",
  "fireDamper280",
  "regionalFireAlarm",
  "fireAlarmController",
  "fireLinkageController",
  "multiLineManualControlPanel",
  "graphicDisplayDevice",
  "controlRoomUps",
  "combustibleGasDetectorHost",
  "fireTelephoneHost",
  "fireBroadcastHost",
  "firePowerMonitoringHost",
  "electricalFireMonitoringHost",
  "fireDoorMonitoringHost",
  "fireDoorMonitoringExtension",
  "electricDoorCloser",
  "emergencyLightingController",
  "gasFireExtinguishingController",
  "gasDischargeIndicator",
  "dryPowderDischargeIndicator",
  "emergencyStartStopButton",
] as const;

// 暖通构件类型与后端 DataTypeEnum.java 保持一致：subFrameResult 的 dataTypeList 取值。
// all 表示全部构件，服务端在 dataTypeList 为空时也默认返回全部构件。
const heatingDataTypes = [
  "all",
  "axisNumber",
  "smokeExhaustExhaustFan",
  "smokeExhaustFan",
  "makeupSupplyFan",
  "pressurizationFan",
  "makeupFan",
  "exhaustFan",
  "exhaustFanSpecial",
  "supplyFan",
  "smokeExhaustValve",
  "smokeExhaustFireDamper",
  "fireDamper",
  "checkValve",
  "smokeExhaustExhaustOutlet",
  "smokeExhaustOutlet",
  "makeupOutlet",
  "makeupSupplyOutlet",
  "pressurizationOutlet",
  "exhaustOutlet",
  "supplyOutlet",
  "unknownOutlet",
  "smokeBarrier",
  "carbonMonoxideDetector",
  "smokeValveManualRelease",
  "normallyClosedSmokeOutlet",
  "normallyClosedPressurizationOutlet",
  "silencer",
  "staticPressureBox",
  "reducer",
  "elbow",
  "tee",
  "cross",
  "branchPipe",
  "vrfIndoorUnit",
  "vrfOutdoorUnit",
  "pressureGauge",
  "thermometer",
  "floorHeatingManifold",
  "floorHeatingCoil",
  "refrigerantPipe",
  "condensatePipe",
  "airConditioningDuct",
  "smokeExhaustExhaustDuct",
  "smokeExhaustDuct",
  "makeupSupplyDuct",
  "makeupDuct",
  "pressurizationDuct",
  "exhaustDuct",
  "supplyDuct",
  "unknownDuct",
  "smokeExhaustRiser",
  "smokeExhaustExhaustRiser",
  "makeupRiser",
  "makeupSupplyRiser",
  "pressurizationRiser",
  "exhaustRiser",
  "supplyRiser",
  "unknownRiser",
] as const;

// 给排水构件类型与后端 DataTypeEnum.java 保持一致：subFrameResult 的 dataTypeList 取值。
// all 表示全部构件，服务端在 dataTypeList 为空时也默认返回全部构件。
const wsdDataTypes = [
  "all",
  "axisNumber",
  "indoorFireHydrant",
  "testFireHydrantWithPressureGauge",
  "fireElevatorCollectionWell",
  "hPipeFitting",
  "inspectionPort",
  "endOfLineTestDevice",
  "sterilizer",
  "highLevelFireWaterTank",
  "flaredOutlet",
  "flowSwitch",
  "checkValve",
  "gateValve",
  "automaticExhaustValve",
  "floorSlabLine",
  "pressureGauge",
  "domesticWaterTank",
  "antiPestNet",
  "corrugatedPipe",
  "filter",
  "levelGauge",
  "electricValve",
  "waterLevelControlValve",
  "backflowPreventer",
  "pressureSwitch",
  "domesticWaterPump",
  "domesticHotWaterTank",
  "stopValve",
  "ballValve",
  "butterflyValve",
  "generalValve",
  "signalValve",
  "concentricReducingFitting",
  "rubberFlexibleJoint",
  "waterFlowIndicator",
  "unclassifiedCollectionWell",
  "waterMeter",
  "waterQualityMonitor",
  "pressureReducingValve",
  "floatValve",
  "floorCleanout",
  "greaseTrap",
  "waterBoiler",
  "waterHeater",
  "unclassifiedWaterTank",
  "unclassifiedWaterPump",
  "sprinklerHead",
  "fireExtinguisher",
  "fireHydrantStabilizingPump",
  "sprinklerStabilizingPump",
  "pressureTank",
  "indoorFireHydrantWithHoseReel",
  "floorDrain",
  "domesticHotWaterBox",
  "gateValveFixed",
  "indoorFireHydrantTestOnly",
  "manifold",
  "uncategorizedWaterPump",
  "outdoorFireHydrantMainPump",
  "indoorFireHydrantMainPump",
  "outdoorFireHydrantStabilizingPump",
  "indoorFireHydrantStabilizingPump",
  "reliefValve",
  "vehicleRampCollectionWell",
  "pumpFoundation",
  "indoorOutdoorFireHydrantCombinedMainPump",
  "unclassifiedPump",
  "sprinklerFireHydrantMainPump",
] as const;

// 结构构件类型与后端 DataTypeEnum.java 保持一致：subFrameResult 的 dataTypeList 取值。
// all 表示全部构件，服务端在 dataTypeList 为空时也默认返回全部构件。
// 带点号的是子构件（如 slab.slabCode），只请求子构件时只返回被请求的那部分字段；
// 文档未列出的构件（地库梁板柱、桩、筏板、承台、独立基础、楼梯、详图等）不支持单独查询，传入会报参数错误。
const structureDataTypes = [
  "all",
  "axisNumber",
  "dimInfo",
  "upBeam",
  "slab",
  "slab.slabCode",
  "slab.slabHole",
  "wallAxis",
  "wallAxis.qz_list",
  "wallAxis.qs_list",
  "qsTable",
  "qzTable",
] as const;

// 专业级别的上游契约：cv 为请求路径中的专业标识，taskType 为任务类型。
// preTaskPath / preTaskIdField 只对需要「先按项目聚合全部图框做预处理、再做单图框构件识别」的专业（电气、暖通）存在；
// 建筑、给排水、结构没有预处理任务，preTaskPath 与 preTaskIdField 均为 undefined。
const productInfo: Record<
  Product,
  { label: string; cv: string; taskType: string; preTaskPath?: string; preTaskIdField?: string; createTaskTool: string }
> = {
  architecture: { label: "建筑", cv: "building_cv", taskType: "BUILDING_CV", createTaskTool: "bangtu_create_architecture_task" },
  electrical: {
    label: "电气",
    cv: "electrical_cv",
    taskType: "ELECTRICAL_CV",
    preTaskPath: "/cv/electrical_cv/createPreTask",
    preTaskIdField: "electricalPreTaskId",
    createTaskTool: "bangtu_create_electrical_task",
  },
  hvac: {
    label: "暖通",
    cv: "heating_cv",
    taskType: "HEATING_CV",
    preTaskPath: "/cv/heating_cv/createPreTask",
    preTaskIdField: "heatingPreTaskId",
    createTaskTool: "bangtu_create_hvac_task",
  },
  plumbing: { label: "给排水", cv: "wsd_cv", taskType: "WSD_CV", createTaskTool: "bangtu_create_plumbing_task" },
  structure: { label: "结构", cv: "struct_cv", taskType: "STRUCT_CV", createTaskTool: "bangtu_create_structure_task" },
};

// 专业独立的 subFrameResult 子图框内容工具名。建筑当前上游没有该接口，因此不在表中。
const subFrameResultToolNames: Partial<Record<Product, string>> = {
  electrical: "bangtu_get_electrical_subframe_result",
  hvac: "bangtu_get_hvac_subframe_result",
  plumbing: "bangtu_get_plumbing_subframe_result",
  structure: "bangtu_get_structure_subframe_result",
};

const apiKeySchema = z.string().min(1).describe("帮图 API Key。本次调用会转发为上游 apiKey 请求头，不会由 MCP 服务保存或打印。收费环境请使用你自己的 API Key。 ");

function createServer(): McpServer {
  const server = new McpServer({
    name: "bangtu-open-api",
    version: "1.0.0",
  });

  server.tool(
    "bangtu_create_dwg_task",
    "上传 DWG 图纸并创建图纸基本信息识别任务（PRE 任务）。远程 Agent 优先传 fileBase64 和 fileName（平台附件转 Base64）；本地部署也支持 filePath 或 fileUrl，三种方式必须且只能选择一种。任务创建成功只表示后台任务已启动；请保存返回的 taskId，随后使用 bangtu_get_task_status 轮询至 SUCCESS，再调用 bangtu_get_frame_result 获取图框、图签和坐标等结构化解析结果。项目包含多张 DWG 时，应对每张 DWG 分别调用本工具上传，直到全部 PRE 任务 SUCCESS，再用 bangtu_get_frame_result 汇总 frameId，这一步是电气、暖通项目级预处理的前置条件。",
    {
      apiKey: apiKeySchema,
      fileBase64: z.string().min(1).max(maxFileBase64Chars).optional().describe("远程平台附件的 Base64 内容，可包含或不包含 data:*;base64, 前缀，最大约 200 MB Base64 字符（对应原始 DWG 约 150MB）。与 fileName 一起传入；与 filePath、fileUrl 三选一。文件较大时优先改用 fileUrl，避免 Base64 膨胀占用传输带宽和服务端内存。"),
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
      return textResult({
        data,
        _hint: "DWG 任务已创建。请保存 taskId，并使用 bangtu_get_task_status 每 3 至 5 秒轮询任务状态；PRE 任务 SUCCESS 后再调用 bangtu_get_frame_result 获取 frameId。若项目有多张 DWG，请对每张分别上传并汇总 frameId。",
      });
    },
  );

  // 电气识别预处理任务：把同一个项目里全部待识别的电气图框一次性聚合预处理，
  // 得到属于整个项目的电气全局信息，供后续单图框电气构件识别复用。
  server.tool(
    "bangtu_create_electrical_pre_task",
    "创建电气识别预处理任务（ELECTRICAL_PRE_CV）。固定请求 POST /cv/electrical_cv/createPreTask，Content-Type: application/json，请求体为 { frameIds: string[] }。作用：把同一个项目里所有需要识别的电气图框一次性聚合起来做统一预处理，先得到整个项目的电气全局信息，再进入单图框构件识别，避免逐图框重复预处理。必须严格遵守调用顺序：第 1 步 bangtu_create_dwg_task 上传项目内全部 DWG，并轮询各自 PRE 任务至 SUCCESS；第 2 步对每个 PRE 任务调用 bangtu_get_frame_result，汇总本项目全部 frameId；第 3 步调用本工具，把这些 frameId 一次性放入 frameIds 创建电气预处理任务（整个项目只调用一次，不要逐图框调用）；第 4 步用 bangtu_get_task_status 或 bangtu_wait_task 轮询本工具返回的 taskId 至 SUCCESS；第 5 步把该 taskId 作为 electricalPreTaskId 传给 bangtu_create_electrical_task 创建单图框电气构件识别任务。本工具只创建预处理任务并立即返回 taskId（即 electricalPreTaskId），不等待预处理完成。注意：建筑、给排水、结构没有预处理任务，不要对它们调用本工具。",
    {
      apiKey: apiKeySchema,
      frameIds: z
        .array(z.string().min(1))
        .min(1)
        .describe("待预处理的电气图框唯一标识列表，取自 bangtu_get_frame_result 返回的 frameId。应一次性传入本项目全部需要识别的电气图框，其预处理结果会被复用。必须按字符串传递，不能转换为数字。"),
    },
    async ({ apiKey, frameIds }) => {
      const data = await callBangtuApi<TaskData>(productInfo.electrical.preTaskPath!, {
        method: "POST",
        json: { frameIds },
        apiKey,
      });
      return textResult({
        data,
        _hint: `电气预处理任务已创建，本次共聚合 ${frameIds.length} 个图框。请保存 taskId（即 electricalPreTaskId），先用 bangtu_get_task_status 轮询至 SUCCESS，再把该 taskId 传给 bangtu_create_electrical_task 创建单图框电气构件识别任务。`,
      });
    },
  );

  // 暖通识别预处理任务：与电气预处理同构，把项目内全部暖通图框聚合预处理后复用到单图框识别。
  server.tool(
    "bangtu_create_hvac_pre_task",
    "创建暖通识别预处理任务（HEATING_PRE_CV）。固定请求 POST /cv/heating_cv/createPreTask，Content-Type: application/json，请求体为 { frameIds: string[] }。作用：把同一个项目里所有需要识别的暖通图框一次性聚合起来做统一预处理，先得到整个项目的暖通全局信息，再进入单图框构件识别，避免逐图框重复预处理。必须严格遵守调用顺序：第 1 步 bangtu_create_dwg_task 上传项目内全部 DWG，并轮询各自 PRE 任务至 SUCCESS；第 2 步对每个 PRE 任务调用 bangtu_get_frame_result，汇总本项目全部 frameId；第 3 步调用本工具，把这些 frameId 一次性放入 frameIds 创建暖通预处理任务（整个项目只调用一次，不要逐图框调用）；第 4 步用 bangtu_get_task_status 或 bangtu_wait_task 轮询本工具返回的 taskId 至 SUCCESS；第 5 步把该 taskId 作为 heatingPreTaskId 传给 bangtu_create_hvac_task 创建单图框暖通构件识别任务。本工具只创建预处理任务并立即返回 taskId（即 heatingPreTaskId），不等待预处理完成。注意：建筑、给排水、结构没有预处理任务，不要对它们调用本工具。",
    {
      apiKey: apiKeySchema,
      frameIds: z
        .array(z.string().min(1))
        .min(1)
        .describe("待预处理的暖通图框唯一标识列表，取自 bangtu_get_frame_result 返回的 frameId。应一次性传入本项目全部需要识别的暖通图框，其预处理结果会被复用。必须按字符串传递，不能转换为数字。"),
    },
    async ({ apiKey, frameIds }) => {
      const data = await callBangtuApi<TaskData>(productInfo.hvac.preTaskPath!, {
        method: "POST",
        json: { frameIds },
        apiKey,
      });
      return textResult({
        data,
        _hint: `暖通预处理任务已创建，本次共聚合 ${frameIds.length} 个图框。请保存 taskId（即 heatingPreTaskId），先用 bangtu_get_task_status 轮询至 SUCCESS，再把该 taskId 传给 bangtu_create_hvac_task 创建单图框暖通构件识别任务。`,
      });
    },
  );

  server.tool(
    "bangtu_create_architecture_task",
    "创建建筑（BUILDING_CV）构件识别任务。固定请求 POST /cv/building_cv/createTask，Content-Type: application/x-www-form-urlencoded，表单参数只有 frameId。调用顺序：第 1 步 bangtu_create_dwg_task 上传 DWG 并轮询 PRE 任务至 SUCCESS；第 2 步 bangtu_get_frame_result 取得 frameId；第 3 步调用本工具创建建筑构件识别任务；第 4 步用 bangtu_get_task_status 或 bangtu_wait_task 轮询至 SUCCESS；第 5 步用 bangtu_get_cv_result 传 product=architecture 获取结果。建筑没有预处理任务，不要调用任何预处理工具，frameId 直接传入即可。每次调用只为一个图框创建任务，多个图框需要分别调用；任务创建成功不代表识别完成。",
    {
      apiKey: apiKeySchema,
      frameId: z.string().min(1).describe("来自 bangtu_get_frame_result 的图框唯一标识 frameId。必须按字符串传递，不能转换为数字。"),
    },
    async ({ apiKey, frameId }) => {
      const data = await callBangtuApi<TaskData>("/cv/building_cv/createTask", { method: "POST", form: { frameId }, apiKey });
      return textResult({
        data,
        _hint: "建筑构件识别任务已创建。请保存 taskId，使用 bangtu_get_task_status 轮询至 SUCCESS，再用 bangtu_get_cv_result（product=architecture）获取 23 种结果。",
      });
    },
  );

  server.tool(
    "bangtu_create_electrical_task",
    "创建电气（ELECTRICAL_CV）构件识别任务。固定请求 POST /cv/electrical_cv/createTask，Content-Type: application/x-www-form-urlencoded，表单参数为 electricalPreTaskId 和 frameId。必须严格遵守调用顺序：第 1 步 bangtu_create_dwg_task 上传项目内全部 DWG 并轮询各自 PRE 任务至 SUCCESS；第 2 步 bangtu_get_frame_result 汇总 frameId；第 3 步 bangtu_create_electrical_pre_task 一次性传入全部 frameId 创建电气预处理任务，保存返回的 electricalPreTaskId（整个项目只需一次）；第 4 步轮询该预处理任务至 SUCCESS，未成功前本接口会创建失败；第 5 步调用本工具，传入 electricalPreTaskId 与单个 frameId 创建电气构件识别任务；第 6 步轮询至 SUCCESS；第 7 步用 bangtu_get_cv_result（product=electrical，dataType=texts 取图框文字、dataType=subFrame 取子图框基本信息），再用 bangtu_get_electrical_subframe_result 取指定子图框内的电气构件。每次调用只为一个图框创建任务，多个图框需要分别调用本接口并复用同一个 electricalPreTaskId。",
    {
      apiKey: apiKeySchema,
      electricalPreTaskId: z
        .string()
        .min(1)
        .describe("电气预处理任务 ID，来自 bangtu_create_electrical_pre_task 返回的 taskId，且该预处理任务必须已 SUCCESS。必须按字符串传递，不能转换为数字。"),
      frameId: z.string().min(1).describe("待识别电气图框的唯一标识，来自 bangtu_get_frame_result。每次调用只传一个图框。"),
    },
    async ({ apiKey, electricalPreTaskId, frameId }) => {
      const data = await callBangtuApi<TaskData>("/cv/electrical_cv/createTask", {
        method: "POST",
        form: { electricalPreTaskId, frameId },
        apiKey,
      });
      return textResult({
        data,
        _hint: "电气构件识别任务已创建。请保存 taskId，使用 bangtu_get_task_status 轮询至 SUCCESS，再用 bangtu_get_cv_result（product=electrical）和 bangtu_get_electrical_subframe_result 获取结果。",
      });
    },
  );

  server.tool(
    "bangtu_create_hvac_task",
    "创建暖通（HEATING_CV）构件识别任务。固定请求 POST /cv/heating_cv/createTask，Content-Type: application/x-www-form-urlencoded，表单参数为 heatingPreTaskId 和 frameId。必须严格遵守调用顺序：第 1 步 bangtu_create_dwg_task 上传项目内全部 DWG 并轮询各自 PRE 任务至 SUCCESS；第 2 步 bangtu_get_frame_result 汇总 frameId；第 3 步 bangtu_create_hvac_pre_task 一次性传入全部 frameId 创建暖通预处理任务，保存返回的 heatingPreTaskId（整个项目只需一次）；第 4 步轮询该预处理任务至 SUCCESS，未成功前本接口会创建失败；第 5 步调用本工具，传入 heatingPreTaskId 与单个 frameId 创建暖通构件识别任务；第 6 步轮询至 SUCCESS；第 7 步用 bangtu_get_cv_result（product=hvac，dataType=subFrame）取子图框基本信息，再用 bangtu_get_hvac_subframe_result 取指定子图框内的暖通构件。每次调用只为一个图框创建任务，多个图框需要分别调用本接口并复用同一个 heatingPreTaskId。",
    {
      apiKey: apiKeySchema,
      heatingPreTaskId: z
        .string()
        .min(1)
        .describe("暖通预处理任务 ID，来自 bangtu_create_hvac_pre_task 返回的 taskId，且该预处理任务必须已 SUCCESS。必须按字符串传递，不能转换为数字。"),
      frameId: z.string().min(1).describe("待识别暖通图框的唯一标识，来自 bangtu_get_frame_result。每次调用只传一个图框。"),
    },
    async ({ apiKey, heatingPreTaskId, frameId }) => {
      const data = await callBangtuApi<TaskData>("/cv/heating_cv/createTask", {
        method: "POST",
        form: { heatingPreTaskId, frameId },
        apiKey,
      });
      return textResult({
        data,
        _hint: "暖通构件识别任务已创建。请保存 taskId，使用 bangtu_get_task_status 轮询至 SUCCESS，再用 bangtu_get_cv_result（product=hvac）和 bangtu_get_hvac_subframe_result 获取结果。",
      });
    },
  );

  server.tool(
    "bangtu_create_plumbing_task",
    "创建给排水（WSD_CV）构件识别任务。固定请求 POST /cv/wsd_cv/createTask，Content-Type: application/x-www-form-urlencoded，表单参数只有 frameId。调用顺序：第 1 步 bangtu_create_dwg_task 上传 DWG 并轮询 PRE 任务至 SUCCESS；第 2 步 bangtu_get_frame_result 取得 frameId；第 3 步调用本工具创建给排水构件识别任务；第 4 步用 bangtu_get_task_status 或 bangtu_wait_task 轮询至 SUCCESS；第 5 步用 bangtu_get_cv_result（product=plumbing，dataType=subFrame）取子图框基本信息，再用 bangtu_get_plumbing_subframe_result 取指定子图框内的给排水构件。给排水没有预处理任务，不要调用任何预处理工具，frameId 直接传入即可。每次调用只为一个图框创建任务，多个图框需要分别调用；任务创建成功不代表识别完成。",
    {
      apiKey: apiKeySchema,
      frameId: z.string().min(1).describe("来自 bangtu_get_frame_result 的图框唯一标识 frameId。必须按字符串传递，不能转换为数字。"),
    },
    async ({ apiKey, frameId }) => {
      const data = await callBangtuApi<TaskData>("/cv/wsd_cv/createTask", { method: "POST", form: { frameId }, apiKey });
      return textResult({
        data,
        _hint: "给排水构件识别任务已创建。请保存 taskId，使用 bangtu_get_task_status 轮询至 SUCCESS，再用 bangtu_get_cv_result（product=plumbing）和 bangtu_get_plumbing_subframe_result 获取结果。",
      });
    },
  );

  server.tool(
    "bangtu_create_structure_task",
    "创建结构（STRUCT_CV）构件识别任务。固定请求 POST /cv/struct_cv/createTask，Content-Type: application/x-www-form-urlencoded，表单参数只有 frameId。调用顺序：第 1 步 bangtu_create_dwg_task 上传 DWG 并轮询 PRE 任务至 SUCCESS；第 2 步 bangtu_get_frame_result 取得 frameId；第 3 步调用本工具创建结构构件识别任务；第 4 步用 bangtu_get_task_status 或 bangtu_wait_task 轮询至 SUCCESS；第 5 步用 bangtu_get_cv_result（product=structure，dataType=subFrame）取子图框基本信息，再用 bangtu_get_structure_subframe_result 取指定子图框内的结构构件。结构没有预处理任务，不要调用任何预处理工具，frameId 直接传入即可。每次调用只为一个图框创建任务，多个图框需要分别调用；任务创建成功不代表识别完成。",
    {
      apiKey: apiKeySchema,
      frameId: z.string().min(1).describe("来自 bangtu_get_frame_result 的图框唯一标识 frameId。必须按字符串传递，不能转换为数字。"),
    },
    async ({ apiKey, frameId }) => {
      const data = await callBangtuApi<TaskData>("/cv/struct_cv/createTask", { method: "POST", form: { frameId }, apiKey });
      return textResult({
        data,
        _hint: "结构构件识别任务已创建。请保存 taskId，使用 bangtu_get_task_status 轮询至 SUCCESS，再用 bangtu_get_cv_result（product=structure）和 bangtu_get_structure_subframe_result 获取结果。",
      });
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
    "获取 DWG 图纸基本信息识别的图框结果。仅当 PRE 任务状态为 SUCCESS 时调用。返回 data 图框数组，数组元素含 frameId、layoutName、frameWcsLoc、signInfo（图签识别内容）和 rotation。frameId 是所有专业任务的入参来源，但不同专业下一步不同：建筑调用 bangtu_create_architecture_task、给排水调用 bangtu_create_plumbing_task、结构调用 bangtu_create_structure_task，这三者直接把 frameId 传入即可，没有预处理步骤；电气必须先汇总本项目全部电气图框的 frameId，调用 bangtu_create_electrical_pre_task 做项目级聚合预处理；暖通同理先调用 bangtu_create_hvac_pre_task，等预处理任务 SUCCESS 后再分别调用 bangtu_create_electrical_task / bangtu_create_hvac_task 按单图框创建构件识别任务。",
    {
      apiKey: apiKeySchema,
      taskId: z.string().min(1).describe("DWG 基本信息识别 PRE 任务的 taskId。"),
    },
    async ({ apiKey, taskId }) => {
      const data = await callBangtuApi<unknown[]>("/result/pre/frameBaseInfo", { query: { id: taskId }, apiKey });
      return textResult({
        data,
        _hint: "已返回图框结果。建筑、给排水、结构可用 frameId 直接调用对应的 bangtu_create_architecture_task / bangtu_create_plumbing_task / bangtu_create_structure_task；电气、暖通必须先汇总本项目全部 frameId，调用 bangtu_create_electrical_pre_task / bangtu_create_hvac_pre_task 完成项目级聚合预处理，预处理 SUCCESS 后再按单图框创建构件识别任务。",
      });
    },
  );

  server.tool(
    "bangtu_get_cv_result",
    "获取建筑、电气、暖通、给排水、结构专业当前已开放的普通结果和 subFrame 子图框基本信息。仅当对应专业任务状态为 SUCCESS 时调用。所有结果均使用同一请求契约：GET /result/{专业路径}/{dataType}?id={taskId}。当前支持范围：建筑支持 23 种 dataType（包含 subFrame）；电气支持 texts 和 subFrame；暖通支持 subFrame；给排水支持 subFrame；结构支持 subFrame。这里的 subFrame 只返回子图框基本信息，不返回指定子图框内的构件内容。subFrameResult 内容接口按专业独立：当前电气、暖通、给排水、结构分别使用各自的 bangtu_get_*_subframe_result 工具，建筑目前没有对应内容接口。未来任何专业新增同一 GET 契约的结果类型，都继续加入本工具对应专业的支持范围。",
    {
      apiKey: apiKeySchema,
      product: z.enum(["architecture", "electrical", "hvac", "plumbing", "structure"]).describe("结果所属专业：architecture 建筑、electrical 电气、hvac 暖通、plumbing 给排水、structure 结构。五个当前已开放专业均由本工具统一支持。"),
      taskId: z.string().min(1).describe("对应专业构件识别任务的 taskId。必须按字符串传递，不能转换为数字。"),
      dataType: z.enum(architectureDataTypes).describe("该专业已开放的普通结果类型或 subFrame 子图框基本信息。当前 architecture 支持完整枚举；electrical 支持 texts、subFrame；hvac 支持 subFrame；plumbing 支持 subFrame；structure 支持 subFrame。subFrame 不是子图框内容接口。建筑类型：axisNumber 轴号、indexNumber 索引号、texts 图框文字、textelvation 标高符号、arrows 箭头、alignedDims 标尺线、subFrame 子图框基本信息、planRoom 房间、planStair 楼梯、planLift 电梯、planDoor 门、planWindow 窗、facadeStorey 立面楼层、sectionStorey 剖面楼层及各类详图。"),
    },
    async ({ apiKey, product, taskId, dataType }) => {
      const allowedDataTypes: readonly string[] = directResultDataTypes[product];
      if (!allowedDataTypes.includes(dataType)) {
        throw new Error(`${product} does not support direct result dataType ${dataType}. Allowed values: ${allowedDataTypes.join(", ")}`);
      }
      const data = await callBangtuApi<unknown[]>(`/result/${productInfo[product].cv}/${dataType}`, { query: { id: taskId }, apiKey });
      const result = { product, dataType, data };
      if (dataType !== "subFrame") return textResult(result);
      const subFrameToolName = subFrameResultToolNames[product];
      if (!subFrameToolName) {
        return textResult({
          ...result,
          _hint: `已返回${productInfo[product].label}子图框基本信息。当前上游未提供该专业的 subFrameResult 子图框内容接口，因此没有后续的子图框内容工具。`,
        });
      }
      return textResult({
        ...result,
        _hint: `已返回${productInfo[product].label}子图框基本信息列表。选择目标 subFrameId 后，调用该专业独立的 ${subFrameToolName} 获取指定子图框内容。`,
        _nextAction: `Call ${subFrameToolName} with the same taskId and a chosen subFrameId.`,
      });
    },
  );

  server.tool(
    "bangtu_get_electrical_subframe_result",
    "获取指定电气子图框的内容（构件识别结果）。仅当 ELECTRICAL_CV 任务状态为 SUCCESS，且已通过 bangtu_get_cv_result 的 electrical/subFrame 基本信息结果取得 subFrameId 后调用。该工具是电气专业独立的 subFrameResult 接口，固定请求 POST /result/electrical_cv/subFrameResult，subFrameId 必填；dataTypeList 可筛选 lightingLamp 照明灯、powerOutlet 电源插座、distributionBox 配电箱、camera 摄像机等电气构件，不传时默认返回全部构件。",
    {
      apiKey: apiKeySchema,
      taskId: z.string().min(1).describe("电气构件识别 ELECTRICAL_CV 任务的 taskId，来自 bangtu_create_electrical_task。必须按字符串传递，不能转换为数字。"),
      subFrameId: z.string().min(1).describe("电气子图框 ID，必须先调用 bangtu_get_cv_result 并请求 electrical 的 subFrame 结果取得。"),
      dataTypeList: z
        .array(z.enum(electricalDataTypes))
        .optional()
        .describe(`要获取的电气构件类型列表，完整取值见本参数枚举定义（共 ${electricalDataTypes.length} 种，含 all 全部构件）。不传或传空数组时服务端默认返回全部构件。`),
    },
    async ({ apiKey, taskId, subFrameId, dataTypeList }) => {
      const body: { taskId: string; subFrameId: string; dataTypeList?: string[] } = { taskId, subFrameId };
      if (dataTypeList && dataTypeList.length > 0) body.dataTypeList = [...dataTypeList];
      const data = await callBangtuApi<unknown>("/result/electrical_cv/subFrameResult", { method: "POST", json: body, apiKey });
      return textResult({ subFrameId, dataTypeList: dataTypeList ?? [], data });
    },
  );

  server.tool(
    "bangtu_get_hvac_subframe_result",
    "获取指定暖通子图框的内容（构件识别结果）。仅当 HEATING_CV 任务状态为 SUCCESS，且已通过 bangtu_get_cv_result 的 hvac/subFrame 基本信息结果取得 subFrameId 后调用。该工具是暖通专业独立的 subFrameResult 接口，固定请求 POST /result/heating_cv/subFrameResult，subFrameId 必填；dataTypeList 可筛选 exhaustFan 排风机、supplyFan 送风机、supplyDuct 送风风管、fireDamper 防火阀、vrfIndoorUnit 多联机内机等暖通构件，不传时默认返回全部构件。",
    {
      apiKey: apiKeySchema,
      taskId: z.string().min(1).describe("暖通构件识别 HEATING_CV 任务的 taskId，来自 bangtu_create_hvac_task。必须按字符串传递，不能转换为数字。"),
      subFrameId: z.string().min(1).describe("暖通子图框 ID，必须先调用 bangtu_get_cv_result 并请求 hvac 的 subFrame 结果取得。"),
      dataTypeList: z
        .array(z.enum(heatingDataTypes))
        .optional()
        .describe(`要获取的暖通构件类型列表，完整取值见本参数枚举定义（共 ${heatingDataTypes.length} 种，含 all 全部构件）。不传或传空数组时服务端默认返回全部构件。`),
    },
    async ({ apiKey, taskId, subFrameId, dataTypeList }) => {
      const body: { taskId: string; subFrameId: string; dataTypeList?: string[] } = { taskId, subFrameId };
      if (dataTypeList && dataTypeList.length > 0) body.dataTypeList = [...dataTypeList];
      const data = await callBangtuApi<unknown>("/result/heating_cv/subFrameResult", { method: "POST", json: body, apiKey });
      return textResult({ subFrameId, dataTypeList: dataTypeList ?? [], data });
    },
  );

  server.tool(
    "bangtu_get_plumbing_subframe_result",
    "获取指定给排水子图框的内容（构件识别结果）。仅当 WSD_CV 任务状态为 SUCCESS，且已通过 bangtu_get_cv_result 的 plumbing/subFrame 基本信息结果取得 subFrameId 后调用。该工具是给排水专业独立的 subFrameResult 接口，固定请求 POST /result/wsd_cv/subFrameResult，subFrameId 必填；dataTypeList 可筛选 indoorFireHydrant 室内消火栓、sprinklerHead 喷头、gateValve 闸阀、butterflyValve 蝶阀、waterMeter 水表等给排水构件，不传时默认返回全部构件。",
    {
      apiKey: apiKeySchema,
      taskId: z.string().min(1).describe("给排水构件识别 WSD_CV 任务的 taskId，来自 bangtu_create_plumbing_task。必须按字符串传递，不能转换为数字。"),
      subFrameId: z.string().min(1).describe("给排水子图框 ID，必须先调用 bangtu_get_cv_result 并请求 plumbing 的 subFrame 结果取得。"),
      dataTypeList: z
        .array(z.enum(wsdDataTypes))
        .optional()
        .describe(`要获取的给排水构件类型列表，完整取值见本参数枚举定义（共 ${wsdDataTypes.length} 种，含 all 全部构件）。不传或传空数组时服务端默认返回全部构件。`),
    },
    async ({ apiKey, taskId, subFrameId, dataTypeList }) => {
      const body: { taskId: string; subFrameId: string; dataTypeList?: string[] } = { taskId, subFrameId };
      if (dataTypeList && dataTypeList.length > 0) body.dataTypeList = [...dataTypeList];
      const data = await callBangtuApi<unknown>("/result/wsd_cv/subFrameResult", { method: "POST", json: body, apiKey });
      return textResult({ subFrameId, dataTypeList: dataTypeList ?? [], data });
    },
  );

  server.tool(
    "bangtu_get_structure_subframe_result",
    "获取指定结构子图框的内容（构件识别结果）。仅当 STRUCT_CV 任务状态为 SUCCESS，且已通过 bangtu_get_cv_result 的 structure/subFrame 基本信息结果取得 subFrameId 后调用。该工具是结构专业独立的 subFrameResult 接口，固定请求 POST /result/struct_cv/subFrameResult，subFrameId 必填；dataTypeList 可筛选 axisNumber 轴号、dimInfo 标注线、upBeam 住宅梁、slab 住宅板、wallAxis 墙平面、qsTable 墙身表、qzTable 墙柱表等结构构件（含 slab.slabCode、wallAxis.qz_list 等子构件），不传时默认返回全部构件。子图框类型为 AXIS 轴网和 TABLE 表格时才有构件结果，其他子图框当前只返回基本信息。",
    {
      apiKey: apiKeySchema,
      taskId: z.string().min(1).describe("结构构件识别 STRUCT_CV 任务的 taskId，来自 bangtu_create_structure_task。必须按字符串传递，不能转换为数字。"),
      subFrameId: z.string().min(1).describe("结构子图框 ID，必须先调用 bangtu_get_cv_result 并请求 structure 的 subFrame 结果取得。"),
      dataTypeList: z
        .array(z.enum(structureDataTypes))
        .optional()
        .describe(`要获取的结构构件类型列表，完整取值见本参数枚举定义（共 ${structureDataTypes.length} 种，含 all 全部构件；带点号的是子构件）。未列出的构件不支持单独查询，传入会返回参数错误。不传或传空数组时服务端默认返回全部构件。`),
    },
    async ({ apiKey, taskId, subFrameId, dataTypeList }) => {
      const body: { taskId: string; subFrameId: string; dataTypeList?: string[] } = { taskId, subFrameId };
      if (dataTypeList && dataTypeList.length > 0) body.dataTypeList = [...dataTypeList];
      const data = await callBangtuApi<unknown>("/result/struct_cv/subFrameResult", { method: "POST", json: body, apiKey });
      return textResult({ subFrameId, dataTypeList: dataTypeList ?? [], data });
    },
  );

  server.tool(
    "bangtu_get_frame_entities_download_url",
    `获取指定图框内 CAD 图元数据的下载链接，由调用方自行下载和解析。固定请求 GET /result/pre/download/drawingFrameEntitiesUrl?frameId={frameId}。上游网关会把业务结果再包一层，真实地址位于 data.data（形如 http(s)://{host}/openApi/result/pre/drawingFrameEntitiesForUrl/{JWT}，JWT 的 sub 即 frameId、exp 为 30 分钟后），本工具已自动解包，直接返回 downloadUrl，链接有效期 ${frameEntitiesDownloadUrlTtlSeconds / 60} 分钟。本工具只返回链接，不下载、不解压、不解析文件。同一 frameId 的链接在有效期内可重复使用，上游对取链接接口启用了 sentinel 限流（返回 429 请求过于频繁），请勿连续重复调用本工具，也不要自行请求上游地址做诊断。frameId 来自 bangtu_get_frame_result，且必须与同一 PRE 任务的结果一致。调用方需在有效期内自行 GET 该链接：响应为 attachment 文件流（Content-Type: application/octet-stream，文件名 {frameId}-Entities.json.gz），内容是 gzip 压缩的 UTF-8 JSON，解压后按 CAD 图元类型（AcDbLine、AcDbPolyline、AcDbText、AcDbBlockReference 等）分数组存放，每个图元含公共字段 super；文件压缩前可能达几十 MB。链接过期或无效时该地址返回通用 JSON 错误结构，此时重新调用本工具获取新链接。`,
    {
      apiKey: apiKeySchema,
      frameId: z.string().min(1).describe("来自 bangtu_get_frame_result 的图框唯一标识 frameId。必须按字符串传递，不要转换为数字。"),
    },
    async ({ apiKey, frameId }) => {
      // 用 frameId 换取有效期 30 分钟的下载链接，只把链接交给调用方，服务端不下载文件内容。
      // 上游会把业务结果再包一层（{ code, message, data: { code, message, data: url } }），此处统一解包。
      const payload = await callBangtuApi<unknown>("/result/pre/download/drawingFrameEntitiesUrl", { query: { frameId }, apiKey });
      const downloadUrl = extractFrameEntitiesDownloadUrl(payload);
      if (!downloadUrl) {
        throw new Error(`BangTu API did not return a frame entities download URL: ${JSON.stringify(payload).slice(0, 500)}`);
      }
      return textResult({
        frameId,
        downloadUrl,
        downloadUrlExpiresInSeconds: frameEntitiesDownloadUrlTtlSeconds,
        fileName: `${frameId}-Entities.json.gz`,
        contentType: "application/octet-stream",
        _hint: "请直接 GET downloadUrl 下载 .json.gz 文件并在本地解压。链接 30 分钟内有效，过期后重新调用本工具获取新链接。",
      });
    },
  );

  server.tool(
    "bangtu_capture_screenshot_in_frame",
    "对指定图框内的矩形区域截图并返回 PNG 图片。固定请求 POST /result/pre/download/captureScreenshotInFrame，请求体为 JSON { frameId, wcsLoc }；成功时以 attachment 返回 image/png 文件流，失败时返回通用 JSON 错误结构。frameId 来自 bangtu_get_frame_result。wcsLoc 采用与 frameWcsLoc 相同的布局内相对坐标（WCS）：Y 轴向上，必须满足 top > bottom，且必须完全位于图框范围内，否则请求失败；截取整个图框时可直接使用 frameWcsLoc 原值。本工具返回位图，适合对结构化识别结果做局部核对，不建议用整张图框截图替代结构化识别。",
    {
      apiKey: apiKeySchema,
      frameId: z.string().min(1).describe("来自 bangtu_get_frame_result 的图框唯一标识 frameId。必须按字符串传递，不要转换为数字。"),
      wcsLoc: z
        .object({
          left: z.number().describe("范围左边界，即最小 X 值。"),
          top: z.number().describe("范围上边界，即最大 Y 值。必须大于 bottom。"),
          right: z.number().describe("范围右边界，即最大 X 值。"),
          bottom: z.number().describe("范围下边界，即最小 Y 值。"),
        })
        .describe("截图范围，采用布局内相对坐标（WCS），Y 轴向上，必须 top > bottom，且完全位于图框 frameWcsLoc 范围内。"),
    },
    async ({ apiKey, frameId, wcsLoc }) => {
      if (!(wcsLoc.top > wcsLoc.bottom)) throw new Error("wcsLoc.top must be greater than wcsLoc.bottom");
      if (!(wcsLoc.right > wcsLoc.left)) throw new Error("wcsLoc.right must be greater than wcsLoc.left");
      const file = await callBangtuFile("/result/pre/download/captureScreenshotInFrame", {
        method: "POST",
        json: { frameId, wcsLoc },
        apiKey,
      });
      return binaryResult({
        bytes: file.bytes,
        mimeType: file.contentType || "image/png",
        meta: {
          frameId,
          wcsLoc,
          fileName: file.fileName ?? `${frameId}-screenshot.png`,
          contentType: file.contentType,
          bytes: file.bytes.byteLength,
        },
      });
    },
  );

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

// 上游网关会把控制器返回的 RpcResult 再包一层（{ code, message, data: { code, message, data: url } }），
// 因此不能假设 data 就是裸 URL 字符串，这里同时兼容「裸字符串」与「嵌套一层」两种形态。
function extractFrameEntitiesDownloadUrl(value: unknown): string | undefined {
  const candidate = typeof value === "string" ? value : value && typeof value === "object" ? (value as JsonRecord).data : undefined;
  if (typeof candidate !== "string") return undefined;
  const trimmed = candidate.trim();
  return trimmed || undefined;
}

// 上游文件流接口（如 /result/pre/download/captureScreenshotInFrame）成功时返回二进制附件，
// 而不是统一 JSON 结构，因此单独请求并区分「成功文件流」与「失败 JSON 错误报文」两种情况。
async function callBangtuFile(
  path: string,
  input: {
    method?: "GET" | "POST";
    query?: Record<string, string | number | boolean>;
    json?: JsonRecord;
    apiKey: string;
  },
): Promise<{ bytes: Uint8Array; contentType: string; fileName?: string }> {
  const target = new URL(path.replace(/^\/+/, ""), apiBaseUrl);
  if (target.origin !== apiBaseUrl.origin || !target.pathname.startsWith(apiBaseUrl.pathname)) {
    throw new Error("BangTu API path must stay within BANGTU_API_BASE_URL");
  }
  for (const [key, value] of Object.entries(input.query ?? {})) target.searchParams.set(key, String(value));

  const headers: Record<string, string> = { Accept: "*/*", apiKey: input.apiKey };
  let body: BodyInit | undefined;
  if (input.json) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(input.json);
  }

  const response = await fetch(target, { method: input.method ?? "GET", headers, body });
  return readAttachmentResponse(response);
}

// 读取上游文件流接口响应：成功为二进制附件（application/octet-stream 或 image/png），
// 失败为 application/json 通用错误结构。图元下载链接接口与其它文件流接口共用此逻辑。
async function readAttachmentResponse(response: Response): Promise<{ bytes: Uint8Array; contentType: string; fileName?: string }> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || contentType.includes("application/json")) {
    const raw = await response.text();
    let parsed: unknown;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      throw new Error(`BangTu API returned ${response.status} ${response.statusText}: ${raw.slice(0, 500)}`);
    }
    if (isBangtuResponse(parsed) && parsed.code !== 200) {
      throw new Error(`BangTu API business error ${parsed.code}: ${parsed.message}`);
    }
    throw new Error(`BangTu API HTTP ${response.status} ${response.statusText}: ${JSON.stringify(parsed)}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) throw new Error("BangTu API returned an empty file stream");
  return { bytes, contentType, fileName: parseContentDispositionFileName(response.headers.get("content-disposition")) };
}

// 从 Content-Disposition 解析文件名，优先取 filename*=utf-8'' 形式。
function parseContentDispositionFileName(disposition: string | null): string | undefined {
  if (!disposition) return undefined;
  const extended = /filename\*=utf-8''([^;]+)/i.exec(disposition);
  if (extended) {
    const value = extended[1].trim().replace(/^"|"$/g, "");
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain ? plain[1].trim() : undefined;
}

// 文件流类结果：二进制内容以 MCP image 内容块返回，文件名、大小等元信息以 text 内容块返回。
function binaryResult(input: { bytes: Uint8Array; mimeType: string; meta: JsonRecord }) {
  return {
    content: [
      { type: "image" as const, data: Buffer.from(input.bytes).toString("base64"), mimeType: input.mimeType },
      { type: "text" as const, text: JSON.stringify(input.meta, null, 2) },
    ],
  };
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

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: jsonBodyLimit }));
const runningFromDist = process.argv[1]?.replaceAll("\\", "/").endsWith("/dist/index.js");
const publicDirectory = runningFromDist && existsSync(resolve("dist", "public")) ? resolve("dist", "public") : resolve("public");
app.use(express.static(publicDirectory, { index: false }));

// public/index.html 中的 __BANGTU_*__ 占位符在此按当前构建环境的配置注入后再返回，
// 避免 pm2 / 不同运行目录导致直接展示源码占位符或错误环境的地址。
const pageHtmlTokens: ReadonlyArray<readonly [string, string]> = [
  ["__BANGTU_MCP_URL__", mcpPublicUrl],
  ["__BANGTU_DEMO_API_KEY__", demoApiKey],
  ["__BANGTU_APIDOC_URL__", apidocUrl],
];
function serveIndexHtml(_req: ExpressRequest, res: ExpressResponse) {
  const filePath = resolve(publicDirectory, "index.html");
  if (!existsSync(filePath)) {
    res.status(404).type("text").send("Not found");
    return;
  }
  void readFile(filePath, "utf8")
    .then((raw) => {
      let html = raw;
      for (const [token, value] of pageHtmlTokens) html = html.replaceAll(token, value);
      res.type("html").send(html);
    })
    .catch((error: unknown) => {
      res.status(500).type("text").send(`Failed to read index.html: ${String(error)}`);
    });
}
app.get("/", serveIndexHtml);
app.get("/index.html", serveIndexHtml);
app.get("/health", (_req, res) => res.json({ ok: true, service: "bangtu-open-api-mcp", version: "1.0.0" }));

const sseTransports = new Map<string, SSEServerTransport>();
const streamableTransports = new Map<string, StreamableHTTPServerTransport>();

app.get("/sse", async (_req: ExpressRequest, res: ExpressResponse) => {
  const transport = new SSEServerTransport("/messages", res);
  sseTransports.set(transport.sessionId, transport);
  res.on("close", () => sseTransports.delete(transport.sessionId));
  await createServer().connect(transport);
});

app.post("/messages", async (req: ExpressRequest, res: ExpressResponse) => {
  const sessionId = String(req.query.sessionId ?? "");
  const transport = sseTransports.get(sessionId);
  if (!transport) {
    res.status(404).json({ error: "Unknown SSE session" });
    return;
  }
  await transport.handlePostMessage(req, res, req.body);
});

app.post("/mcp", async (req: ExpressRequest, res: ExpressResponse) => {
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

app.get("/mcp", async (req: ExpressRequest, res: ExpressResponse) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? streamableTransports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).json({ error: "Missing or unknown MCP session" });
    return;
  }
  await transport.handleRequest(req, res);
});

app.delete("/mcp", async (req: ExpressRequest, res: ExpressResponse) => {
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
