/*
  智价宝 - 静态资源与结构冒烟测试
  覆盖：资源引用与版本一致性、镜像页同步、SEO/无障碍/合规文件、脚本加载顺序。
  运行：node tests/smoke.mjs
*/
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
/* 以副作用方式加载共享字典，用于校验页面文案与常量一致 */
import "../site-data.js";

const ROOT = resolve(import.meta.dirname, "..");
const D = globalThis.ZhijiabaoData;
const read = (file) => readFileSync(join(ROOT, file), "utf8");
const script = read("script.js");
const styles = read("styles.css");

/* 每个页面：外壳文件、子目录副本、favicon 相对路径 */
const PAGES = [
  { outer: "index.html", nested: null, icon: "assets/img/favicon.svg" },
  { outer: "estimate.html", icon: "assets/img/favicon.svg" },
  { outer: "compare.html", icon: "assets/img/favicon.svg" },
  { outer: "market.html", icon: "assets/img/favicon.svg" },
  { outer: "profile.html", icon: "assets/img/favicon.svg" },
  { outer: "orders.html", icon: "assets/img/favicon.svg" },
  { outer: "messages.html", icon: "assets/img/favicon.svg" },
  { outer: "admin.html", icon: "assets/img/favicon.svg" },
  { outer: "legal.html", icon: "assets/img/favicon.svg" }
];

const htmlEntries = [
  ...PAGES.map((p) => p.outer),
  ...PAGES.filter((p) => p.outer !== "index.html").map((p) => `${p.outer.replace(/\.html$/, "")}/index.html`)
];

/* 共享资源：每个页面都必须引用，且版本号全站一致 */
const sharedAssets = [
  "styles.css",
  "styles-app.css",
  "site-data.js",
  "pricing.js",
  "api-services.js",
  "store.js",
  "script.js",
  "app-core.js",
  "app-account.js"
];

/* 脚本加载顺序：字典 → 计算 → 接口 → 数据层 → UI → 业务层 */
const scriptOrder = ["site-data.js", "pricing.js", "api-services.js", "store.js", "script.js", "app-core.js", "app-account.js"];

assert.ok(existsSync(join(ROOT, "assets/img/favicon.svg")), "站点应包含 SVG favicon");

/* --- 每个页面：favicon、SEO、无障碍、合规引用 --- */
for (const page of PAGES) {
  const html = read(page.outer);
  assert.match(
    html,
    new RegExp(`<link\\s+rel="icon"\\s+href="${page.icon.replaceAll("/", "\\/")}"\\s+type="image\\/svg\\+xml">`),
    `${page.outer} 应引用共享 SVG favicon`
  );
  assert.match(html, /<meta name="description" content="[^"]{20,}"/, `${page.outer} 缺少有效的 meta description`);
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/, `${page.outer} 应引用 PWA manifest`);
  assert.match(html, /<a class="skip-link" href="#main">/, `${page.outer} 应提供跳转到主内容的无障碍链接`);
  assert.match(html, /<main id="main">/, `${page.outer} 主内容应有 id="main"`);
  assert.match(html, /<div class="auth-slot" id="authSlot">/, `${page.outer} 页头应包含账号区`);
  assert.match(html, /<div class="mode-badge" id="modeBadge"/, `${page.outer} 页脚应展示运行模式提示`);
}

/* --- 资源引用与版本一致性 --- */
const versionByAsset = new Map(sharedAssets.map((asset) => [asset, new Map()]));
for (const pagePath of htmlEntries) {
  const html = read(pagePath);
  for (const asset of sharedAssets) {
    const escaped = asset.replaceAll(".", "\\.");
    const match = html.match(new RegExp(`["'/]${escaped}\\?v=([0-9a-z]+)`));
    assert.ok(match, `${pagePath} 应以带版本号的方式引用 ${asset}（?v=...）`);
    versionByAsset.get(asset).set(pagePath, match[1]);
  }
}
for (const asset of sharedAssets) {
  const entries = [...versionByAsset.get(asset).entries()];
  const distinct = [...new Set(entries.map(([, version]) => version))];
  assert.equal(
    distinct.length,
    1,
    `${asset} 出现了 ${distinct.length} 个版本号，全站必须一致：${entries.map(([page, v]) => `${page}=${v}`).join(", ")}`
  );
}

/* --- 脚本加载顺序 --- */
for (const pagePath of ["index.html", "market.html", "orders.html", "admin.html"]) {
  const html = read(pagePath);
  const positions = scriptOrder.map((name) => html.indexOf(`src="${name}?v=`));
  positions.forEach((pos, i) => assert.ok(pos >= 0, `${pagePath} 缺少脚本 ${scriptOrder[i]}`));
  const sorted = [...positions].sort((a, b) => a - b);
  assert.deepEqual(positions, sorted, `${pagePath} 的脚本加载顺序不正确（字典 → 计算 → 接口 → 数据层 → UI → 业务层）`);
}

/* --- 外壳页面与子目录页面必须完全同步（副本由 tools/sync-mirrors.mjs 生成） --- */
function normalizeMirror(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replaceAll('href="./"', 'href=""')
    .replaceAll('"../', '"')
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

for (const page of PAGES.filter((p) => p.outer !== "index.html")) {
  const nested = `${page.outer.replace(/\.html$/, "")}/index.html`;
  assert.ok(existsSync(join(ROOT, nested)), `${nested} 不存在，请执行 npm run mirror`);
  assert.deepEqual(
    normalizeMirror(read(nested)),
    normalizeMirror(read(page.outer)),
    `${nested} 与 ${page.outer} 内容不一致，请重新执行 npm run mirror`
  );
}

/* --- 结构性文件 --- */
for (const file of ["404.html", "manifest.webmanifest", "sw.js", "robots.txt", "sitemap.xml", "README.md", "LICENSE"]) {
  assert.ok(existsSync(join(ROOT, file)), `缺少文件 ${file}`);
}
assert.match(read("404.html"), /id="homeLink"/, "404 页面应提供返回首页入口");
assert.match(read("sitemap.xml"), /<urlset/, "sitemap.xml 格式不正确");
assert.match(read("robots.txt"), /Sitemap:/, "robots.txt 应声明 sitemap");
assert.match(read("sw.js"), /addEventListener\("fetch"/, "Service Worker 应处理 fetch 事件");

/* --- 合规与数据来源声明 --- */
const legal = read("legal.html");
for (const keyword of ["脱敏", "Open-Meteo", "担保交易", "人工智能工具", "免责声明"]) {
  assert.ok(legal.includes(keyword), `用户协议与隐私说明应包含「${keyword}」相关内容`);
}

/* --- 代码约定：图片路径统一走 assetPath --- */
assert.match(script, /function\s+assetPath\s*\(/, "script.js 应提供 assetPath() 以适配子目录页面");
assert.doesNotMatch(script, /<img\s+src="assets\//, "script.js 中的图片路径不应硬编码相对路径");
assert.match(read("app-core.js"), /root\.assetPath\(/, "业务层渲染图片应经过 assetPath()");

/* --- 估价页必须覆盖 8 个景区（历史缺陷：只列了 5 个） --- */
const appCore = read("app-core.js");
const appAccount = read("app-account.js");
assert.match(appCore, /D\.SCENICS\.map/, "景区下拉应由 D.SCENICS 动态生成，禁止再硬编码 5 个景区");
assert.doesNotMatch(appAccount, /<option>故宫博物院<\/option>/, "集市发布表单不应硬编码景区选项");

/* --- 数据层：必须是 MySQL 实现，且 SQL 脚本与配置示例齐备 --- */
for (const file of ["server/db.mjs", "server/server.mjs"]) {
  assert.doesNotMatch(read(file), /node:sqlite/, `${file} 不应再依赖 SQLite`);
}
assert.match(read("server/db.mjs"), /mysql2\/promise/, "server/db.mjs 应通过 mysql2 连接 MySQL");
assert.ok(existsSync(join(ROOT, "server", "sql", "schema.sql")), "缺少 MySQL 建表脚本 server/sql/schema.sql");
assert.ok(existsSync(join(ROOT, "server", "sql", "seed.sql")), "缺少 MySQL 初始数据脚本 server/sql/seed.sql");
assert.ok(existsSync(join(ROOT, ".env.example")), "缺少环境配置示例 .env.example");
assert.match(read(".env.example"), /MYSQL_HOST/, ".env.example 应说明 MySQL 连接配置");
assert.match(read("package.json"), /"db:init"/, "package.json 应提供 db:init 脚本");

/* --- 图片资源：引用必须存在，且单张体积受控（历史缺陷：首屏 4MB 图片） --- */
const referencedImages = new Set();
for (const content of [read("site-data.js"), styles, read("app-core.js")]) {
  for (const match of content.matchAll(/assets\/img\/[A-Za-z0-9._-]+/g)) referencedImages.add(match[0]);
}
for (const image of referencedImages) {
  assert.ok(existsSync(join(ROOT, image)), `引用的图片不存在：${image}（请检查是否遗漏转换或路径写错）`);
}
function walkImages(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkImages(full));
    else out.push(full);
  }
  return out;
}
for (const file of walkImages(join(ROOT, "assets", "img"))) {
  const kb = statSync(file).size / 1024;
  assert.ok(kb <= 200, `${file.replace(ROOT, "")} 体积 ${Math.round(kb)}KB 超过 200KB 上限，请执行 npm run optimize:images`);
}

/* --- 上传口径：页面文案与各处校验必须来自共享常量 ---
   历史缺陷：页面写「单张不超过 12MB」、服务端实际拒绝超过 3MB，
   用户按提示选图仍会失败；且 12MB/3MB/6 张在四五个文件里各写一份。 */
const uploadHintText = read("estimate.html").match(/id="uploadMeta">([^<]*)<\/p>/)?.[1];
assert.ok(uploadHintText, "estimate.html 应保留 #uploadMeta 上传提示");
assert.equal(uploadHintText, D.uploadHint(), "上传提示文案应与 site-data.js 的 uploadHint() 保持一致");
assert.match(read("app-core.js"), /D\.UPLOAD\.maxOriginalBytes/, "原图上限应取自共享常量 UPLOAD.maxOriginalBytes");
assert.match(read("store.js"), /D\.UPLOAD\.maxUploadBytes/, "离线模式上传上限应取自共享常量 UPLOAD.maxUploadBytes");
assert.match(read("server/server.mjs"), /SD\.UPLOAD\.maxUploadBytes/, "服务端上传上限应取自共享常量 UPLOAD.maxUploadBytes");
assert.doesNotMatch(read("app-core.js"), /12 \* 1024 \* 1024/, "前端不应再硬编码 12MB 原图上限");
assert.doesNotMatch(read("server/server.mjs"), /3 \* 1024 \* 1024/, "服务端不应再硬编码 3MB 上传上限");

/* --- 境外依赖：小程序的 request 合法域名必须已备案，境外域名配不进去 ---
   天气改走自有后端代理，地名查询与二维码两个从未接线的服务已删除，
   这里守住不让它们悄悄回来。 */
const apiServices = read("api-services.js");
assert.doesNotMatch(apiServices, /api\.qrserver\.com/, "不应再依赖境外二维码服务");
assert.doesNotMatch(apiServices, /geocoding-api\.open-meteo\.com/, "不应再依赖境外地名查询");
assert.ok(!/GeocodingService|QRCodeService/.test(apiServices), "死服务不应复活");
assert.match(read("server/server.mjs"), /"\/api\/weather"/, "服务端应提供天气代理接口，避免前端直连境外域名");

/* --- 移动端样式约定（沿用既有规则） --- */
assert.match(
  script,
  /matchMedia\?\.\("\(max-width:\s*720px\)"\)\.matches/,
  "移动端首页标题应保持纯文本，不执行逐字动画"
);
assert.match(styles, /@media\s*\(max-width:\s*720px\)[\s\S]*\.hero-title\s*\{[\s\S]*overflow:\s*visible/, "720px 断点下标题不应被裁切");
assert.match(read("styles-app.css"), /prefers-reduced-motion/, "样式应支持减弱动效偏好");

console.log("静态冒烟检查通过");
