/**
 * dsh-tool-groups — Host half.
 *
 * 目标：不要让所有工具/技能/MCP 工具一股脑进入系统提示。用户把「可选能力」编进
 * 工具组，未分组、未管理的工具以及白名单里的常用工具（文件读写、bash、网络检索、
 * 元工具）始终加载；已分组的工具默认隐藏，由元工具在运行期按回合加载。
 *
 * 实现要点（都用 DSH 的一等扩展点，不改核心）：
 *  - 工具隐藏：`agent.ctx.tools.restrict({ deny })`（只能是 agent 作用域，见 dsh-tools 源码）。
 *  - 技能隐藏：在 agent 作用域注册同名「运行期影子技能」，invocation 全关；作用域比全局近，
 *    因此同名技能被影子顶掉，技能清单里不再出现（见 dsh-skill 分层与 rank 规则）。
 *  - 回合边界：`session/event` 的 `turn/end` 与 `agent/pre-step` 的 turn 变化作为回落点，
 *    加载状态只在当前回合有效。
 *  - 设置页数据面：`ctx.webServer` 上的一条同源 JSON 路由（POST /__dsh-tool-groups/api）。
 *  - 持久化：`<DSH_HOME>/dsh-tool-groups/config.json`（profile 级、重启保留）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const name = 'dsh-tool-groups'
export const inject = ['tools']

/** 常驻工具（写死）：全部 DSH 原生工具 + 全部 ops_*（dsh-ops 的文件/bash 能力）。
 *  这些工具始终加载，不允许编组；它们不占工具组的便宜，也不受工具组管理。 */
const RESIDENT_TOOLS = new Set([
  // 文件读写
  'read', 'write', 'edit', 'glob', 'grep', 'read_image', 'apply_patch',
  // shell
  'bash', 'pwsh',
  // 网络
  'web_search', 'web_fetch',
  // 技能加载器与元工具（技能被编组后仍需要一个常驻入口把它读出来）
  'skill',
  // 交互与展示
  'ask_user_question', 'present', 'todo_write', 'propose_action',
  // 计划与目标
  'exit_plan_mode', 'create_goal', 'get_goal', 'update_goal',
  // 团队任务（条件注入，实际不占上下文；保留在常驻里只是防止被误编组）
  'team_task_create', 'team_task_get', 'team_task_list', 'team_task_update',
  // 后台任务与定时
  'job_list', 'job_output', 'job_kill', 'schedule_create', 'schedule_edit',
  'schedule_list', 'schedule_view',
  // 会话检索与追踪
  'session_search', 'session_trace', 'session_event_read', 'session_event_search', 'session_event_trace',
  // 终端面板（给用户看的那些）
  'user_terminal_list', 'user_terminal_read',
  // 运行时/工具链
  'cordis_inspect_list', 'cordis_inspect_query', 'plugin_manager', 'workflow',
  'working_directory', 'load_workspace_dependencies', 'process',
])

/** 常驻前缀：终端、ops 文件能力。 */
const RESIDENT_PREFIXES = ['terminal_', 'ops_']

/** 工具组自己的元工具，永远常驻且不可编组。 */
const META_TOOL_NAMES = ['list_tool_groups', 'load_tool_group', 'unload_tool_group', 'manage_tool_groups']

/** PTC 传输保留名，不允许出现在 deny 里。 */
const RESERVED_TOOL_NAMES = new Set(['run_code'])

const API_ROUTE = '/__dsh-tool-groups/api'
const CONFIG_VERSION = 1
const MAX_GROUP_NAME = 60
const MAX_GROUP_DESCRIPTION = 400
/** 运行期影子技能用的占位描述（模型看不到：modelInvocable=false）。 */
const SHADOW_SKILL_DESCRIPTION = 'Hidden by a DSH tool group.'

const GROUP_FIELDS = ['name', 'description', 'tools', 'skills']

/** MCP 工具的命名约定：mcp__<serverName>__<rawName>（见 dsh-mcp-client）。 */
function isMcpTool(toolName) {
  return typeof toolName === 'string' && toolName.startsWith('mcp__')
}

/**
 * 实验模式（skill + MCP only）：只有 MCP 工具与技能可以编组；
 * 其余所有 DSH 工具（原生 + 第三方插件）一律常驻、不可编组。
 * 因此「常驻」= 非 MCP 工具；元工具天然非 MCP，也常驻。
 * 回退：git checkout e6cbef7（baseline）即恢复「DSH 工具也可编组」。
 */
function isResidentTool(toolName) {
  return !isMcpTool(toolName)
}

function configFilePath() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME.trim()
    : path.join(os.homedir(), '.dsh')
  return path.join(home, 'dsh-tool-groups', 'config.json')
}

export function apply(ctx, config) {
  /** @type {{ name: string, description: string, tools: string[], skills: string[] }[]} */
  let groups = []
  /** 「工具组 → skill 目录条目」的注册 disposer。 */
  var groupSkillDisposers = []
  const syntheticSkillNames = new Set()
  /** 组名 → skill 目录里的 kebab slug（技能名不允许中文）。 */
  const GROUP_SLUGS = new Map([
    ['学习与教学', 'learning'], ['技能工程', 'skillcraft'], ['Office 文档', 'office'],
    ['视觉与演示', 'visual'], ['写作与笔记', 'writing'], ['学术与分析', 'research'],
    ['浏览器与媒体', 'browser'], ['开发与代理', 'agentdev'], ['DSH 使用与维护', 'dsh'],
  ])
  /** 每个活着的 agent 一份：加载状态 + 已注册的 restriction/影子技能的 disposer。 */
  const agents = new Map()
  /** 自己改动 restriction 时抑制 tools/change 造成的自激刷新。 */
  let quiet = 0
  let refreshQueued = false
  let skillsChangeQueued = false
  let disposeMetaTools = []

  const store = { path: configFilePath(), error: null }
  load()
  // 实验迁移：工具组只保留 MCP 工具与技能；把 DSH 工具成员移出，清掉因此变空的组。
  {
    let changed = false
    for (const group of groups) {
      const kept = group.tools.filter(isMcpTool)
      if (kept.length !== group.tools.length) {
        group.tools = kept
        changed = true
      }
    }
    const nonEmpty = groups.filter((group) => group.tools.length > 0 || group.skills.length > 0)
    if (nonEmpty.length !== groups.length) {
      groups = nonEmpty
      changed = true
    }
    if (ensureEnglishNames()) changed = true
    if (changed) save()
  }

  // ── 持久化 ────────────────────────────────────────────────────────────────
  function normalizeGroup(raw) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    if (name === '' || name.length > MAX_GROUP_NAME) return null
    const englishName = typeof raw.englishName === 'string' ? raw.englishName.trim().toLowerCase() : ''
    const description = typeof raw.description === 'string' ? raw.description.trim() : ''
    const tools = Array.isArray(raw.tools) ? uniqueStrings(raw.tools) : []
    const skills = Array.isArray(raw.skills) ? uniqueStrings(raw.skills) : []
    return { name, englishName, description: description.slice(0, MAX_GROUP_DESCRIPTION), tools, skills, enabled: raw.enabled !== false }
  }

  // 英文名 = AI 侧唯一标识（skill 目录条目名）。中文名只给人类看。
  function isValidEnglishName(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 64 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)
  }
  function englishNameTaken(candidate, self) {
    return groups.some((group) => group !== self && group.englishName === candidate)
  }
  function derivedEnglishName(group, index) {
    const mapped = GROUP_SLUGS.get(group.name)
    let base = mapped ?? `group-${index + 1}`
    // 与组内成员同名会顶掉真实技能：换一个安全名（如 office 组 → office-group）。
    if (group.skills.includes(base) || group.tools.includes(base)) base = `${base}-group`
    let candidate = base
    let suffix = 2
    while (englishNameTaken(candidate, group) || candidate === group.name) {
      candidate = `${base}-${suffix}`
      suffix += 1
    }
    return candidate
  }
  function ensureEnglishNames() {
    let changed = false
    groups.forEach((group, index) => {
      if (isValidEnglishName(group.englishName) && !englishNameTaken(group.englishName, group)) return
      group.englishName = derivedEnglishName(group, index)
      changed = true
    })
    return changed
  }

  function load() {
    try {
      const text = fs.readFileSync(store.path, 'utf8')
      const parsed = JSON.parse(text)
      const list = Array.isArray(parsed) ? parsed : parsed?.groups
      const seen = new Set()
      groups = []
      for (const raw of Array.isArray(list) ? list : []) {
        const group = normalizeGroup(raw)
        if (group === null || seen.has(group.name)) continue
        seen.add(group.name)
        groups.push(group)
      }
      store.error = null
    } catch (error) {
      groups = []
      store.error = error?.code === 'ENOENT' ? null : String(error?.message ?? error)
    }
  }

  function save() {
    const payload = JSON.stringify({ version: CONFIG_VERSION, groups }, null, 2)
    const file = store.path
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, payload, 'utf8')
    fs.renameSync(tmp, file)
    store.error = null
    syncGroupSkills()
  }

  // ── 工具 / 技能清单 ───────────────────────────────────────────────────────
  /** 见过即记住的工具名：restriction 生效后可见集会收缩，这里保住管理面清单。 */
  const seenToolNames = new Set()
  /** 工具名 → 描述（用于设置页编组时辨认工具）。 */
  const toolDescriptions = new Map()
  /** 记住技能的真实描述：技能被影子顶掉后快照里只剩占位描述。 */
  const realSkillDescriptions = new Map()

  function collectUniverse(agent) {
    try {
      for (const definition of agent.ctx.tools.definitions(agent)) {
        seenToolNames.add(definition.name)
        if (typeof definition.description === 'string') {
          toolDescriptions.set(definition.name, definition.description)
        }
      }
    } catch { /* 取不到就算了，下次再试 */ }
  }

  function knownToolNames() {
    const names = new Set(seenToolNames)
    for (const definition of ctx.tools.definitions()) {
      names.add(definition.name)
      if (typeof definition.description === 'string' && !toolDescriptions.has(definition.name)) {
        toolDescriptions.set(definition.name, definition.description)
      }
    }
    for (const meta of META_TOOL_NAMES) names.add(meta)
    return [...names].sort()
  }

  /** 所有活着的 agent 观测到的「按需注入」工具并集（设置页展示用）。 */
  function injectedUnion() {
    const names = new Set()
    for (const state of agents.values()) {
      for (const name of state.injected ?? []) names.add(name)
    }
    return names
  }

  /** 当前真正注册、可被调用的工具名并集。
   *  注意：不能用 `definitions(agent)` —— 我们自己装的 restriction 已经把组内工具隐藏了，
   *  那样算出来"全部不可用"。必须用 recollect 时（restriction 已撤）读到的 universe。 */
  function availableToolNames() {
    const names = new Set()
    for (const state of agents.values()) {
      for (const name of state.universe ?? []) names.add(name)
    }
    if (names.size === 0) {
      try {
        for (const definition of ctx.tools.definitions()) names.add(definition.name)
      } catch { /* ignore */ }
    }
    for (const meta of META_TOOL_NAMES) names.add(meta)
    return names
  }

  /** 这个名字是否"本 profile 从未有过"（配置脏数据的判据；见过但当前缺的不算）。 */
  function neverSeenTool(toolName) {
    if (META_TOOL_NAMES.includes(toolName)) return false
    if (seenToolNames.has(toolName)) return false
    try {
      for (const definition of ctx.tools.definitions()) {
        if (definition.name === toolName) return false
      }
    } catch { /* ignore */ }
    return true
  }

  function groupedSomewhere(toolName) {
    return groups.some((group) => group.tools.includes(toolName))
  }

  /** 此刻真的能被调用吗（仅诊断用）：
   *  注意 `executable(name, scope)` 缺省 toolSet 时对所有工具都返回 undefined，不能当可用性判据。 */
  function callableNow(agent, toolName) {
    try {
      return agent.ctx.tools.executable(toolName, agent) !== undefined
    } catch {
      return false
    }
  }

  /**
   * 把一个组的成员分成「可调用 / 不可调用」。
   * 判据必须用**该 agent 自己的 universe**（recollect 时 restriction 已撤、读到的是注册真相）：
   *  - union 会把「别的会话/preset 才注册的工具」也算进来（例如 office 只装在别的 preset）；
   *  - `ctx.tools.executable(name, agent)` 缺省 toolSet 时对所有工具都返回 undefined，不能当判据。
   */
  function classifyMembers(agent, toolNames) {
    const state = agent === undefined ? undefined : agents.get(agent.id)
    const registered = state?.universe ?? availableToolNames()
    const injected = state?.injected ?? new Set()
    const usable = []
    const unavailable = []
    for (const toolName of toolNames) {
      if (registered.has(toolName) && !injected.has(toolName)) usable.push(toolName)
      else unavailable.push(toolName)
    }
    return { usable, unavailable }
  }

  async function knownSkills() {
    const service = ctx.get('skills')
    if (!service) return []
    const collected = new Map()
    // 只把「本插件确实注册了影子」的名字当影子；别的插件也用 runtime provider，不能混为一谈。
    const ourShadows = new Set()
    for (const state of agents.values()) {
      for (const name of state.shadows.keys()) ourShadows.add(name)
    }
    const absorb = (snapshot) => {
      for (const skill of snapshot.skills) {
        // 我们自己注入的「组入口」不是可编组技能，别让它出现在设置页。
        if (syntheticSkillNames.has(skill.name)) continue
        const isOurShadow = skill.provider === 'runtime' && ourShadows.has(skill.name)
        if (isOurShadow) {
          if (collected.has(skill.name)) continue
          const cached = realSkillDescriptions.get(skill.name)
          collected.set(skill.name, {
            name: skill.name,
            description: cached
              ?? (skill.description !== SHADOW_SKILL_DESCRIPTION
                ? skill.description
                : '（被工具组隐藏，加载对应组后可见）'),
          })
          continue
        }
        realSkillDescriptions.set(skill.name, skill.description)
        collected.set(skill.name, { name: skill.name, description: skill.description })
      }
    }
    // 技能注册表按作用域分层：打包技能注册在 preset 层，只有带 scope 的读取才看得到；
    // 全局层则保留被影子顶掉之前的真实技能条目。
    try {
      const first = agents.values().next().value
      absorb(await service.snapshot({ cwd: first === undefined ? undefined : await cwdOf(first.agent) }))
    } catch { /* ignore */ }
    for (const state of agents.values()) {
      try {
        absorb(await service.snapshot({ scope: state.agent, cwd: await cwdOf(state.agent) }))
      } catch { /* 某个 agent 读不到就跳过 */ }
    }
    return [...collected.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  }

  // ── 每个 agent 的可见性 ───────────────────────────────────────────────────
  function stateOf(agent) {
    let state = agents.get(agent.id)
    if (state === undefined) {
      state = {
        agent,
        active: new Set(),
        lastTurn: -1,
        restrict: undefined,
        shadows: new Map(),
        signature: undefined,
        universe: undefined,
        injected: new Set(),
        observing: false,
        shadowToken: 0,
        pendingShadows: new Set(),
        shadowInstalling: false,
      }
      agents.set(agent.id, state)
    }
    return state
  }

  function groupedToolNames() {
    const names = new Set()
    for (const group of groups) for (const tool of group.tools) names.add(tool)
    return names
  }

  function groupedSkillNames() {
    const names = new Set()
    for (const group of groups) for (const skill of group.skills) names.add(skill)
    return names
  }

  function visibleFor(state, field) {
    const names = new Set()
    for (const group of groups) {
      if (!state.active.has(group.name)) continue
      for (const entry of group[field]) names.add(entry)
    }
    return names
  }

  /** 该 agent 这一刻应当隐藏的工具名（过滤掉常驻、保留名、按需注入、以及当前作用域里不可限制的名字）。 */
  function hiddenTools(state, universe) {
    const visible = visibleFor(state, 'tools')
    const hidden = []
    for (const tool of groupedToolNames()) {
      if (visible.has(tool)) continue
      if (isResidentTool(tool)) continue
      if (RESERVED_TOOL_NAMES.has(tool)) continue
      if (state.injected?.has(tool)) continue
      if (universe !== undefined && !universe.has(tool)) continue
      hidden.push(tool)
    }
    return hidden.sort()
  }

  /** 注册 agent 作用域的工具隐藏；名字若在 agent 自己的层里（不可限制）就逐个剔除后重试。 */
  function tryRestrict(agent, denyNames) {
    let names = denyNames
    for (let attempt = 0; attempt < 4 && names.length > 0; attempt += 1) {
      try {
        return agent.ctx.tools.restrict({ deny: names })
      } catch (error) {
        const message = String(error?.message ?? '')
        const unknownSegment = message.includes('names unknown global tool')
          ? message.split('; known global tools:')[0]
          : ''
        if (unknownSegment === '') throw error
        const dropped = new Set([...unknownSegment.matchAll(/"([^"]+)"/g)].map((match) => match[1]))
        const next = names.filter((name) => !dropped.has(name))
        if (next.length === names.length) throw error
        names = next
      }
    }
    return undefined
  }

  /** 该 agent 被编组且当前未激活的技能名。 */
  function hiddenSkills(state) {
    const visible = visibleFor(state, 'skills')
    const hidden = []
    for (const skill of groupedSkillNames()) {
      if (visible.has(skill)) continue
      hidden.push(skill)
    }
    return hidden.sort()
  }

  function disposeRestriction(state) {
    if (state.restrict === undefined) return
    const dispose = state.restrict
    state.restrict = undefined
    try {
      dispose()
    } catch { /* 已经是死链接时忽略 */ }
  }

  function disposeShadows(state) {
    // 让仍在 await 中的 installShadows 自行放弃，避免装回已作废的影子。
    state.shadowToken = (state.shadowToken ?? 0) + 1
    for (const dispose of state.shadows.values()) {
      try {
        dispose()
      } catch { /* ignore */ }
    }
    state.shadows.clear()
  }

  /** 取 agent 当前工作目录（技能发现依赖 cwd，缺了会漏掉项目级技能）。 */
  async function cwdOf(agent) {
    try {
      const wd = ctx.get('workingDirectory')
      if (!wd) return undefined
      // 技能发现依赖 cwd（项目级根），必须用 ensure 解析出真实目录，get 可能还没值。
      if (typeof wd.ensure === 'function') return await wd.ensure(agent)
      return wd.get?.(agent.session)
    } catch {
      return undefined
    }
  }

  /**
   * 注册「影子技能」隐藏未加载的真实技能。
   * 关键：先用一次真实快照（此刻 agent 层还没有我们的影子）拿到真实条目；
   * 只有快照里确实存在的技能才影子（并把真描述写进影子）。
   * 发现未完成（例如 Mnemon 类 provider 还没返回）时先不影子，记到 pending，
   * 等 `skills/change` 再重试——否则会留下一个只有占位描述的空影子。
   */
  async function installShadows(agent, state, names) {
    const skills = agent.ctx.get('skills')
    if (!skills || names.length === 0) return
    const token = state.shadowToken
    state.shadowInstalling = true
    try {
      let snapshot
      try {
        snapshot = await skills.snapshot({ scope: agent, cwd: await cwdOf(agent) })
      } catch {
        return
      }
      if (state.shadowToken !== token) return
      const visible = new Map()
      for (const skill of snapshot.skills) {
        if (typeof skill.description === 'string' && skill.description !== '') {
          visible.set(skill.name, skill.description)
          realSkillDescriptions.set(skill.name, skill.description)
        }
      }
      const pending = new Set()
      for (const name of names) {
        if (state.shadowToken !== token) return
        const description = visible.get(name)
        if (description === undefined) {
          // 快照里没有：可能是发现还没完成，也可能是本 agent 根本没有这个技能。
          pending.add(name)
          continue
        }
        if (state.shadows.has(name)) continue
        try {
          state.shadows.set(name, skills.register({
            name,
            description,
            content: '',
            source: 'runtime',
            invocation: { modelInvocable: false, userInvocable: false },
          }))
        } catch (error) {
          ctx.logger?.warn?.(`dsh-tool-groups: cannot shadow skill ${name}: ${error?.message ?? error}`)
        }
      }
      state.pendingShadows = pending
    } finally {
      state.shadowInstalling = false
    }
  }

  function refreshAgent(agent, options = {}) {
    const state = agents.get(agent.id)
    if (state === undefined) return
    // universe 只在工具集变了（tools/change）或首次时需要重读：读它必须先撤掉自己的 restriction。
    if (options.recollect === true || state.universe === undefined) {
      quiet += 1
      try {
        disposeRestriction(state)
        collectUniverse(agent)
        state.universe = universeOf(agent)
        state.signature = undefined
      } catch (error) {
        ctx.logger?.warn?.(`dsh-tool-groups: cannot read tool universe for ${agent.id}: ${error?.message ?? error}`)
      } finally {
        quiet -= 1
      }
    }

    const deny = hiddenTools(state, state.universe)
    const shadows = hiddenSkills(state)
    const signature = JSON.stringify({ deny, shadows })
    if (state.signature === signature && (state.restrict !== undefined) === (deny.length > 0)) return

    quiet += 1
    let installing
    try {
      disposeRestriction(state)
      disposeShadows(state)

      if (deny.length > 0) state.restrict = tryRestrict(agent, deny)

      // 影子注册是异步的（要先读真实快照）；把 promise 返回给调用方，新建 agent 时 await 它，
      // 否则新会话的第一步会在影子装好之前看到全量技能目录。
      installing = installShadows(agent, state, shadows)
      state.signature = signature
    } catch (error) {
      state.signature = undefined
      ctx.logger?.warn?.(`dsh-tool-groups: cannot apply visibility for ${agent.id}: ${error?.message ?? error}`)
    } finally {
      quiet -= 1
    }
    return installing
  }

  /** agent 视图里当前注册的工具名集合（含 preset 层，不含被别的插件限制掉的名字）。 */
  function universeOf(agent) {
    const names = new Set()
    try {
      for (const definition of agent.ctx.tools.definitions(agent)) names.add(definition.name)
    } catch { /* ignore */ }
    return names
  }

  /**
   * 「按需注入」工具：注册方用 `when` 做条件放行，这一步骤没有放行 = 默认不进提示词。
   * 判据必须看**本步的实际放行结果**：`executable(name)` 缺省 toolSet 时会把所有带条件的
   * 注册都当成不可执行，会把 web_search 这类"有条件但通常放行"的工具误判进来。
   * 所以这里按步骤向注册表要一次 admission：definitions 有、admitted 没有的才算按需注入。
   */
  async function observeInjected(payload) {
    const agent = payload?.agent
    const state = agent === undefined ? undefined : agents.get(agent.id)
    if (state === undefined) return
    if (state.observing === true) return
    state.observing = true
    let toolSet
    try {
      toolSet = await ctx.tools.resolve({
        agent,
        modelSelection: payload.modelSelection,
        signal: payload.signal,
      })
      const admitted = toolSet.view(agent)
      const injected = new Set()
      for (const definition of agent.ctx.tools.definitions(agent)) {
        if (!admitted.has(definition.name)) injected.add(definition.name)
      }
      state.injected = injected
    } catch (error) {
      ctx.logger?.warn?.(`dsh-tool-groups: cannot observe step admission: ${error?.message ?? error}`)
    } finally {
      state.observing = false
      try {
        toolSet?.dispose()
      } catch { /* ignore */ }
    }
  }

  function refreshAll(options = {}) {
    for (const state of agents.values()) refreshAgent(state.agent, options)
  }

  function scheduleRefresh() {
    if (refreshQueued) return
    refreshQueued = true
    queueMicrotask(() => {
      refreshQueued = false
      if (quiet > 0) return
      refreshAll({ recollect: true })
    })
  }

  function resetAgent(agent) {
    const state = agents.get(agent.id)
    if (state === undefined) return
    if (state.active.size === 0) return
    state.active.clear()
    refreshAgent(agent)
  }

  // ── 回合边界 ──────────────────────────────────────────────────────────────
  // agent/created 是 serial 且会被 await：这里等影子装好，保证新会话第一步就是隐藏后的目录。
  ctx.on('agent/created', async ({ agent }) => {
    stateOf(agent)
    await refreshAgent(agent)
  })

  ctx.on('agent/disposed', ({ agent }) => {
    const state = agents.get(agent.id)
    if (state === undefined) return
    disposeRestriction(state)
    disposeShadows(state)
    agents.delete(agent.id)
  })

  // 回落后备 1：新回合的第一步之前清空上一回合的加载状态。
  ctx.on('agent/pre-step', async (payload, next) => {
    const state = agents.get(payload?.agent?.id)
    if (state !== undefined && payload.turn !== state.lastTurn) {
      state.lastTurn = payload.turn
      if (state.active.size > 0) {
        state.active.clear()
        refreshAgent(payload.agent)
      }
    }
    // 顺手记下这一步的实际放行集合（按需注入检测）。不阻塞步骤准备。
    void observeInjected(payload)
    const decision = await next()
    // 技能目录里的 name+description 是权威来源（发现完成后的结果），缓存起来供影子/设置页复用。
    if (decision?.kind === 'enter') {
      for (const message of decision.messages) {
        const source = message?.source
        if (source?.kind !== 'skill-catalog' || !Array.isArray(source.entries)) continue
        for (const entry of source.entries) {
          if (entry !== null && typeof entry === 'object'
            && typeof entry.name === 'string' && typeof entry.description === 'string') {
            realSkillDescriptions.set(entry.name, entry.description)
          }
        }
      }
    }
    return decision
  })

  // 回落主路径：turn/end 是持久事件，正常结束/取消都会到。
  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'turn/end') return
    for (const state of agents.values()) {
      if (state.agent.session === session) resetAgent(state.agent)
    }
  })

  // 工具集本身变化（MCP 连接、插件装卸）时重算，避免 deny 名单过期。
  ctx.on('tools/change', () => {
    if (quiet > 0) return
    scheduleRefresh()
  })

  // 技能发现可能晚于插件加载（Mnemon / 远程 provider）：等发现完成后补注册影子。
  ctx.on('skills/change', () => {
    if (skillsChangeQueued) return
    skillsChangeQueued = true
    queueMicrotask(() => {
      skillsChangeQueued = false
      for (const state of agents.values()) {
        if (state.shadowInstalling) continue
        const pending = state.pendingShadows
        if (pending === undefined || pending.size === 0) continue
        void installShadows(state.agent, state, [...pending])
      }
    })
  })

  // ── 元工具 ────────────────────────────────────────────────────────────────
  const textOutput = {
    schema: { type: 'object' },
    render(_args, value) {
      return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
    },
  }

  function describeGroups(state, options = {}) {
    const available = availableToolNames()
    return groups.map((group) => {
      const unavailable = group.tools.filter((tool) => !available.has(tool))
      return {
        englishName: group.englishName,
        ...options.human === true ? { name: group.name } : {},
        description: group.description,
        enabled: group.enabled !== false,
        active: state?.active.has(group.name) ?? false,
        toolCount: group.tools.length,
        skillCount: group.skills.length,
        ...options.members === true ? { tools: group.tools, skills: group.skills } : {},
        ...unavailable.length > 0 ? { unavailableCount: unavailable.length } : {},
      }
    })
  }

  function findGroup(groupName) {
    const target = typeof groupName === 'string' ? groupName.trim() : ''
    return groups.find((group) => group.name === target)
  }

  /**
   * 组名解析：把三种写法统一到一个组，避免模型在「目录别名 tg-xxx」与「中文组名」之间来回试错。
   *  1) 精确组名：技能工程
   *  2) skill 目录别名：tg-skillcraft / skillcraft
   *  3) 成员名：demo-skill → 它所属的组
   */
  function resolveGroup(input) {
    const raw = typeof input === 'string' ? input.trim() : ''
    if (raw === '') return undefined
    // 1) 中文名：未文档化的兼容兜底（旧提示词仍可用，但 AI 侧文案不宣传）。
    const byName = groups.find((group) => group.name === raw)
    if (byName !== undefined) return { group: byName, via: 'name' }
    const lowered = raw.toLowerCase()
    // 2) 英文名（AI 侧唯一标识）。
    const byEnglish = groups.find((group) => group.englishName === lowered)
    if (byEnglish !== undefined) return { group: byEnglish, via: 'english' }
    // 3) 旧 tg-<英文名> 别名。
    const legacy = lowered.startsWith('tg-') ? lowered.slice(3) : lowered
    const byLegacy = groups.find((group) => group.englishName === legacy)
    if (byLegacy !== undefined) return { group: byLegacy, via: 'slug' }
    // 4) 成员名（技能或工具）。
    for (const group of groups) {
      if (group.skills.includes(raw) || group.tools.includes(raw)) return { group, via: 'member' }
    }
    return undefined
  }

  /**
   * 名称校验：中文名只做人类可读的别名，英文名才是 AI 侧标识。
   * 英文名与真实技能重名会顶掉真实技能，必须拒绝。
   */
  async function assertNamesFree(englishName, name, self) {
    if (name === '') throw new Error('中文名不能为空。')
    if (name.length > MAX_GROUP_NAME) throw new Error(`中文名不能超过 ${MAX_GROUP_NAME} 个字符。`)
    if (groups.some((group) => group !== self && group.name === name)) {
      throw new Error(`中文名「${name}」已被另一个工具组使用。`)
    }
    if (!isValidEnglishName(englishName)) {
      throw new Error(`英文名必须是小写 kebab-case（字母/数字/连字符，如 office-docs），收到「${englishName}」。`)
    }
    if (groups.some((group) => group !== self && group.englishName === englishName)) {
      throw new Error(`英文名「${englishName}」已被另一个工具组使用。`)
    }
    if (groups.some((group) => group !== self && group.name === englishName)) {
      throw new Error(`英文名不能与其它组的中文名相同（「${englishName}」）。`)
    }
    const ownMembers = self === undefined ? [] : [...self.skills, ...self.tools]
    if (ownMembers.includes(englishName)) {
      throw new Error(`英文名不能与本组成员相同（「${englishName}」是组成员，会顶掉真实技能）。`)
    }
    let realNames = []
    try {
      realNames = (await knownSkills()).map((skill) => skill.name)
    } catch { /* 读不到技能列表时跳过这项校验 */ }
    if (realNames.includes(englishName)) {
      throw new Error(`英文名「${englishName}」与真实技能重名，会顶掉真实技能；请换一个（如 ${englishName}-group）。`)
    }
  }

  function metaToolDefinitions() {
    const describe = {
      name: 'list_tool_groups',
      description:
        'List the configured tool groups (english name + description + member counts) and the currently loaded group. '
        + 'The group catalog also appears in the skill catalog / system prompt; use this tool to refresh members and availability.',
      parameters: {
        type: 'object',
        properties: {
          verbose: {
            type: 'boolean',
            description: 'When true, also return each group\'s member names (tools and skills).',
          },
        },
        additionalProperties: false,
      },
      output: textOutput,
      async execute(args, exec) {
        const state = exec.agent ? agents.get(exec.agent.id) : undefined
        const verbose = args?.verbose === true
        const agent = exec.agent
        const list = describeGroups(state, { members: verbose })
        if (verbose) {
          for (let index = 0; index < list.length; index += 1) {
            if (groups[index].tools.length === 0) continue
            const { usable, unavailable } = classifyMembers(agent, groups[index].tools)
            list[index].tools = usable
            if (unavailable.length > 0) list[index].unavailableTools = unavailable
          }
        }
        return {
          groups: list,
          total: groups.length,
          activeGroups: state
            ? [...state.active].map((name) => findGroup(name)?.englishName).filter((name) => typeof name === 'string')
            : [],
          hint: 'Group entries also appear in the skill catalog; this tool refreshes members and availability. '
            + 'Loading lasts for the current turn only. Never call unavailableTools — they would return unknown tool.',
        }
      },
    }

    const load = {
      name: 'load_tool_group',
      description:
        'Load one tool group for this turn so its MCP tools and skills become available to the current session. '
        + 'Pass the group\'s English name (the entry name shown in the skill catalog, e.g. office-docs); '
        + 'the legacy alias tg-<english-name> and any member skill/tool name are also accepted. '
        + 'Only one group stays loaded: loading a new one unloads the previous group. '
        + 'Loading lasts for the current turn and is unloaded before the next user message.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'English group name; tg-<english-name> or a member skill/tool name also works.' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      output: textOutput,
      async execute(args, exec) {
        const agent = exec.agent
        if (agent === undefined) throw new Error('工具组只能在一次会话的回合内加载。')
        const resolved = resolveGroup(args?.name)
        if (resolved === undefined) {
          const names = groups
            .filter((item) => item.enabled !== false)
            .map((item) => item.englishName)
            .filter((name) => typeof name === 'string' && name !== '')
            .join(', ') || '(none)'
          throw new Error(`Unknown tool group "${args?.name}". Available: ${names}. `
            + 'Use the English name from the skill catalog; tg-<name> and member names also work.')
        }
        const group = resolved.group
        if (group.enabled === false) {
          throw new Error(`Tool group "${group.englishName}" is disabled. Enable it in Settings first.`)
        }
        const state = stateOf(agent)
        const previouslyActive = [...state.active].filter((name) => name !== group.name)
        if (state.active.has(group.name) && previouslyActive.length === 0) {
          const current = classifyMembers(agent, group.tools)
          return {
            group: group.englishName,
            alreadyActive: true,
            ...(resolved.via !== 'english' ? { resolvedFrom: String(args?.name), resolvedVia: resolved.via } : {}),
            tools: current.usable,
            ...current.unavailable.length > 0 ? { unavailableTools: current.unavailable } : {},
            skills: group.skills,
            note: '该组已加载，可直接调用组内工具。',
          }
        }
        // 单组激活：切换前自动卸载当前组，再加载目标组。
        state.active.clear()
        state.active.add(group.name)
        await refreshAgent(agent)
        const { usable, unavailable } = classifyMembers(agent, group.tools)
        return {
          group: group.englishName,
          description: group.description,
          ...(resolved.via !== 'english' ? { resolvedFrom: String(args?.name), resolvedVia: resolved.via } : {}),
          tools: usable,
          ...unavailable.length > 0 ? { unavailableTools: unavailable } : {},
          skills: group.skills,
          ...previouslyActive.length > 0 ? { unloadedGroups: previouslyActive } : {},
          note: (previouslyActive.length > 0 ? `已自动卸载上一组（${previouslyActive.join('、')}），` : '')
            + (unavailable.length > 0 ? `${unavailable.join('、')} 当前不可调用，不要调用；` : '')
            + '已在本回合加载，回合结束后自动卸载。',
        }
      },
    }

    const unload = {
      name: 'unload_tool_group',
      description: 'Unload the tool group loaded in this turn, withdrawing its tools and skills. '
        + 'Call it when the task no longer needs the group, to free context early.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'English group name (tg-<english-name> or a member name also works).' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      output: textOutput,
      async execute(args, exec) {
        const agent = exec.agent
        if (agent === undefined) throw new Error('工具组只能在一次会话的回合内卸载。')
        const resolved = resolveGroup(args?.name)
        if (resolved === undefined) throw new Error(`Unknown tool group "${args?.name}".`)
        const group = resolved.group
        const state = stateOf(agent)
        if (!state.active.has(group.name)) {
          return { group: group.englishName, active: false, note: 'This group is not loaded.' }
        }
        state.active.delete(group.name)
        await refreshAgent(agent)
        return { group: group.englishName, active: false }
      },
    }

    const manage = {
      name: 'manage_tool_groups',
      description:
        '维护用户配置的工具组：建组、改名、改描述、把 MCP 工具/技能加入或移出工具组（DSH 自带工具一律常驻，不可编组）。'
        + '用于用户用自然语言要求「把 X 归到某个组」时。删除工具组只能在设置页操作，本工具不提供删除。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'rename', 'describe', 'addMembers', 'removeMembers'],
            description: 'create 建组；rename 改名；describe 改描述；addMembers 加入成员；removeMembers 移出成员。',
          },
          group: { type: 'string', description: '目标工具组：英文名（tg-<英文名>/成员名也可）。' },
          englishName: { type: 'string', description: '英文名（kebab-case，AI 侧标识）；create/rename 用。' },
          name: { type: 'string', description: 'rename 的新名称；create/describe 时也可作为别名参数。' },
          description: { type: 'string', description: '工具组描述（告诉模型这个组大概放什么）。' },
          tools: {
            type: 'array',
            items: { type: 'string' },
            description: '要加入或移出的工具名（须是当前存在的工具）。',
          },
          skills: {
            type: 'array',
            items: { type: 'string' },
            description: '要加入或移出的技能名。',
          },
        },
        required: ['action', 'group'],
        additionalProperties: false,
      },
      output: textOutput,
      async execute(args) {
        const action = String(args?.action ?? '')
        const requested = String(args?.group ?? '').trim()
        if (requested === '') throw new Error('缺少工具组名称。')

        if (action === 'create') {
          const englishName = String(args?.englishName ?? '').trim().toLowerCase()
          const group = normalizeGroup({ name: requested, englishName, description: args?.description ?? '' })
          if (group === null) throw new Error(`中文名不合法（1-${MAX_GROUP_NAME} 个字符）。`)
          await assertNamesFree(group.englishName, group.name, undefined)
          groups.push(group)
          save()
          refreshAll()
          return { created: group.englishName, description: group.description, total: groups.length }
        }

        const resolved = resolveGroup(requested)
        const group = resolved?.group
        if (group === undefined) throw new Error(`Unknown tool group "${requested}".`)

        if (action === 'rename') {
          const nextEnglish = String(args?.englishName ?? '').trim().toLowerCase() || group.englishName
          const nextName = String(args?.name ?? '').trim() || group.name
          await assertNamesFree(nextEnglish, nextName, group)
          const previous = group.englishName
          if (nextName !== group.name) {
            for (const agentState of agents.values()) {
              if (agentState.active.delete(group.name)) agentState.active.add(nextName)
            }
            group.name = nextName
          }
          group.englishName = nextEnglish
          save()
          refreshAll()
          return { renamed: { from: previous, to: group.englishName } }
        }

        if (action === 'describe') {
          group.description = String(args?.description ?? '').trim().slice(0, MAX_GROUP_DESCRIPTION)
          save()
          return { group: group.englishName, description: group.description }
        }

        if (action === 'addMembers' || action === 'removeMembers') {
          const toolNames = Array.isArray(args?.tools) ? uniqueStrings(args.tools) : []
          const skillNames = Array.isArray(args?.skills) ? uniqueStrings(args.skills) : []
          if (toolNames.length === 0 && skillNames.length === 0) throw new Error('需要至少一个 tools 或 skills。')
          const knownTools = new Set(knownToolNames())
          const injected = toolNames.filter((tool) => injectedUnion().has(tool))
          if (injected.length > 0) {
            throw new Error(`${injected.join('、')} 是按需注入工具（默认不进提示词），不参与编组。`)
          }
          const resident = toolNames.filter((tool) => isResidentTool(tool))
          if (resident.length > 0) {
            throw new Error(`常驻工具不可编组：${resident.join('、')}。` + '常驻工具始终加载，编组对它不起作用。')
          }
          const unknown = toolNames.filter((tool) => !knownTools.has(tool))
          if (unknown.length > 0) throw new Error(`未知工具：${unknown.join('、')}。`)
          if (action === 'addMembers') {
            group.tools = uniqueStrings([...group.tools, ...toolNames])
            group.skills = uniqueStrings([...group.skills, ...skillNames])
          } else {
            const dropTools = new Set(toolNames)
            const dropSkills = new Set(skillNames)
            group.tools = group.tools.filter((tool) => !dropTools.has(tool))
            group.skills = group.skills.filter((skill) => !dropSkills.has(skill))
          }
          save()
          refreshAll()
          return { group: group.englishName, tools: group.tools, skills: group.skills }
        }

        throw new Error(`不支持的 action「${action}」。删除工具组请在设置 → 工具组配置中操作。`)
      },
    }

    return [describe, load, unload, manage]
  }

  // 插件在会话中途被加载时，已经存在的 agent 不会再有 agent/created，这里补一次初始化。
  function adoptLiveAgents() {
    const registry = ctx.get('agents')
    if (!registry || typeof registry.list !== 'function') return
    try {
      for (const agent of registry.list()) {
        stateOf(agent)
        refreshAgent(agent)
      }
    } catch (error) {
      ctx.logger?.warn?.(`dsh-tool-groups: cannot adopt live agents: ${error?.message ?? error}`)
    }
  }

  disposeMetaTools = metaToolDefinitions().map((definition) => ctx.tools.register(definition))
  adoptLiveAgents()

  // ── 把工具组映射进 skill 目录（标准 <available_skills> 区） ──────────────
  // 工具组入口 = 英文名（合法 skill 名）。描述只用英文名 + 成员名，不暴露中文名（中文名只给设置页）。
  function syncGroupSkills() {
    const skills = ctx.get('skills')
    if (!skills) return
    for (const dispose of groupSkillDisposers) {
      try { dispose() } catch { /* ignore */ }
    }
    groupSkillDisposers = []
    syntheticSkillNames.clear()
    groups.forEach((group) => {
      // 关掉的组不注册入口：skill 目录里不出现，也就不会注入系统提示。
      if (group.enabled === false) return
      const name = group.englishName
      if (!isValidEnglishName(name)) {
        ctx.logger?.warn?.(`dsh-tool-groups: group "${group.name}" has no valid englishName, skipped`)
        return
      }
      const members = [...group.skills, ...group.tools]
      const description = `Tool group "${name}" — a loadable entry, not a skill. `
        + `Members: ${members.join(', ') || '(none)'}. `
        + (group.description ? `Purpose: ${group.description.slice(0, 140)}. ` : '')
        + `Load with load_tool_group({"name":"${name}"}) before calling any member.`
      try {
        const dispose = skills.register({
          name,
          description: description.slice(0, 480),
          content: [
            `This is the tool-group entry "${name}". It is NOT a skill — do not call skill() on it.`,
            '',
            group.description || '',
            '',
            `Members: ${members.join(', ') || '(none)'}.`,
            `To use a member: call load_tool_group({"name":"${name}"}) first, then call the real skill/tool by its own name.`,
            `Before loading, skill(<member>) returns not available.`,
            `Unload with unload_tool_group({"name":"${name}"}) when done; only one group stays loaded.`,
          ].join('\n'),
          source: 'runtime',
          invocation: { modelInvocable: true, userInvocable: false },
        })
        groupSkillDisposers.push(dispose)
        syntheticSkillNames.add(name)
      } catch (error) {
        ctx.logger?.warn?.(`dsh-tool-groups: cannot register group skill ${name}: ${error?.message ?? error}`)
      }
    })
  }

  syncGroupSkills()
  ctx.inject(['skills'], () => { syncGroupSkills() })

  // 常驻的简短说明：让只会传统 skill 机制的模型知道「组入口不是技能、先 load 再调用」。
  ctx.inject(['systemPrompt'], () => {
    try {
      ctx.systemPrompt.section({
        name: 'dsh-tool-groups',
        order: 9000,
        text: [
          'Tool groups: optional skills and MCP tools are bundled into tool groups.',
          'Each group is one entry in the skill catalog, named by its English name. That entry is NOT a skill — never call skill() on it.',
          'Its description lists every member skill and tool, so pick the group whose members match the request instead of guessing.',
          'To use a member: call load_tool_group({"name":"<english group name>"}) first, then call the real skill/tool by its own name. Before loading, skill(<member>) returns not available.',
          'Only one group stays loaded; load another or unload_tool_group to switch. Loading lasts for the current turn.',
        ].join('\n'),
      })
    } catch (error) {
      ctx.logger?.warn?.(`dsh-tool-groups: cannot add system prompt section: ${error?.message ?? error}`)
    }
  })

  ctx.effect(() => () => {
    for (const dispose of disposeMetaTools) dispose()
    disposeMetaTools = []
    for (const state of agents.values()) {
      disposeRestriction(state)
      disposeShadows(state)
    }
    agents.clear()
  }, 'dsh-tool-groups: teardown')

  // ── 设置页数据面（同源 JSON 路由） ────────────────────────────────────────
  ctx.inject(['webServer'], (scope) => {
    scope.effect(
      () => scope.webServer.register({ kind: 'exact', path: API_ROUTE, handler: createApiHandler(scope) }),
      'dsh-tool-groups: settings api',
    )
  })

  function createApiHandler(scope) {
    return async function handle(req, res) {
      const send = (status, value) => {
        const text = JSON.stringify(value)
        res.statusCode = status
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.setHeader('content-length', String(Buffer.byteLength(text)))
        res.end(text)
      }
      try {
        // 同源校验：挡住别的网页对本机路由的跨站调用（本机进程属同一信任域）。
        const origin = req.headers?.origin
        if (typeof origin === 'string' && origin !== '') {
          let expected = ''
          try {
            expected = scope.webServer.getOrigin()
          } catch { /* ignore */ }
          if (expected !== '' && !origin.startsWith(expected)) {
            send(403, { error: '跨源请求被拒绝' })
            return
          }
        }
        if (req.method !== 'POST') {
          send(405, { error: '仅支持 POST' })
          return
        }
        const contentType = String(req.headers?.['content-type'] ?? '')
        if (!/^application\/json\b/i.test(contentType)) {
          send(415, { error: '请求体必须是 application/json' })
          return
        }
        const body = await readJsonBody(req)
        const action = typeof body?.action === 'string' ? body.action : ''

        if (action === 'state') {
          const toolNames = knownToolNames()
          const injected = injectedUnion()
          const available = availableToolNames()
          // 设置页的「存在性」按所有会话的并集算：只装在别的 preset 里的工具也算存在。
          const callable = new Set()
          for (const state of agents.values()) {
            for (const toolName of state.universe ?? []) callable.add(toolName)
          }
          if (callable.size === 0) {
            for (const toolName of available) callable.add(toolName)
          }
          const skillList = await knownSkills()
          send(200, {
            configPath: store.path,
            configError: store.error,
            groups: groups.map((group) => {
              const unavailableTools = group.tools.filter((tool) => !callable.has(tool))
              const missingTools = unavailableTools.filter((tool) => neverSeenTool(tool))
              return {
                name: group.name,
                englishName: group.englishName,
                description: group.description,
                enabled: group.enabled !== false,
                tools: group.tools,
                skills: group.skills,
                ...unavailableTools.length > 0 ? { unavailableTools } : {},
                ...missingTools.length > 0 ? { missingTools } : {},
              }
            }),
            tools: toolNames.map((toolName) => ({
              name: toolName,
              description: truncate(toolDescriptions.get(toolName) ?? '', 320),
              resident: isResidentTool(toolName),
              meta: META_TOOL_NAMES.includes(toolName),
              injected: injected.has(toolName),
              groups: groups.filter((group) => group.tools.includes(toolName)).map((group) => group.name),
            })),
            injectedTools: [...injected].sort().map((toolName) => ({
              name: toolName,
              description: truncate(toolDescriptions.get(toolName) ?? '', 320),
            })),
            skills: skillList.map((skill) => ({
              name: skill.name,
              description: skill.description,
              groups: groups.filter((group) => group.skills.includes(skill.name)).map((group) => group.name),
            })),
            metaTools: META_TOOL_NAMES,
          })
          return
        }

        if (action === 'createGroup') {
          const englishName = typeof body?.englishName === 'string' ? body.englishName.trim().toLowerCase() : ''
          const group = normalizeGroup({ name: body?.name, englishName, description: body?.description })
          if (group === null) throw new Error(`中文名不合法（1-${MAX_GROUP_NAME} 个字符）。`)
          await assertNamesFree(group.englishName, group.name, undefined)
          groups.push(group)
          save()
          refreshAll()
          send(200, { ok: true, group: { englishName: group.englishName, name: group.name } })
          return
        }

        if (action === 'updateGroup') {
          const group = findGroup(body?.group)
          if (group === undefined) throw new Error(`没有名为「${body?.group}」的工具组。`)
          const nextEnglish = typeof body?.englishName === 'string' ? body.englishName.trim().toLowerCase() : group.englishName
          const nextName = typeof body?.name === 'string' ? body.name.trim() : group.name
          if (nextEnglish !== group.englishName || nextName !== group.name) {
            await assertNamesFree(nextEnglish, nextName, group)
            if (nextName !== group.name) {
              for (const agentState of agents.values()) {
                if (agentState.active.delete(group.name)) agentState.active.add(nextName)
              }
              group.name = nextName
            }
            group.englishName = nextEnglish
          }
          if (typeof body?.description === 'string') {
            group.description = body.description.trim().slice(0, MAX_GROUP_DESCRIPTION)
          }
          save()
          refreshAll()
          send(200, { ok: true, group: { englishName: group.englishName, name: group.name } })
          return
        }

        if (action === 'deleteGroup') {
          const group = findGroup(body?.group)
          if (group === undefined) throw new Error(`没有名为「${body?.group}」的工具组。`)
          groups = groups.filter((item) => item !== group)
          save()
          refreshAll()
          send(200, { ok: true, deleted: group.name })
          return
        }

        // 清理「本 profile 从未注册过」的工具名（历史脏数据）；暂时缺货但见过的（例如 office）不清理。
        if (action === 'pruneGroup') {
          const group = findGroup(body?.group)
          if (group === undefined) throw new Error(`没有名为「${body?.group}」的工具组。`)
          const available = availableToolNames()
          const removed = group.tools.filter((tool) => !available.has(tool) && neverSeenTool(tool))
          if (removed.length === 0) {
            send(200, { ok: true, removed: [], note: '没有需要清理的成员。' })
            return
          }
          const drop = new Set(removed)
          group.tools = group.tools.filter((tool) => !drop.has(tool))
          save()
          refreshAll()
          send(200, { ok: true, removed })
          return
        }

        // 启用/停用：停用后不注册 tg-* 入口（skill 目录里消失）、不可加载、成员保持隐藏。
        if (action === 'setGroupEnabled') {
          const group = findGroup(body?.group)
          if (group === undefined) throw new Error(`没有名为「${body?.group}」的工具组。`)
          const enabled = body?.enabled !== false
          group.enabled = enabled
          if (!enabled) {
            for (const state of agents.values()) state.active.delete(group.name)
          }
          save()
          refreshAll()
          send(200, { ok: true, group: group.name, enabled })
          return
        }

        if (action === 'setMembership') {
          const kind = body?.kind === 'skill' ? 'skills' : 'tools'
          const entryName = String(body?.name ?? '')
          const targetGroups = Array.isArray(body?.groups) ? uniqueStrings(body.groups) : []
          for (const groupName of targetGroups) {
            if (findGroup(groupName) === undefined) throw new Error(`没有名为「${groupName}」的工具组。`)
          }
          if (kind === 'tools' && injectedUnion().has(entryName)) {
            throw new Error(`「${entryName}」是按需注入工具（默认不进提示词），不参与编组。`)
          }
          if (kind === 'tools' && isResidentTool(entryName)) {
            throw new Error(`常驻工具不可编组：${entryName}`)
          }
          if (kind === 'tools' && targetGroups.length > 0 && !knownToolNames().includes(entryName) && !groupedSomewhere(entryName)) {
            throw new Error(`未知工具「${entryName}」：当前 profile 从未注册过这个名字，不能写进工具组。`)
          }
          for (const group of groups) {
            group[kind] = group[kind].filter((entry) => entry !== entryName)
          }
          for (const groupName of targetGroups) {
            const group = findGroup(groupName)
            if (group !== undefined) group[kind] = uniqueStrings([...group[kind], entryName])
          }
          save()
          refreshAll()
          send(200, { ok: true, kind, name: entryName, groups: targetGroups })
          return
        }

        // 下拉菜单的「确认生效」一次提交多条改动：先整体校验，再落盘 + 刷新一次。
        if (action === 'setMemberships') {
          const entries = Array.isArray(body?.entries) ? body.entries : []
          if (entries.length === 0) throw new Error('没有需要保存的改动。')
          const planned = []
          for (const entry of entries) {
            const kind = entry?.kind === 'skill' ? 'skills' : 'tools'
            const entryName = String(entry?.name ?? '').trim()
            if (entryName === '') throw new Error('改动里缺少条目标识。')
            const targetGroups = Array.isArray(entry?.groups) ? uniqueStrings(entry.groups) : []
            for (const groupName of targetGroups) {
              if (findGroup(groupName) === undefined) throw new Error(`没有名为「${groupName}」的工具组。`)
            }
            if (kind === 'tools' && injectedUnion().has(entryName)) {
              throw new Error(`「${entryName}」是按需注入工具（默认不进提示词），不参与编组。`)
            }
            if (kind === 'tools' && isResidentTool(entryName)) {
              throw new Error(`常驻工具不可编组：${entryName}`)
            }
            if (kind === 'tools' && targetGroups.length > 0 && !knownToolNames().includes(entryName) && !groupedSomewhere(entryName)) {
              throw new Error(`未知工具「${entryName}」：当前 profile 从未注册过这个名字，不能写进工具组。`)
            }
            planned.push({ kind, name: entryName, groups: targetGroups })
          }
          for (const item of planned) {
            for (const group of groups) {
              group[item.kind] = group[item.kind].filter((entry) => entry !== item.name)
            }
          }
          for (const item of planned) {
            for (const groupName of item.groups) {
              const group = findGroup(groupName)
              if (group !== undefined) group[item.kind] = uniqueStrings([...group[item.kind], item.name])
            }
          }
          save()
          refreshAll()
          send(200, { ok: true, applied: planned.length })
          return
        }

        // 诊断：为什么某个工具当前不可调用（排查配置/条件注册用）。
        if (action === 'diagnose') {
          const target = String(body?.name ?? '').trim()
          if (target === '') throw new Error('需要 name。')
          const registered = availableToolNames().has(target)
          const report = { name: target, registered, resident: isResidentTool(target), grouped: groupedSomewhere(target) }
          for (const state of agents.values()) {
            report[`agent:${state.agent.id}`] = {
              inUniverse: (state.universe ?? new Set()).has(target),
              injected: (state.injected ?? new Set()).has(target),
              universeSize: (state.universe ?? new Set()).size,
            }
          }
          send(200, report)
          return
        }

        send(400, { error: `未知操作「${action}」` })
      } catch (error) {
        send(400, { error: String(error?.message ?? error) })
      }
    }
  }

  function readJsonBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > 1024 * 1024) {
          reject(new Error('请求体过大'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8')
          resolve(text === '' ? {} : JSON.parse(text))
        } catch {
          reject(new Error('请求体不是合法 JSON'))
        }
      })
      req.on('error', reject)
    })
  }

  ctx.logger?.info?.(`dsh-tool-groups: ${groups.length} group(s) loaded from ${store.path}`)
}

/** 截断长描述，避免设置页一次传输过多文本。 */
function truncate(text, limit) {
  if (typeof text !== 'string') return ''
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized
}

function uniqueStrings(values) {
  const seen = new Set()
  const result = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed === '' || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}

export const GROUP_FIELD_NAMES = GROUP_FIELDS
