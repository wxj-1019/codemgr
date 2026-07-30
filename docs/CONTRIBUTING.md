# 贡献指南

本文件面向**人类贡献者**。AI 协作请读 [`AGENTS.md`](../AGENTS.md)。

---

## 开发环境

| 依赖 | 版本 |
|------|------|
| Node.js | 22（见 `.nvmrc`） |
| pnpm | 8 |
| Visual Studio Build Tools | 2022（含 C++ 桌面开发 + CMake 组件） |

```bash
git clone <repo>
cd codemgr
pnpm install          # 自动安装 + 编译 native（Node 目标）+ 软链 pre-commit hook
pnpm build:electron   # 为 Electron 重编译 native（首次必跑）
pnpm dev              # 启动开发
```

---

## 闭环工作流

```
① issue（想法/bug）
  └─ 用 issue 模板描述，明确"真问题"+"成功标准"
② 分支
  └─ git checkout -b feat/<scope>   # 从 main 拉
③ 开发
  └─ 遵循 AGENTS.md 规范，写测试
④ 本地验证
  └─ pre-commit hook 自动跑（增量 typecheck + test）
⑤ PR
  └─ 用 PR 模板，勾自检清单
⑥ CI
  └─ GitHub Actions 自动跑 typecheck + test + build
⑦ review + 合并
  └─ 至少 1 个 review，CI 绿灯后合并到 main
⑧ 发布
  └─ tag vX.Y.Z，更新 CHANGELOG.md
```

---

## 提交规范（Conventional Commits）

```
<type>(<scope>): <subject>
```

| type | 用于 |
|------|------|
| `feat` | 新功能 |
| `fix` | bug 修复 |
| `refactor` | 重构（不改行为） |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `docs` | 文档 |
| `build` | 构建系统/依赖 |
| `chore` | 杂项工程化 |

`scope` 可选：`native` / `app` / `ci` / `docs`。

示例：
- `feat(app): add process panel tree view`
- `fix(native): correct cmdline PEB offset for Win11`
- `chore(ci): add Windows build workflow`

---

## 分支策略

- `main`：永远可发布。**禁止直接 push**，走 PR。
- 功能分支：`feat/<scope>`（如 `feat/perf-panel`）
- 修复分支：`fix/<scope>`
- 工程化分支：`chore/<scope>`

---

## 测试规范

| 类型 | 工具 | 要求 |
|------|------|------|
| 纯逻辑（store/labels/纯函数） | Vitest | **TDD**，必须有测试 |
| UI 组件 | 人工验收 | PR 描述写明验收步骤 |
| native 采集 | Vitest | 每个 collector 有正确性测试 |
| native 性能 | bench 脚本 | 改采集层必跑 `pnpm bench` |

---

## 发布流程

1. 确认 `main` 上所有测试通过、`pnpm build` 成功。
2. 更新 `CHANGELOG.md`。
3. `git tag -a vX.Y.Z -m "版本说明"`。
4. `git push origin main --tags`。
5. （可选）GitHub 上基于 tag 创建 Release。

---

## 版本号（语义化版本）

- **主版本（X.0.0）**：不兼容的架构变更。
- **次版本（1.Y.0）**：向后兼容的新功能。
- **修订号（1.0.Z）**：向后兼容的 bug 修复。

---

## Roadmap

> 已发布能力见 `CHANGELOG.md` 与 `AGENTS.md` §8（本节只列未完成项；历史规划项的落地版本以 CHANGELOG 为准）。

### 已结案（曾规划、现已发布）
- 可拖拽面板布局（v1.7 react-mosaic）、标签规则自定义（v1.3）、按进程查看环境变量（v1.2）、亮色主题（v1.1）
- 进程 CPU/内存历史曲线（v1.3）、插件系统（v2.0 全部三步）、进程快照对比（v2.2）

### 已决策不做（2026-07-31 评审）
- **自定义列和排序预设**：进程表列在 v1.8–v2.4 演进后已稳定（9 列），表头排序交互已覆盖高频需求；列显隐/排序预设的维护成本高于价值。如有真实用户反馈再立项。

### 远期
- 远程连接（查看其他机器）
