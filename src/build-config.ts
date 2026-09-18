// 构建环境相关配置，由 scripts/build.mjs 按 npm run build(production)/build:test(test) 临时覆写后编译进 dist。
// 默认（源码状态）为生产环境值：开发模式（npm run dev / tsx）直接读取本文件即为生产配置。
export const defaultApiBaseUrl = "https://openapi.bangtu-ai.com/openApi/";
// 页面「连接帮图 MCP」卡片中展示给客户端填写的 MCP Endpoint。
export const mcpPublicUrl = "https://mcp.bangtu-ai.com/mcp";
// 页面「测试客户端配置」卡片中展示的评估用 apiKey（正式环境研发测试 key）。
export const demoApiKey = "btzlbnfhwr1dkndirgq5h6gy3838b8rh";
// 页面顶栏 / hero / 特性区 / 页脚链接到的 API 文档地址。
export const apidocUrl = "https://apidoc.bangtu-ai.com";
