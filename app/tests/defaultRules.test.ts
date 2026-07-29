import { describe, it, expect } from 'vitest';
import { matchRules } from '../src/lib/labelRules';
import { DEFAULT_RULES } from '../src/lib/defaultRules';

const match = (name: string, cmdline: string) => matchRules(DEFAULT_RULES, name, cmdline);

describe('DEFAULT_RULES — AI 开发工具', () => {
  it('claude CLI → Claude Code / ai', () => {
    expect(
      match('node.exe', 'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd --resume'),
    ).toEqual({ label: 'Claude Code', kind: 'ai' });
  });

  it('kimi CLI → Kimi Code / ai', () => {
    expect(
      match('node.exe', 'C:\\Users\\me\\AppData\\Roaming\\npm\\kimi.cmd'),
    ).toEqual({ label: 'Kimi Code', kind: 'ai' });
    expect(match('kimi.exe', '')).toEqual({ label: 'Kimi Code', kind: 'ai' });
  });

  it('aider → Aider / ai', () => {
    expect(
      match('python.exe', 'python -m aider --model gpt-4o'),
    ).toEqual({ label: 'Aider', kind: 'ai' });
  });

  it('codex CLI → Codex CLI / ai', () => {
    expect(
      match('node.exe', 'C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd'),
    ).toEqual({ label: 'Codex CLI', kind: 'ai' });
  });

  it('Cursor 编辑器（按 name 匹配）→ Cursor / ai-ide', () => {
    expect(
      match('Cursor.exe', 'C:\\Users\\me\\AppData\\Local\\Programs\\cursor\\Cursor.exe'),
    ).toEqual({ label: 'Cursor', kind: 'ai-ide' });
  });

  it('ollama → Ollama (local LLM) / ai', () => {
    expect(match('ollama.exe', 'ollama serve')).toEqual({
      label: 'Ollama (local LLM)',
      kind: 'ai',
    });
  });

  it('LM Studio → LM Studio / ai', () => {
    expect(
      match('lmstudio.exe', 'C:\\Program Files\\LM Studio\\lmstudio.exe'),
    ).toEqual({ label: 'LM Studio', kind: 'ai' });
  });
});

describe('DEFAULT_RULES — AI 规则不误伤', () => {
  it('用户名 kimiko 路径不命中 Kimi Code，落回 generic node app', () => {
    const m = match('node.exe', 'C:\\Users\\kimiko\\app\\node.exe server.js');
    expect(m?.label).not.toBe('Kimi Code');
    expect(m?.label).toBe('node app');
  });

  it('cmdline 出现 cursor 字样但 name 不含 → 不命中 Cursor', () => {
    const m = match('node.exe', 'node cursor-sim.js');
    expect(m?.label).not.toBe('Cursor');
  });

  it('AI 规则优先于 generic node app（claude code 本体是 node 进程）', () => {
    const m = match(
      'node.exe',
      'node C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js',
    );
    expect(m?.label).toBe('Claude Code');
  });

  it('普通 node 脚本仍命中 node app', () => {
    expect(match('node.exe', 'node server.js')?.label).toBe('node app');
  });
});
