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
