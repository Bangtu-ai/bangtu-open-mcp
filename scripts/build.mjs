import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

const environment = process.argv[2];
if (environment !== "production" && environment !== "test" && environment !== "inner") {
  throw new Error("Build environment must be production, test or inner");
}

// 环境相关配置统一在此维护（npm run build → production，npm run build:test → test）。
// 编译前按环境覆写 src/build-config.ts，三个常量随之进入 dist/build-config.js：
//   defaultApiBaseUrl   MCP 服务默认上游 OpenAPI 地址
//   mcpPublicUrl        页面「连接帮图 MCP」卡片展示的 MCP Endpoint
//   demoApiKey          页面「测试客户端配置」卡片展示的评估用 apiKey
//   apidocUrl           页面顶栏 / hero / 特性区 / 页脚链接到的 API 文档地址
// public/index.html 源码保留 __BANGTU_*__ 占位符，由服务进程启动后按 dist/build-config.js
// 中的实际值注入，避免因 pm2 / 运行目录差异而展示占位符或错误环境的地址。
const environmentConfig = {
  production: {
    defaultApiBaseUrl: "https://openapi.bangtu-ai.com/openApi/",
    mcpPublicUrl: "https://mcp.bangtu-ai.com/mcp",
    demoApiKey: "btzlbnfhwr1dkndirgq5h6gy3838b8rh",
    apidocUrl: "https://apidoc.bangtu-ai.com",
  },
  test: {
    defaultApiBaseUrl: "http://openapi-test.bangtu-internal.com/openApi/",
    mcpPublicUrl: "http://mcp.bangtu-internal.com/mcp",
    demoApiKey: "btg1eqQmDDmJKi1Q9pcTJjUXr8mArqW7",
    apidocUrl: "http://apidoc.bangtu-internal.com/",
  },
  inner: {
    defaultApiBaseUrl: "http://openapi-demo-inner.bangtu-internal.com/openApi/",
    mcpPublicUrl: "http://mcp-demo-inner.bangtu-internal.com/mcp",
    demoApiKey: "BANGBUDEMOINNERTESt",
    apidocUrl: "http://apidoc-demo-inner.bangtu-internal.com",
  },
};
const config = environmentConfig[environment];

const root = resolve(import.meta.dirname, "..");
const configPath = resolve(root, "src/build-config.ts");
const originalConfigSource = await readFile(configPath, "utf8");
const buildConfigSource = [
  `export const defaultApiBaseUrl = "${config.defaultApiBaseUrl}";`,
  `export const mcpPublicUrl = "${config.mcpPublicUrl}";`,
  `export const demoApiKey = "${config.demoApiKey}";`,
  `export const apidocUrl = "${config.apidocUrl}";`,
].join("\n") + "\n";

try {
  await writeFile(configPath, buildConfigSource, "utf8");

  const tscPath = resolve(root, "node_modules", "typescript", "bin", "tsc");
  const result = spawnSync(process.execPath, [tscPath, "-p", "tsconfig.json"], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`TypeScript build failed with exit code ${result.status ?? 1}`);

  const publicSource = resolve(root, "public");
  const publicTarget = resolve(root, "dist/public");
  await mkdir(dirname(publicTarget), { recursive: true });
  await cp(publicSource, publicTarget, { recursive: true });
} finally {
  await writeFile(configPath, originalConfigSource, "utf8");
}
