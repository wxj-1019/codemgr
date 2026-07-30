import type { BadgeTone } from '../components/ui/Badge';

export const PROCESS_KIND_TONES: Readonly<Record<string, BadgeTone>> = {
  dev: 'accent',
  test: 'success',
  build: 'accent',
  container: 'info',
  db: 'warning',
  system: 'neutral',
  ai: 'accent',
  'ai-ide': 'info',
};

export function getProcessKindTone(kind: string): BadgeTone {
  return PROCESS_KIND_TONES[kind] ?? 'neutral';
}
