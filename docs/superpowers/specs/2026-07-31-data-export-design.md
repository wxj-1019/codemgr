# 数据导出（进程/端口 CSV/JSON）设计

> 2026-07-31 · 状态：已批准（用户授权按优先级全部实施）· 来源：开发者体验审查 四-4

## 1. 问题

排查问题需要把进程/端口数据贴给别人（或喂给 AI）时，目前只能截图。标签规则已有受控导出（main 持路径对话框），但业务数据（进程列表、端口连接）无任何导出通道。

## 2. 目标 / 非目标

**目标**
- 进程面板、端口雷达各加一个「导出」入口，把**当前过滤视图**导出为 CSV 或 JSON。
- 守红线：路径由 main 保存对话框决定，渲染层只传文件名建议 + 已序列化内容（与 exportLabelRules 同构）。
- 导出结果 toast 反馈（成功/失败；用户取消静默）。

**非目标（YAGNI）**
- 导出列自定义、快照文件导出、日志导出（日志面板后续可加，通道已通用）。
- Excel 格式（xlsx）、剪贴板直接导出。

## 3. 设计

### 3.1 IPC（新增 1 通用通道）

| 通道 | 载荷 | 返回 |
|---|---|---|
| `config:exportDataFile` | `defaultName: string, content: string` | `'ok' \| 'cancelled' \| 'error'` |

main 侧校验（`app/electron/main.ts` 内私有函数 + 纯逻辑放 `app/electron/exportFile.ts`，TDD）：
- `sanitizeExportName(name)`：取 basename、剥 Windows 非法字符、扩展名白名单（`.csv/.json/.txt/.log/.md`），非法 → 拒为 `'error'`。
- content 长度上限 10MB（防渲染层异常大 payload 拖垮主进程）。
- 对话框 filters 按扩展名给；`canceled` → `'cancelled'`。

### 3.2 序列化纯逻辑（`app/src/lib/exportData.ts`，TDD）

- `csvEscape(v)`：含 `,` `"` `\n` `\r` 时双引号包裹 + 内引号双写。
- `rowsToCsv(headers, rows)`：首行表头，\r\n 行尾（Excel 兼容）。
- `processesToCsv(procs, cpuMap)`：列 `pid,ppid,name,cpu_percent,memory_bytes,threads,cmdline,cwd,create_time_iso`。
- `connectionsToCsv(conns)`：列 `protocol,local_addr,local_port,remote_addr,remote_port,state,pid,process_name`。
- `toPrettyJson(data)`：`JSON.stringify(data, null, 2)`。
- `buildExportName(base, ext, now)`：`codemgr-<base>-YYYYMMDD-HHmm.<ext>`（注 `now` 参数便于测试）。

### 3.3 UI 集成

- ProcessPanel / PortRadar 的 PanelActionBar 各加一个 Download IconButton：点击在点击坐标开 ContextMenu（复用现有组件），两项「导出 CSV / 导出 JSON」。
- 数据源：**当前过滤后的可见行**（ProcessPanel 用 store 的 filtered 结果 + cpuMap；PortRadar 用 `filterConnections(connections, filter)` 结果）。导出内容 = 可见视图，与"所见即所得"直觉一致。
- 反馈：`ok` → `notify.success('已导出')`；`cancelled` → 静默；`error` → `notify.error('导出失败')`。

## 4. 测试（TDD）

- `exportFile.test.ts`（electron 纯逻辑）：sanitizeExportName 路径穿越剥离/非法字符/扩展名白名单/大小写。
- `exportData.test.ts`（渲染层）：csvEscape 四种情形、rowsToCsv 表头+行尾、processesToCsv/connectionsToCsv 列序、buildExportName 时间格式、toPrettyJson。
- 既有测试不回归。

## 5. 验收（人工）

1. 进程面板搜索 "node" 后导出 CSV → 只含过滤结果，Excel 打开列对齐、中文无乱码（utf8 + \r\n）。
2. 端口雷达导出 JSON → 结构化为数组，字段与表列一致。
3. 保存对话框点取消 → 无 toast；正常保存 → success toast。
