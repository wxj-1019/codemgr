import { describe, it, expect } from 'vitest';
import { sanitizeExportName, EXPORT_MAX_CONTENT_BYTES } from '../electron/exportFile';

describe('sanitizeExportName', () => {
  it('合法文件名原样通过', () => {
    expect(sanitizeExportName('codemgr-processes-20260731-0615.csv')).toBe('codemgr-processes-20260731-0615.csv');
    expect(sanitizeExportName('a.json')).toBe('a.json');
  });
  it('路径穿越剥离为 basename', () => {
    expect(sanitizeExportName('..\\..\\evil.csv')).toBe('evil.csv');
    expect(sanitizeExportName('C:/tmp/x.json')).toBe('x.json');
  });
  it('Windows 非法字符替换为下划线', () => {
    expect(sanitizeExportName('a<b>:"|?*.csv')).toBe('a_b______.csv'); // <b> 中的 b 是字面字符
    expect(sanitizeExportName('a<>:"|?*.csv')).toBe('a_______.csv');
  });
  it('扩展名白名单外拒绝', () => {
    expect(sanitizeExportName('x.exe')).toBeNull();
    expect(sanitizeExportName('x')).toBeNull();
    expect(sanitizeExportName('x.CSV')).toBe('x.CSV'); // 大小写不敏感放行
  });
  it('内容上限常量存在且为 10MB', () => {
    expect(EXPORT_MAX_CONTENT_BYTES).toBe(10 * 1024 * 1024);
  });
});
