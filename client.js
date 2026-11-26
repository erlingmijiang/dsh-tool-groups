/**
 * dsh-tool-groups — 浏览器半区。
 *
 * 在「设置」里注册一个「工具组配置」页，两个选项卡：
 *   1. 管理工具组：新建、改名、改描述、删除（行内二次确认）
 *   2. 编组：给现有工具与技能点选所属工具组
 *
 * 数据面走 Host 半区的同源 JSON 路由：POST /__dsh-tool-groups/api。
 * 本文件是 __ModuleLoader__ 的懒加载 factory（纯 CJS 风格，不经过打包）：
 * factory 内无副作用，样式、字典与 slot 注册全部放在 apply 里并用 ctx.effect 回收。
 */
(function (root) {
  if (!root || !root.__ModuleLoader__ || typeof root.__ModuleLoader__.load !== 'function') return;
  root.__ModuleLoader__.load({
    id: 'dsh-tool-groups',
    factory: function (require) {
      var React = require('react');
      var h = React.createElement;
      var useState = React.useState;
      var useEffect = React.useEffect;
      var useCallback = React.useCallback;
      var useRef = React.useRef;
      var useId = React.useId;

      var API = '/__dsh-tool-groups/api';
      var SECTION_ID = 'dsh-tool-groups';
      var NS = 'settings.toolGroups';
      var PLUGIN_ID = 'dsh-tool-groups';

      // ── 文案（ctx.locale 字典：zh/en 为基线） ─────────────────────────────
      var DICT = {
        zh: {
          nav: '工具组配置',
          title: '工具组配置',
          subtitle: '把 MCP 和技能编成工具组，让它们按需加载（每个回合结束时自动卸载）。常驻工具与未分组工具始终加载。',
          tabGroups: '管理工具组',
          tabAssign: '对现有工具编组',
          createTitle: '新建工具组',
          nameLabel: '中文名（仅人类可见）',
          namePlaceholder: '中文名，例如：Office 文档',
          englishNameLabel: '英文名（AI 侧标识）',
          englishNamePlaceholder: 'kebab-case，例如 office-docs',
          saveNames: '保存名称',
          groupNamesTitle: '组名',
          namesHint: '英文名用于 skill 目录与 load_tool_group；中文名只在本页显示。',
          memberToolsLine: '工具：{names}',
          descriptionLabel: '描述',
          descriptionPlaceholder: '工具组描述，例如：画图表、生成交互式页面时使用',
          create: '新建',
          empty: '还没有工具组。先在上方新建一个，再到「对现有工具编组」里把工具加进去。',
          memberCount: '{tools} 个工具 · {skills} 个技能',
          enableGroup: '开启工具组',
          disableGroup: '关闭工具组',
          groupOff: '已关闭',
          missingTools: '组里有本 profile 不存在的工具：{names} —— 加载时不会出现，调用会得到 unknown tool。',
          prune: '清理不存在的成员',
          unavailableTools: '成员里 {names} 当前未注册（等相应能力或插件加载后自动可用）。',
          save: '保存',
          cancel: '取消',
          rename: '改名',
          delete: '删除',
          deleteConfirm: '确认删除？组内成员会回到「未分组」并重新常驻。',
          resident: '常驻',
          meta: '元工具',
          searchPlaceholder: '筛选工具或技能…',
          mcpHeading: 'MCP 工具',
          skillsHeading: '技能',
          noMcp: '当前没有连接 MCP 服务器，或 MCP 没暴露工具。',
          noSkills: '这个环境里没有可编组的技能。',
          residentNote: '只有 MCP 工具与技能可以编组；所有 DSH 工具一律常驻，不可编组。',
          applyHint: '每个 MCP 工具/技能只能归入一个工具组；改完下拉菜单后点「确认生效」才会写入配置并生效。选「常驻」即不编组。',
          residentOption: '常驻',
          selectLabel: '所属工具组',
          multiGroup: '在 {count} 个组',
          noDescription: '（该工具没有描述）',
          unsaved: '{count} 项改动待生效',
          noPending: '没有未生效的改动',
          saved: '已生效',
          discard: '放弃改动',
          apply: '确认生效',
          injectedHeading: '按需注入（不参与编组）',
          injectedHint: '这些工具由注册方按步骤条件放行（例如计划模式、团队启用、或由 discoverable 提升为可调用），默认根本不进提示词、不占上下文，因此不需要也无法用工具组管理。',
          injectedBadge: '按需注入',
          hiddenHintNone: '当前没有被工具组接管的工具，模型看到的仍是全量工具。',
          hiddenHint: '当前有 {count} 个工具被工具组接管：默认不进系统提示，需要时由 Agent 用 load_tool_group 加载。',
          skillsHint: '技能被编组且未加载时，不会出现在会话的技能清单里。',
          loadFailed: '读取配置失败：',
          saving: '保存中…',
          configPath: '配置文件：',
          genericError: '出错了：',
          loading: '加载中…',
          unnamed: '（未命名）',
        },
        en: {
          nav: 'Tool groups',
          title: 'Tool groups',
          subtitle: 'Group MCP tools and skills so they load on demand (unloaded at the end of every turn). Resident and ungrouped tools always stay loaded.',
          tabGroups: 'Manage groups',
          tabAssign: 'Assign tools',
          createTitle: 'New tool group',
          nameLabel: 'Chinese name (people only)',
          namePlaceholder: 'Chinese name, e.g. Office docs',
          englishNameLabel: 'English name (AI-facing)',
          englishNamePlaceholder: 'kebab-case, e.g. office-docs',
          saveNames: 'Save names',
          groupNamesTitle: 'Group names',
          namesHint: 'The English name is used in the skill catalog and load_tool_group; the Chinese name stays in this page.',
          memberToolsLine: 'Tools: {names}',
          descriptionLabel: 'Description',
          descriptionPlaceholder: 'Group description, e.g. used when drawing charts or building interactive pages',
          create: 'Create',
          empty: 'No tool groups yet. Create one above, then add tools in "Assign tools".',
          memberCount: '{tools} tools · {skills} skills',
          enableGroup: 'Enable group',
          disableGroup: 'Disable group',
          groupOff: 'Off',
          missingTools: 'This group lists tools that do not exist in this profile: {names} — they never appear when loaded, and calling them yields "unknown tool".',
          prune: 'Remove missing members',
          unavailableTools: 'Members {names} are currently unregistered (they become available once the owning capability or plugin loads).',
          save: 'Save',
          cancel: 'Cancel',
          rename: 'Rename',
          delete: 'Delete',
          deleteConfirm: 'Delete this group? Its members become ungrouped and always loaded again.',
          resident: 'resident',
          meta: 'meta',
          searchPlaceholder: 'Filter tools or skills…',
          mcpHeading: 'MCP tools',
          skillsHeading: 'Skills',
          noMcp: 'No MCP server connected, or MCP exposed no tools.',
          noSkills: 'No assignable skills in this environment.',
          residentNote: 'Only MCP tools and skills are groupable; every DSH tool is always resident and cannot be grouped.',
          applyHint: 'Each MCP tool or skill belongs to at most one group. Pick a group in the dropdown, then click Apply to save and take effect. Choose 常驻/resident to leave it ungrouped.',
          residentOption: 'Resident',
          selectLabel: 'Group',
          multiGroup: 'in {count} groups',
          noDescription: '(no description)',
          unsaved: '{count} pending change(s)',
          noPending: 'No pending changes',
          saved: 'Applied',
          discard: 'Discard',
          apply: 'Apply',
          injectedHeading: 'Conditionally injected (not groupable)',
          injectedHint: 'These tools are admitted by their registrant only under a step condition (plan mode, team enabled, or promoted from discoverable). They never enter the prompt by default and cost no context, so a tool group neither needs nor can manage them.',
          injectedBadge: 'on demand',
          hiddenHintNone: 'No tool is currently managed by a group; the model still sees the full tool set.',
          hiddenHint: '{count} tool(s) are managed by groups: hidden from the prompt by default and loaded with load_tool_group when needed.',
          skillsHint: 'A grouped skill that is not loaded is omitted from the session skill catalog.',
          loadFailed: 'Failed to read configuration: ',
          saving: 'Saving…',
          configPath: 'Config file: ',
          genericError: 'Error: ',
          loading: 'Loading…',
          unnamed: '(unnamed)',
        },
      };

      var CSS = [
        '.dtg-root{display:flex;flex-direction:column;gap:14px;max-width:760px;color:var(--dsw-alias-label-primary);}',
        '.dtg-title{margin:0;font-size:18px;line-height:26px;font-weight:600;}',
        '.dtg-sub{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);}',
        '.dtg-tabs{display:flex;gap:4px;border-bottom:1px solid var(--dsw-alias-border-l2);}',
        '.dtg-tab{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;padding:8px 12px;border-bottom:2px solid transparent;border-radius:8px 8px 0 0;cursor:pointer;}',
        '.dtg-tab:hover{background:var(--dsw-alias-interactive-bg-hover-solid);}',
        '.dtg-tab.is-active{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-state-business-primary);font-weight:600;}',
        '.dtg-tab:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));}',
        '.dtg-card{display:flex;flex-direction:column;gap:10px;padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-1));}',
        '.dtg-row{display:flex;align-items:center;gap:8px;}',
        '.dtg-row-wrap{flex-wrap:wrap;}',
        '.dtg-grow{flex:1;min-width:0;}',
        '.dtg-label{display:block;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);margin-bottom:4px;}',
        '.dtg-input,.dtg-textarea{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;padding:6px 10px;}',
        '.dtg-textarea{resize:vertical;min-height:56px;}',
        '.dtg-input:focus-visible,.dtg-textarea:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));}',
        '.dtg-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:28px;padding:0 10px;border-radius:8px;font:inherit;font-size:12px;line-height:18px;cursor:pointer;}',
        '.dtg-btn-primary{border:none;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground,#fff);}',
        '.dtg-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary));}',
        '.dtg-btn-secondary{border:1px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-primary);}',
        '.dtg-btn-secondary:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid);}',
        '.dtg-btn-danger{border:none;background:transparent;color:var(--dsw-alias-state-error-primary);}',
        '.dtg-btn-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,transparent);}',
        '.dtg-btn:disabled{opacity:.4;cursor:default;}',
        '.dtg-btn:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));}',
        '.dtg-group{display:flex;flex-direction:column;gap:6px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-base);}',
        '.dtg-group-name{font-size:14px;line-height:20px;font-weight:600;}',
        '.dtg-code{font-family:var(--dsw-alias-font-family-mono,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:12px;line-height:18px;padding:1px 6px;border-radius:4px;background:var(--dsw-alias-bg-2,#f2f3f5);color:var(--dsw-alias-label-secondary,#555);flex:none;}',
        '.dtg-group-desc{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);}',
        '.dtg-meta{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));}',
        '.dtg-chip{appearance:none;border:1px solid var(--dsw-alias-border-l3);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:16px;padding:3px 10px;cursor:pointer;}',
        '.dtg-chip:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid);}',
        '.dtg-chip.is-on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#111);}',
        '.dtg-chip:disabled{opacity:.4;cursor:default;}',
        '.dtg-chip:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));}',
        '.dtg-badge{display:inline-block;border-radius:999px;padding:0 8px;font-size:10px;line-height:16px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);}',
        '.dtg-list{display:flex;flex-direction:column;}',
        '.dtg-item{display:flex;align-items:center;gap:10px;padding:8px;border-radius:8px;}',
        '.dtg-item:hover{background:var(--dsw-alias-interactive-bg-hover-solid);}',
        '.dtg-item.is-resident{opacity:.7;}',
        '.dtg-item-name{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12.5px;line-height:18px;}',
        '.dtg-empty{padding:16px;text-align:center;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);}',
        '.dtg-error{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary);}',
        '.dtg-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);}',
        '.dtg-divider{height:1px;background:var(--dsw-alias-border-l1);}',
        '.dtg-select{flex:none;max-width:190px;height:28px;box-sizing:border-box;padding:0 26px 0 8px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;appearance:none;background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);background-position:calc(100% - 15px) 12px,calc(100% - 10px) 12px;background-size:5px 5px,5px 5px;background-repeat:no-repeat;}',
        '.dtg-select:hover:not(:disabled){border-color:var(--dsw-alias-border-l4,var(--dsw-alias-border-l3));}',
        '.dtg-select:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));}',
        '.dtg-select:disabled{opacity:.5;cursor:default;}',
        '.dtg-footer{position:sticky;bottom:0;display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-2);}',
        '.dtg-injected{border-style:dashed;background:transparent;}',
        '.dtg-switch{position:relative;flex:none;width:36px;height:20px;border-radius:999px;border:none;background:var(--dsw-alias-border-l3,#b8bcc4);cursor:pointer;padding:0;transition:background .15s;}',
        '.dtg-switch.is-on{background:var(--dsw-alias-state-success-primary,#22c55e);}',
        '.dtg-switch:disabled{opacity:.5;cursor:default;}',
        '.dtg-switch:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));}',
        '.dtg-switch-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s;}',
        '.dtg-switch.is-on .dtg-switch-knob{transform:translateX(16px);}',
        '.dtg-panel[hidden]{display:none;}',
        '.dtg-panel{display:flex;flex-direction:column;gap:12px;}',
      ].join('\n');

      // ── 工具函数 ──────────────────────────────────────────────────────────
      function format(t, key, values) {
        var text = t(key);
        for (var name in values) {
          if (Object.prototype.hasOwnProperty.call(values, name)) {
            text = text.split('{' + name + '}').join(String(values[name]));
          }
        }
        return text;
      }

      function callApi(body) {
        return fetch(API, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          credentials: 'same-origin',
        }).then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            if (!res.ok || (data && data.error)) {
              throw new Error((data && data.error) || ('HTTP ' + res.status));
            }
            return data;
          });
        });
      }

      // ── 选项卡外壳（roving tabindex + 方向键） ────────────────────────────
      function useTabs(rows) {
        var idSeed = useId();
        var refs = useRef([]);
        var activeState = useState(rows[0].id);
        var active = activeState[0];
        var setActive = activeState[1];
        var seenState = useState(function () { return new Set([rows[0].id]); });
        var seen = seenState[0];
        var setSeen = seenState[1];
        useEffect(function () {
          setSeen(function (prev) {
            if (prev.has(active)) return prev;
            var next = new Set(prev);
            next.add(active);
            return next;
          });
        }, [active]);
        var buttons = rows.map(function (row, index) {
          var selected = row.id === active;
          return h('button', {
            key: row.id,
            ref: function (el) { refs.current[index] = el; },
            id: idSeed + '-tab-' + row.id,
            type: 'button',
            role: 'tab',
            className: 'dtg-tab' + (selected ? ' is-active' : ''),
            'aria-selected': selected ? 'true' : 'false',
            'aria-controls': idSeed + '-panel-' + row.id,
            tabIndex: selected ? 0 : -1,
            onClick: function () { setActive(row.id); },
            onKeyDown: function (event) {
              var next = -1;
              if (event.key === 'ArrowRight') next = (index + 1) % rows.length;
              else if (event.key === 'ArrowLeft') next = (index - 1 + rows.length) % rows.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = rows.length - 1;
              if (next < 0) return;
              event.preventDefault();
              setActive(rows[next].id);
              if (refs.current[next]) refs.current[next].focus();
            },
          }, row.label);
        });
        var panels = rows.map(function (row) {
          var selected = row.id === active;
          var shouldMount = selected || seen.has(row.id);
          return h('div', {
            key: row.id,
            id: idSeed + '-panel-' + row.id,
            role: 'tabpanel',
            'aria-labelledby': idSeed + '-tab-' + row.id,
            className: 'dtg-panel',
            hidden: selected ? undefined : true,
          }, shouldMount ? row.body(selected) : null);
        });
        return {
          tablist: h('div', { className: 'dtg-tabs', role: 'tablist' }, buttons),
          panels: h('div', null, panels),
        };
      }

      // ── 选项卡 1：管理工具组 ──────────────────────────────────────────────
      function ManageTab(props) {
        var t = props.t;
        var state = props.state;
        var busy = props.busy;
        var onRun = props.onRun;
        var groups = state.groups;

        var nameState = useState('');
        var englishState = useState('');
        var descriptionState = useState('');
        var editingState = useState(null);
        var confirmingState = useState(null);

        var create = function () {
          var trimmed = nameState[0].trim();
          var english = englishState[0].trim().toLowerCase();
          if (trimmed === '' || english === '') return;
          onRun({ action: 'createGroup', name: trimmed, englishName: english, description: descriptionState[0].trim() }).then(function (ok) {
            if (ok) {
              nameState[1]('');
              englishState[1]('');
              descriptionState[1]('');
            }
          });
        };

        return h('div', { className: 'dtg-card' },
          h('div', { className: 'dtg-group-name' }, t('createTitle')),
          h('div', null,
            h('label', { className: 'dtg-label', htmlFor: 'dtg-new-english' }, t('englishNameLabel')),
            h('input', {
              id: 'dtg-new-english',
              className: 'dtg-input',
              value: englishState[0],
              maxLength: 64,
              placeholder: t('englishNamePlaceholder'),
              onChange: function (event) { englishState[1](event.target.value); },
              onKeyDown: function (event) { if (event.key === 'Enter') create(); },
            })
          ),
          h('div', null,
            h('label', { className: 'dtg-label', htmlFor: 'dtg-new-name' }, t('nameLabel')),
            h('input', {
              id: 'dtg-new-name',
              className: 'dtg-input',
              value: nameState[0],
              maxLength: 60,
              placeholder: t('namePlaceholder'),
              onChange: function (event) { nameState[1](event.target.value); },
              onKeyDown: function (event) { if (event.key === 'Enter') create(); },
            })
          ),
          h('div', null,
            h('label', { className: 'dtg-label', htmlFor: 'dtg-new-desc' }, t('descriptionLabel')),
            h('textarea', {
              id: 'dtg-new-desc',
              className: 'dtg-textarea',
              value: descriptionState[0],
              maxLength: 400,
              placeholder: t('descriptionPlaceholder'),
              onChange: function (event) { descriptionState[1](event.target.value); },
            })
          ),
          h('div', { className: 'dtg-row' },
            h('button', {
              type: 'button',
              className: 'dtg-btn dtg-btn-primary',
              disabled: busy || nameState[0].trim() === '' || englishState[0].trim() === '',
              onClick: create,
            }, busy ? t('saving') : t('create'))
          ),
          h('div', { className: 'dtg-hint' }, props.hint),
          groups.length === 0
            ? h('div', { className: 'dtg-empty' }, t('empty'))
            : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
              groups.map(function (group) {
                var editing = editingState[0];
                var isEditing = editing !== null && editing.original === group.name;
                return h('div', { key: group.name, className: 'dtg-group' },
                  isEditing
                    ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                      h('input', {
                        className: 'dtg-input',
                        value: editing.englishName,
                        maxLength: 64,
                        placeholder: t('englishNamePlaceholder'),
                        'aria-label': t('englishNameLabel'),
                        onChange: function (event) { editingState[1]({ original: editing.original, englishName: event.target.value, name: editing.name, description: editing.description }); },
                      }),
                      h('input', {
                        className: 'dtg-input',
                        value: editing.name,
                        maxLength: 60,
                        'aria-label': t('nameLabel'),
                        onChange: function (event) { editingState[1]({ original: editing.original, englishName: editing.englishName, name: event.target.value, description: editing.description }); },
                      }),
                      h('textarea', {
                        className: 'dtg-textarea',
                        value: editing.description,
                        maxLength: 400,
                        'aria-label': t('descriptionLabel'),
                        onChange: function (event) { editingState[1]({ original: editing.original, englishName: editing.englishName, name: editing.name, description: event.target.value }); },
                      }),
                      h('div', { className: 'dtg-row' },
                        h('button', {
                          type: 'button',
                          className: 'dtg-btn dtg-btn-primary',
                          disabled: busy,
                          onClick: function () {
                            onRun({ action: 'updateGroup', group: group.name, englishName: editing.englishName.trim().toLowerCase(), name: editing.name.trim(), description: editing.description }).then(function (ok) {
                              if (ok) editingState[1](null);
                            });
                          },
                        }, t('save')),
                        h('button', { type: 'button', className: 'dtg-btn dtg-btn-secondary', onClick: function () { editingState[1](null); } }, t('cancel'))
                      )
                    )
                    : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                      h('div', { className: 'dtg-row' },
                        h('code', { className: 'dtg-code' }, group.englishName),
                        h('div', { className: 'dtg-group-name dtg-grow' }, group.name),
                        group.enabled === false ? h('span', { className: 'dtg-badge' }, t('groupOff')) : null,
                        h('div', { className: 'dtg-meta' }, format(t, 'memberCount', { tools: group.tools.length, skills: group.skills.length })),
                        h('button', {
                          type: 'button',
                          role: 'switch',
                          'aria-checked': group.enabled !== false ? 'true' : 'false',
                          'aria-label': t(group.enabled !== false ? 'disableGroup' : 'enableGroup'),
                          title: t(group.enabled !== false ? 'disableGroup' : 'enableGroup'),
                          className: 'dtg-switch' + (group.enabled !== false ? ' is-on' : ''),
                          disabled: busy,
                          onClick: function () {
                            onRun({ action: 'setGroupEnabled', group: group.name, enabled: group.enabled === false });
                          },
                        }, h('span', { className: 'dtg-switch-knob', 'aria-hidden': 'true' }))
                      ),
                      h('p', { className: 'dtg-group-desc' }, group.description || '—'),
                      group.tools && group.tools.length > 0
                        ? h('p', { className: 'dtg-hint' }, format(t, 'memberToolsLine', { names: group.tools.join('、') }))
                        : null,
                      group.missingTools && group.missingTools.length > 0
                        ? h('div', { className: 'dtg-row dtg-row-wrap' },
                          h('span', { className: 'dtg-hint dtg-grow' }, format(t, 'missingTools', { names: group.missingTools.join('、') })),
                          h('button', {
                            type: 'button',
                            className: 'dtg-btn dtg-btn-secondary',
                            disabled: busy,
                            onClick: function () {
                              onRun({ action: 'pruneGroup', group: group.name });
                            },
                          }, t('prune'))
                        )
                        : group.unavailableTools && group.unavailableTools.length > 0
                          ? h('p', { className: 'dtg-hint' }, format(t, 'unavailableTools', { names: group.unavailableTools.join('、') }))
                          : null,
                      confirmingState[0] === group.name
                        ? h('div', { className: 'dtg-row dtg-row-wrap' },
                          h('span', { className: 'dtg-hint dtg-grow' }, t('deleteConfirm')),
                          h('button', {
                            type: 'button',
                            className: 'dtg-btn dtg-btn-danger',
                            disabled: busy,
                            onClick: function () {
                              onRun({ action: 'deleteGroup', group: group.name }).then(function (ok) {
                                if (ok) confirmingState[1](null);
                              });
                            },
                          }, t('delete')),
                          h('button', { type: 'button', className: 'dtg-btn dtg-btn-secondary', onClick: function () { confirmingState[1](null); } }, t('cancel'))
                        )
                        : h('div', { className: 'dtg-row' },
                          h('button', {
                            type: 'button',
                            className: 'dtg-btn dtg-btn-secondary',
                            onClick: function () { editingState[1]({ original: group.name, englishName: group.englishName, name: group.name, description: group.description }); },
                          }, t('rename')),
                          h('button', {
                            type: 'button',
                            className: 'dtg-btn dtg-btn-danger',
                            onClick: function () { confirmingState[1](group.name); },
                          }, t('delete'))
                        )
                    )
                );
              })
            )
        );
      }

      // 组名编辑行：英文名（AI 侧）+ 中文名（仅人类可见）。
      function GroupNameRow(props) {
        var t = props.t;
        var group = props.group;
        var busy = props.busy;
        var onRun = props.onRun;
        var englishState = useState(group.englishName || '');
        var nameState = useState(group.name || '');
        useEffect(function () {
          englishState[1](group.englishName || '');
          nameState[1](group.name || '');
        }, [group.englishName, group.name]);
        var dirty = englishState[0].trim() !== (group.englishName || '')
          || nameState[0].trim() !== (group.name || '');
        return h('div', { className: 'dtg-row dtg-row-wrap' },
          h('input', {
            className: 'dtg-input dtg-grow',
            value: englishState[0],
            maxLength: 64,
            placeholder: t('englishNamePlaceholder'),
            'aria-label': t('englishNameLabel'),
            onChange: function (event) { englishState[1](event.target.value); },
          }),
          h('input', {
            className: 'dtg-input dtg-grow',
            value: nameState[0],
            maxLength: 60,
            'aria-label': t('nameLabel'),
            onChange: function (event) { nameState[1](event.target.value); },
          }),
          h('button', {
            type: 'button',
            className: 'dtg-btn dtg-btn-primary',
            disabled: busy || !dirty,
            onClick: function () {
              onRun({ action: 'updateGroup', group: group.name, englishName: englishState[0].trim().toLowerCase(), name: nameState[0].trim() });
            },
          }, t('saveNames'))
        );
      }

      // ── 选项卡 2：对现有工具编组（下拉菜单 + 确认生效） ──────────────────
      function AssignTab(props) {
        var t = props.t;
        var state = props.state;
        var busy = props.busy;
        var onRun = props.onRun;

        var queryState = useState('');
        var query = queryState[0].trim().toLowerCase();

        // 草稿：key → 目标组名（'' = 常驻/未分组）。initial 记下服务端值用于算「未保存」。
        var initialRef = useRef({});
        var draftState = useState({});
        var draft = draftState[0];
        var setDraft = draftState[1];
        var savedTickState = useState(0);
        var savedTick = savedTickState[0];
        var setSavedTick = savedTickState[1];

        var keyOf = function (kind, name) { return kind + ':' + name; };
        var serverValue = function (entry) {
          return entry.groups.length > 0 ? entry.groups[0] : '';
        };

        useEffect(function () {
          var initial = {};
          var next = {};
          var all = [];
          var validGroup = {};
          for (var groupIndex = 0; groupIndex < state.groups.length; groupIndex += 1) {
            validGroup[state.groups[groupIndex].name] = true;
          }
          for (var index = 0; index < state.tools.length; index += 1) {
            if (state.tools[index].name.indexOf('mcp__') !== 0) continue;
            all.push({ kind: 'tool', entry: state.tools[index] });
          }
          for (var skillIndex = 0; skillIndex < state.skills.length; skillIndex += 1) {
            all.push({ kind: 'skill', entry: state.skills[skillIndex] });
          }
          for (var itemIndex = 0; itemIndex < all.length; itemIndex += 1) {
            var item = all[itemIndex];
            var key = keyOf(item.kind, item.entry.name);
            initial[key] = serverValue(item.entry);
            // 保留用户已选但还没提交的值，避免后台刷新冲掉草稿；
            // 该值所属的组若已被删除，就回落到服务端值。
            var kept = Object.prototype.hasOwnProperty.call(draft, key) ? draft[key] : initial[key];
            if (kept !== '' && validGroup[kept] !== true) kept = initial[key];
            next[key] = kept;
          }
          initialRef.current = initial;
          setDraft(next);
        }, [state]);

        var entries = [];
        for (var toolIndex = 0; toolIndex < state.tools.length; toolIndex += 1) {
          if (state.tools[toolIndex].name.indexOf('mcp__') !== 0) continue;
          entries.push({ kind: 'tool', entry: state.tools[toolIndex] });
        }
        for (var allSkillIndex = 0; allSkillIndex < state.skills.length; allSkillIndex += 1) {
          entries.push({ kind: 'skill', entry: state.skills[allSkillIndex] });
        }

        var dirtyList = entries.filter(function (item) {
          var key = keyOf(item.kind, item.entry.name);
          return Object.prototype.hasOwnProperty.call(initialRef.current, key)
            && draft[key] !== initialRef.current[key];
        });

        var groupNames = state.groups.map(function (group) { return group.name; });

        var matches = function (entry) {
          if (query === '') return true;
          return entry.name.toLowerCase().indexOf(query) >= 0
            || (entry.description || '').toLowerCase().indexOf(query) >= 0;
        };

        var setValue = function (kind, name, value) {
          var key = keyOf(kind, name);
          var next = Object.assign({}, draft);
          next[key] = value;
          setDraft(next);
          setSavedTick(0);
        };

        var apply = function () {
          if (dirtyList.length === 0) return;
          var payload = dirtyList.map(function (item) {
            var key = keyOf(item.kind, item.entry.name);
            var value = draft[key];
            return { kind: item.kind, name: item.entry.name, groups: value === '' ? [] : [value] };
          });
          onRun({ action: 'setMemberships', entries: payload }).then(function (ok) {
            if (ok) setSavedTick(function (prev) { return prev + 1; });
          });
        };

        var discard = function () {
          setDraft(Object.assign({}, initialRef.current));
          setSavedTick(0);
        };

        var renderRow = function (kind, entry) {
          var key = keyOf(kind, entry.name);
          var resident = kind === 'tool' && entry.resident;
          var value = Object.prototype.hasOwnProperty.call(draft, key) ? draft[key] : serverValue(entry);
          var multi = entry.groups.length > 1;
          var description = entry.description
            ? (entry.description.length > 160 ? entry.description.slice(0, 160) + '…' : entry.description)
            : '';
          return h('div', {
            key: key,
            className: 'dtg-item' + (resident ? ' is-resident' : ''),
          },
            h('div', { className: 'dtg-grow' },
              h('div', { className: 'dtg-row dtg-row-wrap' },
                h('span', { className: 'dtg-item-name' }, entry.name),
                resident ? h('span', { className: 'dtg-badge' }, t('resident')) : null,
                entry.meta ? h('span', { className: 'dtg-badge' }, t('meta')) : null,
                multi ? h('span', { className: 'dtg-badge' }, format(t, 'multiGroup', { count: entry.groups.length })) : null
              ),
              description
                ? h('p', { className: 'dtg-group-desc', title: entry.description }, description)
                : h('p', { className: 'dtg-meta' }, t('noDescription'))
            ),
            h('select', {
              className: 'dtg-select',
              value: value === '' ? '__resident__' : value,
              disabled: busy || resident,
              'aria-label': t('selectLabel'),
              title: t('selectLabel'),
              onChange: function (event) {
                var nextValue = event.target.value;
                setValue(kind, entry.name, nextValue === '__resident__' ? '' : nextValue);
              },
            },
              h('option', { value: '__resident__' }, t('residentOption')),
              groupNames.map(function (groupName) {
                var found = state.groups.filter(function (item) { return item.name === groupName; })[0];
                return h('option', { key: groupName, value: groupName }, found ? found.englishName + ' · ' + groupName : groupName);
              })
            )
          );
        };

        var mcpTools = state.tools.filter(function (entry) { return entry.name.indexOf('mcp__') === 0; }).filter(matches);
        var skills = state.skills.filter(matches);
        var savedVisible = savedTick > 0 && dirtyList.length === 0;

        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
          h('div', { className: 'dtg-card' },
            h('input', {
              className: 'dtg-input',
              value: queryState[0],
              placeholder: t('searchPlaceholder'),
              'aria-label': t('searchPlaceholder'),
              onChange: function (event) { queryState[1](event.target.value); },
            }),
            h('p', { className: 'dtg-hint' }, t('applyHint')),
            h('p', { className: 'dtg-hint' }, t('residentNote')),
            h('p', { className: 'dtg-hint' }, t('skillsHint'))
          ),
          h('div', { className: 'dtg-card' },
            h('div', { className: 'dtg-group-name' }, t('groupNamesTitle')),
            h('p', { className: 'dtg-hint' }, t('namesHint')),
            state.groups.map(function (group) {
              return h(GroupNameRow, { key: group.name, group: group, t: t, busy: busy, onRun: onRun });
            })
          ),
          h('div', { className: 'dtg-card' },
            h('div', { className: 'dtg-group-name' }, t('mcpHeading') + ' · ' + mcpTools.length),
            h('div', { className: 'dtg-divider' }),
            mcpTools.length === 0
              ? h('div', { className: 'dtg-empty' }, t('noMcp'))
              : h('div', { className: 'dtg-list' }, mcpTools.map(function (entry) { return renderRow('tool', entry); }))
          ),
          h('div', { className: 'dtg-card' },
            h('div', { className: 'dtg-group-name' }, t('skillsHeading') + ' · ' + skills.length),
            h('div', { className: 'dtg-divider' }),
            skills.length === 0
              ? h('div', { className: 'dtg-empty' }, t('noSkills'))
              : h('div', { className: 'dtg-list' }, skills.map(function (entry) { return renderRow('skill', entry); }))
          ),
          h('div', { className: 'dtg-footer' },
            h('span', { className: 'dtg-hint dtg-grow' },
              dirtyList.length === 0
                ? (savedVisible ? t('saved') : t('noPending'))
                : format(t, 'unsaved', { count: dirtyList.length })
            ),
            h('button', {
              type: 'button',
              className: 'dtg-btn dtg-btn-secondary',
              disabled: busy || dirtyList.length === 0,
              onClick: discard,
            }, t('discard')),
            h('button', {
              type: 'button',
              className: 'dtg-btn dtg-btn-primary',
              disabled: busy || dirtyList.length === 0,
              onClick: apply,
            }, busy ? t('saving') : t('apply'))
          )
        );
      }

      // ── 页面 ──────────────────────────────────────────────────────────────
      function ToolGroupsPage(props) {
        var t = props.t;
        var stateState = useState(null);
        var state = stateState[0];
        var setState = stateState[1];
        var errorState = useState(null);
        var error = errorState[0];
        var setError = errorState[1];
        var busyState = useState(false);
        var busy = busyState[0];
        var setBusy = busyState[1];
        var aliveRef = useRef(true);

        useEffect(function () {
          aliveRef.current = true;
          return function () { aliveRef.current = false; };
        }, []);

        var refresh = useCallback(function () {
          return callApi({ action: 'state' }).then(function (data) {
            if (!aliveRef.current) return;
            var hidden = 0;
            for (var index = 0; index < data.tools.length; index += 1) {
              if (!data.tools[index].resident && data.tools[index].groups.length > 0) hidden += 1;
            }
            setState({
              groups: data.groups,
              tools: data.tools,
              skills: data.skills,
              hiddenCount: hidden,
              configPath: data.configPath,
              configError: data.configError,
            });
            setError(null);
          }).catch(function (failure) {
            if (aliveRef.current) setError(String(failure.message || failure));
          });
        }, []);

        useEffect(function () { refresh(); }, [refresh]);

        var onRun = useCallback(function (body) {
          setBusy(true);
          return callApi(body)
            .then(function () { return refresh(); })
            .then(function () { return true; })
            .catch(function (failure) {
              if (aliveRef.current) setError(String(failure.message || failure));
              return false;
            })
            .then(function (ok) {
              if (aliveRef.current) setBusy(false);
              return ok;
            });
        }, [refresh]);

        var hint = state === null
          ? ''
          : state.hiddenCount === 0
            ? t('hiddenHintNone')
            : format(t, 'hiddenHint', { count: state.hiddenCount });

        var tabs = useTabs([
          {
            id: 'groups',
            label: t('tabGroups'),
            body: function () {
              if (state === null) return h('div', { className: 'dtg-empty' }, t('loading'));
              return h(ManageTab, { t: t, state: state, busy: busy, onRun: onRun, hint: hint });
            },
          },
          {
            id: 'assign',
            label: t('tabAssign'),
            body: function () {
              if (state === null) return h('div', { className: 'dtg-empty' }, t('loading'));
              return h(AssignTab, { t: t, state: state, busy: busy, onRun: onRun });
            },
          },
        ]);

        return h('div', { className: 'dtg-root' },
          h('div', null,
            h('h2', { className: 'dtg-title' }, t('title')),
            h('p', { className: 'dtg-sub' }, t('subtitle'))
          ),
          error === null ? null : h('div', { className: 'dtg-error', role: 'alert' }, t('genericError') + error),
          tabs.tablist,
          tabs.panels,
          state !== null && state.configError ? h('div', { className: 'dtg-error' }, t('loadFailed') + state.configError) : null,
          state !== null && state.configPath ? h('div', { className: 'dtg-meta' }, t('configPath') + state.configPath) : null
        );
      }

      // ── 注册 ──────────────────────────────────────────────────────────────
      return {
        name: PLUGIN_ID,
        inject: ['slots', 'locale'],
        apply: function apply(ctx) {
          var t = ctx.locale.bind(NS);

          ctx.effect(function () {
            return ctx.locale.register(NS, { zh: DICT.zh, en: DICT.en });
          }, 'dsh-tool-groups: locale dictionaries');

          ctx.effect(function () {
            var style = document.createElement('style');
            style.setAttribute('data-plugin', PLUGIN_ID);
            style.textContent = CSS;
            document.head.appendChild(style);
            return function () { style.remove(); };
          }, 'dsh-tool-groups: styles');

          ctx.slots.inject('settings.section', function () {
            return ctx.slots.register({
              name: 'settings.section',
              id: SECTION_ID,
              order: 70,
              label: function () { return t('nav'); },
              locale: NS,
            }, ToolGroupsPage);
          });
        },
      };
    },
  });
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : null);
