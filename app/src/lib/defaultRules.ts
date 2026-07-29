// 默认标签规则：从原 processLabels.ts 的硬编码 if 链 1:1 迁移而来。
// 顺序与原实现完全一致（首匹配语义依赖顺序：build 必须在 generic vite 之前，test 必须在 generic node 之前）。
// id 用稳定前缀，便于用户「禁用默认规则」时跨版本引用（不会因重排而失联）。
import type { LabelRule } from './labelRules';

export const DEFAULT_RULES: LabelRule[] = [
  // ── 数据库 ──
  {
    id: 'default-postgres',
    label: 'PostgreSQL',
    kind: 'db',
    field: 'both', // 原规则：name OR both
    enabled: true,
    groups: [{ include: ['postgres'] }],
  },
  {
    id: 'default-mysql',
    label: 'MySQL',
    kind: 'db',
    field: 'name',
    enabled: true,
    groups: [{ include: ['mysql'] }, { include: ['mariadb'] }],
  },
  {
    id: 'default-mongodb',
    label: 'MongoDB',
    kind: 'db',
    field: 'name',
    enabled: true,
    groups: [{ include: ['mongod'] }, { include: ['mongos'] }],
  },
  {
    id: 'default-redis',
    label: 'Redis',
    kind: 'db',
    field: 'name',
    enabled: true,
    groups: [{ include: ['redis'] }],
  },

  // ── 容器 ──
  {
    id: 'default-docker',
    label: 'Docker',
    kind: 'container',
    field: 'name',
    enabled: true,
    groups: [{ include: ['docker'] }, { include: ['containerd'] }],
  },

  // ── AI 开发工具（必须在 generic node app 之前；claude/kimi 等 CLI 本体都是 node 进程）──
  {
    id: 'default-ai-claude',
    label: 'Claude Code',
    kind: 'ai',
    field: 'both',
    enabled: true,
    groups: [{ include: ['claude'] }],
  },
  {
    id: 'default-ai-kimi',
    label: 'Kimi Code',
    kind: 'ai',
    field: 'both',
    enabled: true,
    // 'kimi' 是短词，裸 contains 会误伤 'C:\Users\kimiko\...' 这类路径；
    // 用可执行文件名 / 路径边界片段规避（引擎只有子串匹配，无 regex/word-boundary）。
    groups: [
      { include: ['kimi.exe'] },
      { include: ['kimi.cmd'] },
      { include: ['kimi.ps1'] },
      { include: ['\\kimi\\'] },
      { include: ['/kimi/'] },
      { include: ['kimi-code'] },
      { include: ['kimi code'] },
    ],
  },
  {
    id: 'default-ai-aider',
    label: 'Aider',
    kind: 'ai',
    field: 'both',
    enabled: true,
    groups: [{ include: ['aider'] }],
  },
  {
    id: 'default-ai-codex',
    label: 'Codex CLI',
    kind: 'ai',
    field: 'both',
    enabled: true,
    groups: [{ include: ['codex'] }],
  },
  {
    id: 'default-ai-cursor',
    label: 'Cursor',
    kind: 'ai-ide',
    field: 'name', // 只看进程名：cmdline 里出现 'cursor' 字样（脚本名/参数）不算
    enabled: true,
    groups: [{ include: ['cursor'] }],
  },
  {
    id: 'default-ai-ollama',
    label: 'Ollama (local LLM)',
    kind: 'ai',
    field: 'both', // ollama.exe 本体与 'ollama serve' 子进程都覆盖
    enabled: true,
    groups: [{ include: ['ollama'] }],
  },
  {
    id: 'default-ai-lmstudio',
    label: 'LM Studio',
    kind: 'ai',
    field: 'both',
    enabled: true,
    groups: [{ include: ['lmstudio'] }, { include: ['lm studio'] }],
  },

  // ── 构建（必须在 generic vite 之前，以捕获 'vite build'）──
  {
    id: 'default-build',
    label: 'build task',
    kind: 'build',
    field: 'both',
    enabled: true,
    groups: [
      { include: ['vite', 'build'] },
      { include: ['webpack'] },
      { include: ['tsc'] },
      { include: ['npm run build'] },
    ],
  },

  // ── 测试（必须在 generic node 之前）──
  {
    id: 'default-test',
    label: 'test runner',
    kind: 'test',
    field: 'both',
    enabled: true,
    groups: [
      { include: ['jest'] },
      { include: ['mocha'] },
      { include: ['pytest'] },
      { include: ['vitest'] },
    ],
  },

  // ── 开发服务器 ──
  {
    id: 'default-vite-preview',
    label: 'vite preview',
    kind: 'dev',
    field: 'both',
    enabled: true,
    groups: [{ include: ['vite', 'preview'] }],
  },
  {
    id: 'default-vite',
    label: 'dev server',
    kind: 'dev',
    field: 'both',
    enabled: true,
    groups: [{ include: ['vite'] }],
  },
  {
    id: 'default-npm-dev',
    label: 'dev server',
    kind: 'dev',
    field: 'both',
    enabled: true,
    groups: [
      { include: ['npm run dev'] },
      { include: ['npm run start'] },
      { include: ['next dev'] },
    ],
  },
  {
    id: 'default-webpack-dev',
    label: 'webpack dev',
    kind: 'dev',
    field: 'both',
    enabled: true,
    groups: [{ include: ['webpack'], exclude: ['build'] }],
  },
  {
    id: 'default-react-dev',
    label: 'react dev',
    kind: 'dev',
    field: 'both',
    enabled: true,
    groups: [{ include: ['create-react-app'] }, { include: ['react-scripts'] }],
  },
  {
    id: 'default-python-dev',
    label: 'python dev',
    kind: 'dev',
    field: 'both',
    enabled: true,
    groups: [
      { include: ['python', 'manage.py'] },
      { include: ['python', 'flask'] },
      { include: ['python', 'django'] },
      { include: ['python', 'uvicorn'] },
    ],
  },
  {
    id: 'default-node-app',
    label: 'node app',
    kind: 'dev',
    field: 'both',
    enabled: true,
    groups: [
      { include: ['node', '.js'] },
      { include: ['node', '.ts'] },
      { include: ['node', '.mjs'] },
    ],
  },

  // ── 系统进程 ──
  {
    id: 'default-system',
    label: 'system',
    kind: 'system',
    field: 'name',
    enabled: true,
    groups: [
      { include: ['svchost'] },
      { include: ['lsass'] },
      { include: ['winlogon'] },
    ],
  },
];
