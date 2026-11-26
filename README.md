# dsh-tool-groups

> **致敬 AgentScope：本插件的工具组机制来自这个宝藏库。**
>
> 「工具组 + 一个元工具按需切换」的思路，直接借鉴了 [AgentScope](https://github.com/agentscope-ai/agentscope) 的 `ToolGroup` 与 `reset_tools` 设计（[官方文档](https://docs.agentscope.io/zh/versions/2.0.12/building-blocks/tool/manage-tools)）。AgentScope 把「工具装了什么」和「这一轮要什么」干净地拆开：`basic` 组永远常驻，其余组默认不暴露；`reset_tools` 用一次调用整体刷新激活集合，让模型自己管理上下文预算。API 很小，表达力却很强。
>
> 如果你在构建 agent、正在为「工具越装越多、每轮都付固定 token」发愁，强烈建议读一读 AgentScope 的源码与文档——它不是那种只堆功能的框架，而是把 context 当成一等公民来设计的**宝藏库**。本插件只是把同样的思想搬到了 DSH 的插件体系里。

DSH 本地插件（Host + Web Client 两半区），不改 `app.asar`、不改核心包。把**可选的 MCP 工具与技能**编成组，默认不注入系统提示；需要时由 Agent 用元工具按回合加载。所有 DSH 自带工具、以及未分组的 MCP 工具/技能始终加载。

## 简介

dsh-tool-groups 是 DeepSeek Harness 的本地插件。它把可选的 MCP 工具与技能编成用户自定义的工具组，默认只暴露常驻工具与未分组成员；Agent 需要某项能力时先 load_tool_group 打开对应组，用完即收，从而压低每一轮的固定 token 开销。每个组有英文名（AI 侧标识）与中文名（仅人类可见），组描述列出全部成员。机制借鉴 AgentScope 的 ToolGroup / reset_tools 设计。

---

## 它解决什么问题

模型每一轮都要为「已注册的工具 schema + 技能清单」付固定 token，哪怕这一轮根本用不到。工具装得越多，这笔固定开销越大，还容易让模型在几十个相似工具里选错。

工具组把「装了什么」和「这一轮要什么」分开：

- 默认只暴露 **常驻工具**（DSH 自带工具）+ **未分组成员** + **每个组的入口条目**（一条很短的技能目录条目）。
- 需要某组能力时，Agent 先 `load_tool_group` 打开它，组内 MCP 工具与技能才进入本回合的请求；回合结束自动收回。
- 同一时间只保留一个组，切换时自动卸载上一组，避免上下文里堆着多组工具。

### 早期实测（本地 desktop profile，旧分组方案）

| 时刻 | 工具声明 | 字节 |
| --- | --- | --- |
| 分组前 | 141 | 114 KB |
| 三大户编组后 | 67 | 60 KB |
| 再加三组 | 58 | 51 KB |
| 本回合加载「某大组」后 | 64 | 57 KB（只在本回合） |

累计 **141 → 58 条、114 KB → 51 KB（约 −59%）**。当前版本改为「只编 MCP + 技能」，数字会随你装的工具变化，但「默认不付、按需再付」的收益方向不变。

---

## 核心特性

- **只编 MCP 工具与技能**：DSH 自带工具（浏览器、ops、记忆、配置、子智能体等）一律常驻、不可编组——它们是 agent 的基础能力，收起来会直接把 agent 弄瘸。
- **双名制**：每个组有
  - **英文名**（kebab-case，如 `demo-group`、`media-group`）——AI/程序侧唯一标识，用作 skill 目录条目名、`load/unload/list` 的参数与返回值、系统提示里的名字；
  - **中文名**（如「示例组」）——只给人类看，只出现在设置页；目录描述、工具参数、系统提示里都不出现。
- **组描述即成员清单**：每个组的目录条目里列出**全部成员**（技能 + MCP 工具）。用户点名某个工具/技能时，模型能直接看出它属于哪组，不用猜。
- **单组激活**：加载新组自动卸载上一组；加载只在当前回合有效。
- **启用/停用开关**：任一组可一键停用——不注册入口、不可加载、成员保持隐藏；重新启用即恢复。
- **设置页可视化管理**：新建/改名/改描述/删除、给 MCP 与技能编组、开关、成员缺失清理。
- **零核心改动**：全部通过 Cordis 插件 API 与 agent 作用域实现，插件停用即完全回退。

---

## 快速开始

### 1. 安装

把本目录作为**本地 bundle** 装进你的 DSH profile（不同 DSH 版本的入口可能不同；本机用 DSH 的 `plugin_manager` 以本地 bundle 方式 link）。核心是让 profile 的 Loader 里出现一行 `dsh-tool-groups`，并加载 `index.js` 与 `client.js`。

依赖：DSH `>= 0.2.0`（`package.json` 的 `engines.dsh`）。

### 2. 启用

在 **设置 → 插件** 里启用 `dsh-tool-groups`。Host 半边立即生效；Web 半边（设置页）是 client bundle，**刷新一次页面**后才出现。

### 3. 配置

打开 **设置 → 工具组配置**，两个选项卡：

- **管理工具组**：新建组（英文名 + 中文名 + 描述）、改名/改描述、启用开关、删除；卡片上会显示英文名（代码样式）、中文名、成员数与工具成员。
- **对现有工具编组**：给每个 MCP 工具/技能选择所属组；同页顶部可直接改每个组的中英文名。改动先落草稿，点「确认生效」才写入。

### 4. 用起来

假设你有一个叫 `demo-group` 的组，里面放了 `demo-skill`、`example-skill` 两个成员。对 Agent 说「用 demo-skill 处理一下这份数据」即可。Agent 看到的是：

```text
demo-group: Tool group "demo-group" — a loadable entry, not a skill.
Members: demo-skill, example-skill.
Purpose: 演示用的示例组：处理数据并生成报告时加载。
Load with load_tool_group({"name":"demo-group"}) before calling any member.
```

它会先 `load_tool_group({"name":"demo-group"})`，再调用 `demo-skill`；回合结束自动收回。

---

## 概念

| 概念 | 说明 |
| --- | --- |
| 工具组 | 一组 MCP 工具 + 技能的集合，带英文名、中文名、描述、启用状态 |
| 常驻工具 | 所有 DSH 自带工具（非 `mcp__` 前缀）；始终加载，不可编组 |
| 未分组成员 | 没被任何组收录的 MCP 工具/技能；始终加载 |
| 组入口 | 注册在 skill 目录里的运行期条目，名字 = 英文名；**不是技能**，不要用 `skill()` 调用 |
| 影子技能 | 用同名运行期技能（`modelInvocable:false`）顶掉真实技能，从而隐藏未加载的成员 |
| 加载 | 本回合把某组的成员放出来；下一次用户消息前自动卸载 |

**为什么只编 MCP + 技能？** DSH 工具是 agent 的骨架（文件、终端、浏览器、记忆、配置、子智能体……），把它们藏起来会让 agent 连基本操作都做不了；而 MCP 工具和技能是「按任务选用的能力」，天然适合分组。

**为什么技能名必须是英文？** DSH 的技能名有格式约束（kebab-case），所以英文名承担「程序标识」；中文名放配置里给人类读，不进入 AI 可见内容。

---

## 工作机制

### 工具可见性

每个 agent 首次出现时，插件读一次它可见的工具全集（universe），再把自己负责隐藏的工具名交给 `agent.ctx.tools.restrict({ deny })`。restriction 是 agent 作用域的，只影响这个 agent，不改工具注册本身；工具的执行与授权语义不变，被隐藏的工具在加载前调用会得到 unknown tool。

### 技能可见性

未加载组的成员技能用「同名运行期影子技能」隐藏：在 agent 作用域注册一个同名、`modelInvocable:false`、`userInvocable:false` 的运行期技能，最近层优先，真实技能就被顶掉了。加载该组时移除影子，真实技能回到目录。

影子的描述用真实描述（先读一次真实快照缓存），所以设置页不会出现占位文字；发现未完成时先不影子、记 pending，等 `skills/change` 再补。

### 目录映射

每个启用的组注册一条运行期技能：名字 = 英文名，描述 = 用途 + 全部成员 + 加载方式，正文明确「这不是技能、不要 `skill()` 调用」。这样模型在标准 `<available_skills>` 区看到的是「组」，而不是空目录或一堆散装技能。

### 系统提示

插件通过 `ctx.systemPrompt.section()` 注入一段约 5 行的常驻说明（order 9000）：组入口不是技能、按需求+成员名单选组、先 `load_tool_group` 再调用、同一时间只保留一个组。插件停用即随作用域撤销。

### 解析与校验

`load_tool_group` / `unload_tool_group` 的 `name` 依次解析：

1. **英文名**（文档化写法）
2. 旧别名 `tg-<英文名>`
3. 组内成员名（技能或工具，自动定位所属组）
4. 中文名（未文档化的兼容兜底：旧提示词不失效，但 AI 侧文案不宣传）

返回值带 `resolvedFrom` / `resolvedVia`（`english` / `slug` / `member` / `name`），方便排查。

英文名校验：kebab-case、≤64、组间唯一、不得与真实技能或其它组中文名重名、不得与本组成员同名（否则会顶掉真实技能）。`媒体资料` 组的成员里包含真实技能 `media`，所以它的英文名自动落为 **`media-group`**。

### 单组激活与回合边界

- `load_tool_group` 先清空本 agent 的激活集合，再放入目标组；返回 `unloadedGroups` 告知自动卸载了谁。
- `agent/pre-step` 在用户新消息（turn 变化）时清空激活集合，重新装影子/恢复 restriction。
- 会话中途重载插件时，`adoptLiveAgents` 会给已存在的 agent 补一次初始化。

### 持久化

配置在 `<DSH_HOME>/dsh-tool-groups/config.json`（profile 级、重启保留）：

```json
{
  "version": 1,
  "groups": [
    {
      "name": "示例组",
      "englishName": "demo-group",
      "description": "演示用的示例组：处理数据并生成报告时加载。",
      "tools": [],
      "skills": ["demo-skill", "example-skill"],
      "enabled": true
    }
  ]
}
```

旧配置没有 `englishName` 时会自动迁移（按内置 slug 表生成，冲突则加后缀）；`enabled` 缺省为 `true`。

---

## 元工具

| 工具 | 作用 |
| --- | --- |
| `list_tool_groups(verbose?)` | 列出组（英文名、描述、启用、是否激活、成员数）；`verbose` 时带成员与不可用工具 |
| `load_tool_group(name)` | 加载一组（单组激活，自动卸载上一组）；返回可用/不可用工具、技能、`unloadedGroups` |
| `unload_tool_group(name)` | 提前卸载当前组，省上下文 |
| `manage_tool_groups(action, …)` | `create` / `rename` / `describe` / `addMembers` / `removeMembers`；不提供删除（删除在设置页） |

`load_tool_group` 返回里的 `unavailableTools` 是「配置了但此刻调用会得到 unknown tool」的名字，**不要调用**。

---

## 设置页数据面

Web 半边通过同源 JSON 路由访问 Host：

```text
POST /__dsh-tool-groups/api
Content-Type: application/json
```

| action | 关键参数 | 说明 |
| --- | --- | --- |
| `state` | — | 组（含中英文名、成员、开关）、技能/MCP 清单、配置路径 |
| `createGroup` | `name`, `englishName`, `description` | 新建 |
| `updateGroup` | `group`, `englishName?`, `name?`, `description?` | 改名/改描述（改名会重注册目录条目） |
| `deleteGroup` | `group` | 删除 |
| `setGroupEnabled` | `group`, `enabled` | 启用/停用 |
| `setMemberships` | `entries: [{kind,name,groups}]` | 批量改成员的所属组 |
| `pruneGroup` | `group` | 清理「本 profile 从未注册过」的成员 |
| `diagnose` | `name` | 诊断某工具在各 agent 的可见性/放行情况 |

> 表里的 `group` 参数是组的**当前键（中文名）**——内部以它为 `state.active` 的键；设置页用这个键。`load_tool_group` / `unload_tool_group` 则面向 AI，用英文名（或旧别名/成员名）。

路由是 loopback 数据面，做了 method / content-type / Origin 三项检查，挡住跨站页面调用；不经过 Remote 的 Peer 鉴权，**不要把它暴露到公网**。

---

## 文件结构

```text
package.json          # bundle 清单 + dsh.client 声明
cordis.patch.yml      # 插入一行 dsh-tool-groups
index.js              # Host：可见性、元工具、设置页 JSON 路由
client.js             # 浏览器：settings.section 页面（手写 React.createElement）
locale/{zh,en}.json   # 插件管理器元数据
docs/DETAIL.md        # 机制、边界与实测数据
docs/SUMMARY.md       # 当前分组现状
icon.svg
```

---

## 开发与验证

```bash
node --check index.js
node --check client.js
```

- 改 Host：在 设置 → 插件 里停用/启用 `dsh-tool-groups` 即可热重载。
- 改 Web：client bundle 不会 HMR，**刷新页面**才生效。
- 手工验证建议：`state` 看配置 → 停用一组看目录条目消失 → `load_tool_group` 看成员注入 → 重启用看恢复。

---

## 已知边界

- **agent 自身作用域注册的工具不可限制**：`tools.restrict` 只作用于继承来的工具；若某插件把工具注册进 agent 自身作用域，本插件无法隐藏，会在刷新时自动把它从 deny 名单剔除（不报错刷屏）。
- **技能影子在 agent 作用域**，理论上优先于全局层（含项目级 `.dsh/skills`、用户级 `~/.dsh/skills`）；项目级技能场景未做全量实测。
- **加载状态只在当前回合有效**，不跨会话记忆。
- **只隐藏 schema 与技能条目**，不改变工具的执行或授权语义。
- **英文名与真实技能重名会顶掉真实技能**，所以创建/改名时强制拒绝；迁移时对「与本组成员同名」的会自动加后缀（`media` → `media-group`）。
- 与 `dsh-ops` 的 `ops_discover_tools` 并存互不干扰：那是另一套发现池，本插件只管「哪些工具进系统提示」。

---

## 命名 FAQ

**为什么目录条目用英文名，而不是 `tg-` 前缀？**
英文名就是 AI 侧的原名，和真实技能同一命名空间；`tg-<英文名>` 作为旧别名继续可用，避免旧提示词/脚本失效。

**中文名会出现在系统提示里吗？**
不会。中文名只出现在设置页（`state` 数据面）；目录条目、`list_tool_groups`、`load_tool_group` 的 schema/返回、系统提示都只用英文名。

**为什么加载前直接 `skill(成员名)` 会报 `not available`？**
成员技能被影子隐藏了，必须先 `load_tool_group` 打开组。目录描述里已经列出全部成员，先看描述再加载即可。

**停用的组还会出现在 `list_tool_groups` 里吗？**
会，带 `enabled:false`——让模型知道它存在但被关，不会盲试；`load_tool_group` 会明确拒绝。

---

## 致谢

- [AgentScope](https://github.com/agentscope-ai/agentscope)：`ToolGroup` / `reset_tools` 的原始设计，本插件的思想来源。
- DSH 的 Cordis 插件体系与 skill / tool 服务，让「不改核心、按作用域做可见性」成为可能。

## 许可证

[MIT](LICENSE) © 2026 ELMJ
