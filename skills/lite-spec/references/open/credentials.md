# /lite:open Credentials

## 持久化规则

- 用户首次提供的有效凭证，可持久化到本机 runtime home，供后续自动复用。
- 当用户在当前对话中显式提供有效凭证时，AI 必须立即执行本地保存动作；不能只在当前回复或当前命令中临时使用。
- 凭证默认不写回仓库，也不写回 skill 安装目录。
- 推荐优先级：
  1. 用户本次显式提供的凭证
  2. runtime home 中已保存的凭证
  3. 当前环境变量
- 若已保存凭证失效，应提示用户重新提供，并用新凭证覆盖旧值。

公开版默认 runtime home：

- macOS/Linux: `~/.ai-skills/lite-spec`
- Windows: `%USERPROFILE%\\.ai-skills\\lite-spec`

runtime home 的解析顺序：

1. 若设置 `LITE_SPEC_HOME`，直接使用该目录作为 lite-spec 专用 runtime home
2. 若未设置 `LITE_SPEC_HOME`，但设置了 `AI_SKILLS_HOME`，使用 `<AI_SKILLS_HOME>/lite-spec`
3. 若二者都未设置，使用公开版默认 runtime home

说明：

- 推荐普通用户只设置 `LITE_SPEC_HOME`
- `AI_SKILLS_HOME` 适合多个 AI skill 共用同一个 runtime 根目录时使用
- 如果两个变量同时存在，始终以 `LITE_SPEC_HOME` 为准，忽略 `AI_SKILLS_HOME`

## 需要优先检查的资料来源

- YApi / Swagger / OpenAPI
- Figma
- Axure / 原型系统
- 其他需要登录的在线需求文档

## YApi

若输入包含 YApi URL，则检查：

- `YAPI_UID`
- `YAPI_TOKEN`

若用户本轮直接提供了 `YAPI_UID` / `YAPI_TOKEN`，应立即执行：

- Windows: `scripts/save-credentials.ps1 -YapiUid <uid> -YapiToken <token>`
- macOS/Linux: `scripts/save-credentials.sh --yapi-uid <uid> --yapi-token <token>`

保存后必须立即执行：

- Windows: `scripts/show-credentials.ps1`
- macOS/Linux: `scripts/show-credentials.sh`

检查结果时，只看脚本输出的状态字段，不要手动猜顶层字段名。

## 通用验证规则

对于任何需要登录的外部来源，都按以下顺序验证，不要直接用目标页面的 HTML 响应下结论：

1. 先验证“是否已保存”
   - 运行 `show-credentials`，确认 runtime home、credentialsPath 和对应来源的存在状态
2. 再验证“是否已认证”
   - 优先访问来源自己的鉴权状态接口、用户信息接口或会话检查接口
3. 最后验证“目标资源是否可读”
   - 优先访问目标资源的详情接口、元数据接口或结构化响应
   - 只有没有结构化入口时，才退回页面正文检查

如果第 1 步通过，但第 3 步拿到的是登录页、首页或前端壳页面：

- 不要直接推断“凭证没保存”或“字段读取错误”
- 应先判断这是不是单页应用壳、公共落地页或需要额外资源请求的页面
- 再通过来源内更稳定的机器可判定目标继续验证

## 当前持久化结构示例

YApi 结构：

```json
{
  "yapi": {
    "uid": "<uid>",
    "token": "<token>",
    "updatedAt": "<iso-datetime>"
  }
}
```

Figma 结构：

```json
{
  "figma": {
    "token": "<token>",
    "updatedAt": "<iso-datetime>"
  }
}
```

补充判定：

- 如果直接访问 URL 只能拿到 YApi 登录页、前端壳 HTML 或未登录首页，不能仅凭这一点认定“凭证不存在”；需要先确认 `show-credentials` 输出是否存在已保存凭证，再用来源内的机器可判定目标做二次验证
- 对 YApi，优先使用可机器判定的接口验证登录与权限，例如：
  - 可先检查站点是否提供 `GET /api/user/status` 一类鉴权状态接口
  - 当前实现已接入 `GET /api/interface/get?id=<interfaceId>` 作为资源级验证入口
- 只有在 `show-credentials` 显示无凭证，或上述 API 端点仍返回未登录 / 无权限 / 非预期结果时，才可判定为凭证缺失或失效
- 不要在这种情况下继续生成计划或任务清单
- 应优先提示用户提供一次有效凭证，或说明当前环境中应如何注入 `YAPI_UID` / `YAPI_TOKEN`

## 阻塞回复

当 YApi 凭证缺失或失效时，可直接套用以下回复：

```text
需要访问 YApi，但当前缺少有效的 YAPI_UID / YAPI_TOKEN，所以我先不继续生成 plan / tasks。

优先推荐你直接提供一次有效的 YAPI_UID 和 YAPI_TOKEN。这样我这次可以直接读取 YApi 正文，后续同类链接也能自动复用访问，省去你反复截图或手动摘字段。我会仅保存到本机 runtime home，供后续自动复用，不会写回仓库。

如果你方便自己取值，可以先登录 YApi，然后按 F12：
- 在 Application/Storage -> Cookies 中找到 _yapi_uid 和 _yapi_token
- 或在 Network 面板点击任意请求,在请求头里的 Cookie 中找到 _yapi_uid 和 _yapi_token

如果你暂时不方便提供凭证，也可以改为提供以下任一资料：
1. YApi 接口截图
2. 请求方法、路径、参数、返回说明
3. 可直接访问的 Swagger / OpenAPI / curl 示例

在拿到其中任一项之前，我先保持阻塞，不生成 task。
```
- 注: 必须告知用户获取凭证的详细步骤

## Figma

若输入包含 Figma URL，则检查可用访问方式，例如：

- `FIGMA_TOKEN`

若用户本轮直接提供了 `FIGMA_TOKEN`，应立即执行：

- Windows: `scripts/save-credentials.ps1 -FigmaToken <token>`
- macOS/Linux: `scripts/save-credentials.sh --figma-token <token>`

补充说明：

- `FIGMA_TOKEN` 是当前 Figma 凭证入口
- 即使用户给的是公开 Figma 链接，也必须先取得有效 `FIGMA_TOKEN`，再读取真实设计稿内容并生成 `plan / tasks`
- 对 Figma，同样先跑 `show-credentials` 验证已保存，再用来源内更稳定的机器可判定目标验证 token 是否可用，不要只看分享页 HTML

## Figma 阻塞回复格式

当 Figma 凭证缺失或失效时，可直接套用以下回复：

```text
需要访问 Figma，但当前缺少有效的 FIGMA_TOKEN，所以我先不继续生成 plan / tasks。

优先推荐你直接提供一次具备 file_content:read 权限的 FIGMA_TOKEN。这样我这次可以直接读取真实设计稿内容，后续同类 Figma 链接也能自动复用访问，省去你反复截图或手动描述页面。我会仅保存到本机 runtime home，供后续自动复用，不会写回仓库，也不会写入最终文档。

如果你还没有 token，可以在 Figma 的 Settings -> Security -> Personal access tokens 中生成，至少勾选 file_content:read。

如果你暂时不方便提供 token，也可以改为提供以下任一资料：
1. 设计稿截图
2. 页面结构说明或关键交互说明
3. 已整理的视觉规格、标注或其他可直接参考的设计资料

在拿到其中任一项之前，我先保持阻塞，不生成 task。
```
- 注: 必须告知用户获取凭证的详细步骤

## 原型系统

若原型系统需登录：

- 检查是否已有可用访问方式
- 没有则进入阻塞状态

## 钉钉文档

若钉钉文档需要登录，优先从一个能够成功返回目标文档数据的 Fetch/XHR 请求中提取：

- 完整 `Cookie` 请求头
- `x-xsrf-token`
- `a-token`
- `a-doc-key`
- `a-dentry-key`

Windows 保存入口：

```powershell
scripts/save-credentials.ps1 `
  -DingtalkCookie <cookie> `
  -DingtalkXsrfToken <xsrf-token> `
  -DingtalkAToken <a-token> `
  -DingtalkDocKey <a-doc-key> `
  -DingtalkDentryKey <a-dentry-key>
```

保存后必须运行 `scripts/show-credentials.ps1`，确认 `hasDingtalk` 为 `true`。随后先调用来源接口验证认证状态，再访问目标预览页或正文接口确认文档正文可读。

## 其他需要登录的网站

若资料来源不是 YApi / Figma / 原型系统，而是其他需要登录的网站或平台：

- 先判断该站点需要 token、cookie、uid、header 还是其他会话信息
- 若当前没有可用凭证，明确告诉用户需要补哪些凭证信息
- 若后续接入脚本支持，可按与 YApi 相同的方式保存到 runtime home，供后续自动复用
