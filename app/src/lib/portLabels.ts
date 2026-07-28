// 端口 → 标签规则表。dev server 与数据库服务分开，便于 UI 区分高亮。
export const DEV_PORT_HINTS: Record<number, { label: string; kind: 'dev' | 'db' }> = {
  // 前端/全栈 dev server
  3000:  { label: 'dev server', kind: 'dev' },   // next/create-react-app/默认
  3001:  { label: 'dev server', kind: 'dev' },
  4173:  { label: 'vite preview', kind: 'dev' },
  5173:  { label: 'vite', kind: 'dev' },
  5174:  { label: 'vite', kind: 'dev' },
  8000:  { label: 'dev server', kind: 'dev' },   // django/python
  8080:  { label: 'dev server', kind: 'dev' },
  8888:  { label: 'dev server', kind: 'dev' },   // jupyter
  4200:  { label: 'angular', kind: 'dev' },
  // 数据库 / 缓存
  3306:  { label: 'MySQL', kind: 'db' },
  5432:  { label: 'PostgreSQL', kind: 'db' },
  27017: { label: 'MongoDB', kind: 'db' },
  6379:  { label: 'Redis', kind: 'db' },
  1433:  { label: 'SQL Server', kind: 'db' },
};

export function labelForPort(port: number): string | null {
  return DEV_PORT_HINTS[port]?.label ?? null;
}

export function isDevPort(port: number): boolean {
  return DEV_PORT_HINTS[port]?.kind === 'dev';
}

export function isDbPort(port: number): boolean {
  return DEV_PORT_HINTS[port]?.kind === 'db';
}
