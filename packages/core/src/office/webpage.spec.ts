import { describe, it, expect } from 'vitest';
import { extractMainText, isHttpUrl } from './webpage';

const html = `
<html><head><style>body{}</style><script>var x=1;</script></head>
<body>
  <nav>menu menu menu menu</nav>
  <article>
    <h1>标题</h1>
    <p>这是正文第一段,包含足够多的文字内容以便被选中为正文主体。</p>
    <p>这是正文第二段,继续提供更多有意义的句子来支撑正文提取逻辑的判断。</p>
  </article>
  <footer>footer links</footer>
</body></html>`;

describe('extractMainText', () => {
  it('drops scripts/styles/nav and keeps the article body', () => {
    const text = extractMainText(html);
    expect(text).toContain('这是正文第一段');
    expect(text).toContain('这是正文第二段');
    expect(text).not.toContain('var x=1');
    expect(text).not.toContain('menu menu');
  });
});

describe('isHttpUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isHttpUrl('https://example.com/page')).toBe(true);
    expect(isHttpUrl('http://localhost:8080/x')).toBe(true);
  });

  it('rejects non-http(s) schemes and malformed input', () => {
    expect(isHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('data:text/html,x')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
  });
});
