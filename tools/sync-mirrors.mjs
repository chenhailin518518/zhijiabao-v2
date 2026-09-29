/*
  智价宝 - 镜像页生成工具
  背景：项目需要同时支持 /estimate 与 /estimate.html 两种地址，历史上靠手工维护两份 HTML，
        曾出现连续 8 次提交只改了外壳页面、导致子目录页面功能失效的事故。
  现在改为「只维护外壳页面（根目录 *.html）」，由本工具生成 <name>/index.html 副本。
  运行：npm run mirror
*/
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
/* 需要生成子目录副本的页面 */
const PAGES = ["estimate", "compare", "market", "profile", "orders", "messages", "admin", "legal"];

/* 把外壳页面里的站点相对路径统一加上 ../ 前缀 */
function toNested(html) {
  return html.replace(/(\s(?:href|src|action)=")([^"]*)(")/g, (match, head, value, tail) => {
    if (/^(?:[a-z]+:|\/\/|#|\/|data:|mailto:|tel:)/i.test(value)) return match;
    const fixed = value === "./" ? "../" : `../${value}`;
    return `${head}${fixed}${tail}`;
  });
}

let count = 0;
for (const name of PAGES) {
  const outer = join(ROOT, `${name}.html`);
  if (!existsSync(outer)) {
    console.warn(`  跳过 ${name}.html（不存在）`);
    continue;
  }
  const html = toNested(readFileSync(outer, "utf8"));
  const dir = join(ROOT, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html, "utf8");
  count += 1;
  console.log(`  ✓ ${name}.html → ${name}/index.html`);
}
console.log(`镜像页生成完成，共 ${count} 个。`);
