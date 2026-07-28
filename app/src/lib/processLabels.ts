export interface ProcessLabel {
  label: string;
  kind: 'dev' | 'test' | 'build' | 'container' | 'db' | 'system';
}

// Heuristic rules for labeling processes by name + command-line
export function labelForProcess(name: string, cmdline: string): ProcessLabel | null {
  const lower = (name + ' ' + cmdline).toLowerCase();

  // Database processes
  if (name.toLowerCase().includes('postgres') || lower.includes('postgres')) return { label: 'PostgreSQL', kind: 'db' };
  if (name.toLowerCase().includes('mysql') || name.toLowerCase().includes('mariadb')) return { label: 'MySQL', kind: 'db' };
  if (name.toLowerCase().includes('mongod') || name.toLowerCase().includes('mongos')) return { label: 'MongoDB', kind: 'db' };
  if (name.toLowerCase().includes('redis')) return { label: 'Redis', kind: 'db' };

  // Container
  if (name.toLowerCase().includes('docker') || name.toLowerCase().includes('containerd')) return { label: 'Docker', kind: 'container' };

  // Build patterns (before generic vite to catch 'vite build')
  if ((lower.includes('vite') && lower.includes('build')) || lower.includes('webpack') || lower.includes('tsc') || lower.includes('npm run build'))
    return { label: 'build task', kind: 'build' };

  // Test patterns (before generic node.js to catch jest, mocha, etc.)
  if (lower.includes('jest') || lower.includes('mocha') || lower.includes('pytest') || lower.includes('vitest'))
    return { label: 'test runner', kind: 'test' };

  // Dev server patterns
  if (lower.includes('vite') && lower.includes('preview')) return { label: 'vite preview', kind: 'dev' };
  if (lower.includes('vite')) return { label: 'dev server', kind: 'dev' };
  if (lower.includes('npm run dev') || lower.includes('npm run start') || lower.includes('next dev')) return { label: 'dev server', kind: 'dev' };
  if (lower.includes('webpack') && !lower.includes('build')) return { label: 'webpack dev', kind: 'dev' };
  if (lower.includes('create-react-app') || lower.includes('react-scripts')) return { label: 'react dev', kind: 'dev' };
  if (lower.includes('python') && (lower.includes('manage.py') || lower.includes('flask') || lower.includes('django') || lower.includes('uvicorn')))
    return { label: 'python dev', kind: 'dev' };
  if (lower.includes('node') && (lower.includes('.js') || lower.includes('.ts') || lower.includes('.mjs'))) return { label: 'node app', kind: 'dev' };

  // System processes
  if (name.toLowerCase().includes('svchost') || name.toLowerCase().includes('lsass') || name.toLowerCase().includes('winlogon'))
    return { label: 'system', kind: 'system' };

  return null;
}
