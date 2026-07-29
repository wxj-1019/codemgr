# CodeMgr 插件开发指南

> 版本：6b 第一步（标签规则注册）。视图嵌入（6b 第二步）和数据源（6c）尚未实现。

CodeMgr 插件让你扩展标签规则——给进程打自定义标签，无需改动 CodeMgr 本体。

---

## 工作原理

插件是一个 **HTML 文件**，运行在 CodeMgr 的 **iframe 沙箱**里：

- **安全**：iframe 用 `sandbox="allow-scripts"`（无 `allow-same-origin`）。插件**结构上无法**访问 Node.js、Electron、`ipcRenderer` 或 CodeMgr 内部。它唯一的能力出口是 `postMessage`。
- **隔离**：插件崩溃不会影响 CodeMgr 主窗口。
- **能力（当前）**：插件经 `postMessage` 注册**标签规则**。规则立即生效（下一帧渲染即应用）。

> 安全模型详见 `docs/superpowers/specs/2026-07-29-plugin-sandbox-spike.md`（F1 PoC 已实证：iframe 内 `require`/`process`/`codemgr` 全为 `undefined`）。

---

## 快速开始

### 1. 写插件 HTML

插件 HTML 监听宿主的 `ready` 信号，然后 `postMessage` 注册规则：

```html
<!doctype html>
<html><body><script>
  window.addEventListener('message', (e) => {
    if (e.data?.type !== 'ready') return;
    window.parent.postMessage({
      type: 'registerLabelRules',
      rules: [
        {
          label: 'Deno',        // 进程表里显示的徽章文字
          kind: 'dev',          // 类别，决定配色（见下）
          field: 'name',        // 在哪个字段匹配：'name' | 'cmdline' | 'both'
          enabled: true,
          groups: [             // 组间是 OR（任一组命中即打标签）
            { include: ['deno'], exclude: ['lint'] }  // include 是 AND，exclude 是 NOT
          ],
        },
      ],
    }, '*');
  });
</script></body></html>
```

完整示例见 `app/poc-plugin-sandbox/examples/label-rules-plugin.html`。

### 2. 放置插件文件

把插件 HTML 放到任意本地路径，例如：
```
C:\Users\<你>\AppData\Roaming\codemgr\plugins\deno.html
```

### 3. 登记到 manifest

在 CodeMgr 的 `userData` 目录（`%APPDATA%\codemgr\`，即 `C:\Users\<你>\AppData\Roaming\codemgr\`）创建 `plugins.json`：

```json
[
  {
    "id": "deno-rules",
    "name": "Deno 标签规则",
    "src": "C:\\Users\\你\\AppData\\Roaming\\codemgr\\plugins\\deno.html"
  }
]
```

| 字段 | 说明 |
|------|------|
| `id` | 稳定唯一标识（用于规则前缀和卸载清理） |
| `name` | 人类可读名称 |
| `src` | 插件 HTML 的**绝对路径** |

重启 CodeMgr，插件自动加载，规则立即生效。

---

## 标签规则结构

每条规则的字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `label` | `string` | 徽章文字（必填，非空） |
| `kind` | `string` | 类别，决定配色。内置：`dev`/`test`/`build`/`container`/`db`/`system`；未知 kind 走灰色 |
| `field` | `'name' \| 'cmdline' \| 'both'` | 在哪个字段匹配（both = name + ' ' + cmdline） |
| `enabled` | `boolean` | 是否启用 |
| `groups` | `ConditionGroup[]` | 条件组。**组间 OR**（任一命中即打标签） |

每个 `ConditionGroup`：
- `include: string[]` —— 全部子串命中才算本组命中（**AND**）。空数组永不命中。
- `exclude?: string[]` —— 任一命中则本组不命中（**NOT**）。可选。

匹配全部是小写子串比较（大小写不敏感）。

---

## 规则优先级

合并顺序（first-match-wins，第一条命中即停止）：

```
1. 内置默认规则（可被用户禁用/覆盖）
2. 用户自定义规则（在「标签规则」编辑器里加的）
3. 插件规则（本指南）—— 优先级最低
```

插件规则**不能覆盖**内置或用户规则——它只在前面都没命中时补充。这是设计决策（安全 + 可预测）。

---

## postMessage 协议

### 宿主 → 插件

| 消息 | 时机 | 说明 |
|------|------|------|
| `{ type: 'ready' }` | iframe 加载完成 | 插件收到后可开始注册能力 |

### 插件 → 宿主

| 消息 | 说明 |
|------|------|
| `{ type: 'registerLabelRules', rules: [...] }` | 注册标签规则。载荷会被严格校验，非法条目静默丢弃 |

> 规则的 `id` 由宿主强制赋值（`plugin:<插件id>-<序号>`），插件**无法**自行指定——防止跨插件 id 冲突。

---

## 安全约束（红线）

- ❌ 插件**不能** `require()` 任何模块（结构上无 Node）。
- ❌ 插件**不能**访问 `window.codemgr` 或 `ipcRenderer`（沙箱隔离）。
- ❌ 插件**不能**读写文件系统或网络（sandbox 限制）。
- ❌ 插件**不能**自带 `.node` 原生模块（6c 的 native 数据源需主仓库 review 加入白名单，未实现）。
- ✅ 插件**只能**经 `postMessage` 注册标签规则（受控能力）。

---

## 调试

- 插件 iframe 是 `display:none` 的（本次无可视 UI）。
- 规则是否生效：在「进程」面板查看对应进程是否被打上你的标签。
- manifest 不存在或损坏：CodeMgr 静默忽略（不报错），等价于无插件。
- 单个插件崩溃：不影响其它插件和主窗口（崩溃隔离已验证）。

## 后续（6b 第二步 / 6c）

- **视图嵌入**（6b 第二步）：插件贡献可视面板，嵌入 mosaic 布局。
- **只读快照**：宿主向插件推送进程/端口快照（视图插件的数据源）。
- **自定义数据源**（6c）：经 UtilityProcess + 白名单 native 能力。
