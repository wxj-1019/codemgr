"""审计样机生成器：vite build 后运行，把 dist-renderer/index.html 的 hash 资源名
注入 docs/superpowers/specs/audit-shim.html，产出 dist-renderer/audit.html。
用法：py scripts/gen-audit.py（从 app/ 目录）"""
import io, re, sys

s = io.open('dist-renderer/index.html', encoding='utf-8').read()
js = re.search(r'src="(\./assets/index-[^"]+\.js)"', s).group(1)
css = re.search(r'href="(\./assets/index-[^"]+\.css)"', s).group(1)
shim = io.open('../docs/superpowers/specs/audit-shim.html', encoding='utf-8').read()
out = shim.replace('__APP_JS__', js).replace('__APP_CSS__', css)
io.open('dist-renderer/audit.html', 'w', encoding='utf-8').write(out)
print('audit.html <-', js, css)
