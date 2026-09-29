/*
  智价宝 - 页面 DOM 冒烟测试
  用 jsdom 真实执行每个页面的脚本（离线演示模式），验证：
    1. 页面能无异常完成初始化；
    2. 关键区域渲染出内容（商品卡、景区文化墙、筛选器、后台看板等）；
    3. 本地数据层能跑通「登录 → 下单 → 付款 → 发货 → 确认收货 → 评价」闭环。
  运行：node tests/dom.mjs
*/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";

/* jsdom 的 requestAnimationFrame 会让进程常驻，统一登记后在结束时关闭 */
const OPEN_DOMS = [];
process.on("exit", () => {
  for (const dom of OPEN_DOMS) {
    try { dom.window.close(); } catch { /* ignore */ }
  }
});

const ROOT = resolve(import.meta.dirname, "..");
const SCRIPTS = ["site-data.js", "pricing.js", "api-services.js", "store.js", "script.js", "app-core.js", "app-account.js"];
const SCRIPT_SOURCE = SCRIPTS.map((f) => ({ name: f, code: readFileSync(join(ROOT, f), "utf8") }));
const API_SERVICES = readFileSync(join(ROOT, "api-services.js"), "utf8");

let passed = 0;
async function check(label, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${label}`);
  } catch (error) {
    console.error(`  ✗ ${label}\n    ${error.message}`);
    if ("actual" in error) {
      console.error(`    实际值: ${JSON.stringify(error.actual)} | 期望值: ${JSON.stringify(error.expected)}`);
    }
    throw error;
  }
}

/* Canvas / 观察器等 jsdom 缺失能力的桩实现，保证图表与动效代码可以执行 */
function installStubs(window) {
  const gradient = { addColorStop() {} };
  const ctx = new Proxy({}, {
    get(target, prop) {
      if (prop === "measureText") return () => ({ width: 40 });
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => gradient;
      if (prop === "getImageData") return () => ({ data: new Uint8ClampedArray(4) });
      if (prop in target) return target[prop];
      return () => undefined;
    },
    set(target, prop, value) { target[prop] = value; return true; }
  });
  window.HTMLCanvasElement.prototype.getContext = () => ctx;
  window.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,AAAA";
  window.Element.prototype.scrollIntoView = () => {};
  window.Element.prototype.setPointerCapture = () => {};
  window.Element.prototype.releasePointerCapture = () => {};
  window.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; }
    observe(el) { this.cb([{ isIntersecting: true, target: el }], this); }
    unobserve() {}
    disconnect() {}
  };
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.requestIdleCallback = (cb) => window.setTimeout(cb, 0);
  window.scrollTo = () => {};
}

async function loadPage(file) {
  const html = readFileSync(join(ROOT, file), "utf8");
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => errors.push(e.message));
  const EXPECTED_OFFLINE = ["未检测到后端服务", "[Weather] 获取失败", "[Geocoding]", "[APICache]"];
  virtualConsole.on("error", (...args) => {
    const message = args.join(" ");
    /* 离线模式下数据层与天气接口会打印预期内的降级日志，不计入异常 */
    if (EXPECTED_OFFLINE.some((hint) => message.includes(hint))) return;
    errors.push(message);
  });
  const dom = new JSDOM(html, {
    url: `http://localhost/${file}`,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole
  });
  const { window } = dom;
  OPEN_DOMS.push(dom);
  installStubs(window);
  /* 离线模式：把 fetch 设为拒绝，模拟未启动后端的静态托管环境 */
  window.fetch = () => Promise.reject(new Error("offline"));
  window.localStorage.clear();
  window.__collectedErrors = errors;
  window.addEventListener("error", (event) => errors.push(event.message));
  window.addEventListener("unhandledrejection", (event) => errors.push(String(event.reason)));

  /* 以真实 <script> 方式注入，保证顶层 const/function 落在全局作用域（与浏览器一致） */
  const inject = (code, label) => {
    const node = window.document.createElement("script");
    node.setAttribute("data-test-script", label);
    node.textContent = code;
    window.document.head.appendChild(node);
  };
  inject(API_SERVICES, "api-services.js");
  for (const { name, code } of SCRIPT_SOURCE) {
    if (name === "api-services.js") continue;
    inject(code, name);
  }

  window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
  await new Promise((r) => setTimeout(r, 30));
  return { dom, window, errors };
}

const $ = (win, sel) => win.document.querySelector(sel);
const $$ = (win, sel) => [...win.document.querySelectorAll(sel)];

console.log("\n页面 DOM 冒烟测试（离线演示模式）");

try {
  /* ---------- 首页 ---------- */
  await check("首页：数据看板、品类、热门商品、担保流程、景区文化墙全部渲染", async () => {
    const { window, errors } = await loadPage("index.html");
    assert.equal(errors.length, 0, `存在脚本异常：${errors.join(" | ")}`);
    assert.equal($$(window, "#scenicWall .scenic-card").length, 8, "应渲染 8 个景区文化卡");
    assert.equal($$(window, "#categoryNav a").length, 10, "应渲染 10 个品类导航");
    assert.equal($$(window, "#escrowFlow .flow-step").length, 4, "应渲染 4 步担保交易流程");
    assert.equal($$(window, "#hotProducts .product-card").length, 6, "首页应渲染 6 个热门商品");
    assert.match($(window, "#modeBadge").textContent, /本地演示模式/);
    assert.ok(Number($(window, "#statProducts").dataset.value) >= 8, "在售商品统计应大于等于 8");
    assert.ok($(window, "#headerLogin"), "未登录时应显示登录按钮");
    assert.match($(window, "#hotProducts .product-card .price-row strong").textContent, /¥/);
  });

  /* ---------- 估价页 ---------- */
  await check("估价页：8 景区 / 10 品类 / 4 品相可选项与估价记录区就绪", async () => {
    const { window, errors } = await loadPage("estimate.html");
    assert.equal(errors.length, 0, `存在脚本异常：${errors.join(" | ")}`);
    assert.equal($$(window, "#scenicSelect option").length, 8, "景区下拉必须覆盖 8 个景区");
    assert.equal($$(window, "#categorySelect option").length, 10);
    assert.equal($$(window, "#conditionGroup .condition-option").length, 4);
    assert.ok($(window, "#estimateHistory").textContent.trim().length > 0, "估价记录区应有内容或引导文案");
  });

  await check("估价页：附加属性开关可切换，结构化输入可被读取", async () => {
    const { window } = await loadPage("estimate.html");
    const flag = $(window, '[data-flag="limited"]');
    flag.click();
    assert.ok(flag.classList.contains("active"), "点击后应处于选中态");
    $(window, "#productNote").value = "绝版停售，未拆封";
    const input = window.App.collectEstimateInput();
    assert.equal(input.limited, true);
    assert.equal(input.scenic.length > 0, true);
    const valuation = window.ZhijiabaoPricing.aiValuation(input.original, input.condition, input.scenic, input, null);
    assert.ok(valuation.result >= 18);
    assert.equal(valuation.breakdown.length, 7, "应给出 7 项可复核系数");
  });

  /* ---------- 比价页 ---------- */
  await check("比价页：商品卡带三价对照与同款检索入口", async () => {
    const { window, errors } = await loadPage("compare.html");
    assert.equal(errors.length, 0, `存在脚本异常：${errors.join(" | ")}`);
    assert.ok($$(window, "#compareList .product-card").length > 0, "应渲染商品卡");
    assert.ok($$(window, "#compareList .compare-source").length > 0, "应渲染三价对照区块");
    const rows = $$(window, "#compareList .source-row");
    assert.ok(rows.length >= 3, "官方价 / 二手成交参考价 / 建议价三行应齐全");
    assert.ok($$(window, "#compareList [data-open]").length > 0, "应提供同款检索跳转");
    assert.equal($$(window, "#compareScenic option").length, 9, "景区筛选应为“全部 + 8 个景区”");
  });

  /* ---------- 集市页 ---------- */
  await check("集市页：商品列表、筛选器、实时天气区与登录引导", async () => {
    const { window, errors } = await loadPage("market.html");
    assert.equal(errors.length, 0, `存在脚本异常：${errors.join(" | ")}`);
    assert.equal($$(window, "#marketList .product-card").length, 8, "种子商品应为 8 件");
    assert.equal($$(window, "#marketCategory option").length, 11, "品类筛选应为“全部 + 10 类”");
    assert.equal($$(window, "#marketTag option").length, 9, "标签筛选应为“全部 + 8 个标签”");
    assert.match($(window, "#myProducts").textContent, /登录|闲置/);
    const strip = $(window, "#weatherStrip").textContent.trim();
    assert.ok(strip.length > 0, "天气区应有真实数据或明确的失败说明");
  });

  await check("集市页：切换分区与筛选会重新查询", async () => {
    const { window } = await loadPage("market.html");
    const merchant = $(window, '[data-segment="merchant"]');
    merchant.click();
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(merchant.classList.contains("active"));
    $(window, "#marketCategory").value = "扇子";
    $(window, "#marketCategory").dispatchEvent(new window.Event("change"));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal($$(window, "#marketList .product-card").length, 0, "扇子品类在商户尾货分区应为空并展示空状态");
    assert.match($(window, "#marketList").textContent, /暂时没有符合条件的商品|没有/);
  });

  /* ---------- 登录与账号 ---------- */
  await check("账号：本地模式可用手机号 + 密码登录，登录态写入本地库", async () => {
    const { window } = await loadPage("profile.html");
    assert.match($(window, "#profileHost").textContent, /登录后管理/);
    const user = await window.Store.login({ phone: "18800000001", password: "demo1234" });
    assert.equal(user.nickname, "澄禾");
    assert.equal(window.Store.mode, "offline");
    assert.equal(window.localStorage.getItem("zhijiabao-token").startsWith("local-"), true);
  });

  await check("个人中心：登录后展示资料、信用分与八个功能标签页", async () => {
    const { window } = await loadPage("profile.html");
    await window.Store.login({ phone: "18800000001", password: "demo1234" });
    await window.App.initProfile();
    assert.ok($(window, ".profile-head-card"), "应渲染资料卡");
    assert.match($(window, ".profile-head-card").textContent, /澄禾/);
    assert.match($(window, ".profile-head-card").textContent, /信用/);
    assert.equal($$(window, ".profile-tabs button").length, 8, "应有 8 个功能标签页");
    assert.ok($$(window, "#profilePanel .order-mini-row, #profilePanel .empty-state").length > 0, "订单面板应有内容");
    /* 切换到“资料与安全”面板 */
    $(window, '.profile-tabs button[data-tab="settings"]').click();
    await new Promise((r) => setTimeout(r, 30));
    assert.ok($(window, "#profileForm"), "资料表单应渲染");
    assert.ok($(window, "#realnameForm"), "实名认证表单应渲染");
    assert.ok($(window, "#closeAccountBtn"), "应提供注销账号入口");
  });

  await check("账号：注册需要验证码，实名认证只保存脱敏号码", async () => {
    const { window } = await loadPage("profile.html");
    const code = await window.Store.sendCode("13900009999", "register");
    assert.equal(String(code).length, 6);
    const user = await window.Store.register({ phone: "13900009999", code, nickname: "测试同学", password: "test1234" });
    assert.equal(user.nickname, "测试同学");
    const verified = await window.Store.verifyRealname({ realName: "张三", idNo: "310101199901011234" });
    assert.equal(verified.idVerified, true);
    assert.equal(verified.idNoMasked, "310***********1234");
    assert.ok(verified.credit >= 70);
  });

  /* ---------- 订单闭环 ---------- */
  await check("订单：本地模式跑通担保交易全流程与信用分更新", async () => {
    const { window, errors } = await loadPage("orders.html");
    /* 买家（湖畔旧物）购买澄禾的折扇 */
    await window.Store.login({ phone: "18800000002", password: "demo1234" });
    const products = await window.Store.api("/api/products?limit=48");
    const target = products.products.find((p) => p.id === "fan");
    const created = await window.Store.api("/api/orders", {
      method: "POST",
      body: { productId: target.id, name: "李四", phone: "13800002222", region: "上海市 浦东新区", detail: "张江路 1 号" }
    });
    const orderId = created.order.id;
    assert.equal(created.order.status, "待付款");

    await window.App.initOrders();
    assert.equal($$(window, ".order-card").length, 1, "订单页应展示 1 张订单卡");
    assert.match($(window, ".order-card").textContent, /待付款/);
    assert.match($(window, ".order-card .timeline").textContent, /订单创建/);

    /* 付款 */
    let probe = 0;
    $(window, "#orderList").addEventListener("click", () => { probe += 1; });
    const payBtn = $(window, '.order-card [data-act="pay"]');
    assert.ok(payBtn, "待付款订单应提供付款按钮");
    payBtn.click();
    await new Promise((r) => setTimeout(r, 60));
    const toast = $(window, ".publish-toast");
    assert.ok(probe > 0, "点击应冒泡到订单列表容器");
    assert.ok(!toast || toast.textContent.includes("成功"), `付款不应出现错误提示，实际提示：${toast ? toast.textContent : ""}`);
    let order = await window.Store.api(`/api/orders/${orderId}`);
    assert.equal(order.order.status, "待发货", `页面异常：${errors.join(" | ")}`);

    /* 卖家发货（切换到卖家账号，同浏览器本地库共享） */
    await window.Store.login({ phone: "18800000001", password: "demo1234" });
    const shipped = await window.Store.api(`/api/orders/${orderId}/ship`, {
      method: "POST", body: { expressCompany: "顺丰速运", trackingNo: "SF123456789" }
    });
    assert.equal(shipped.order.status, "待收货");
    assert.equal(shipped.order.trackingNo, "SF123456789");

    /* 买家确认收货，货款进入卖家余额 */
    await window.Store.login({ phone: "18800000002", password: "demo1234" });
    const before = (await window.Store.api("/api/auth/me")).user.balance;
    const done = await window.Store.api(`/api/orders/${orderId}/confirm`, { method: "POST" });
    assert.equal(done.order.status, "已完成");
    assert.equal(done.order.timeline.length, 4);

    await window.Store.login({ phone: "18800000001", password: "demo1234" });
    const after = (await window.Store.api("/api/auth/me")).user.balance;
    assert.equal(after - before, 135 + 0 - Math.round(135 * 0.02), "卖家到账应扣除 2% 服务费");

    /* 买家评价 → 信用分变化 */
    await window.Store.login({ phone: "18800000002", password: "demo1234" });
    const review = await window.Store.api(`/api/orders/${orderId}/review`, {
      method: "POST", body: { score: 5, content: "扇面完好，包装仔细。" }
    });
    assert.equal(review.ok, true);
    await window.Store.login({ phone: "18800000001", password: "demo1234" });
    const me = await window.Store.api("/api/auth/me");
    assert.ok(me.user.credit >= 86, `好评后信用分应上升，实际 ${me.user.credit}`);
  });

  await check("订单：售后申请与退款、非法状态跳转被拦截", async () => {
    const { window } = await loadPage("orders.html");
    await window.Store.login({ phone: "18800000002", password: "demo1234" });
    const products = await window.Store.api("/api/products?limit=48");
    /* 买家是“湖畔旧物”（id 3）：需选择他人发布、且有真实卖家账号的商品，才能验证售后流程 */
    const target = products.products.find((p) => p.seller.id && p.seller.id !== window.Store.user.id);
    const created = await window.Store.api("/api/orders", {
      method: "POST",
      body: { productId: target.id, name: "李四", phone: "13800002222", region: "杭州市 西湖区", detail: "文三路 1 号" }
    });
    const id = created.order.id;

    await assert.rejects(() => window.Store.api(`/api/orders/${id}/confirm`, { method: "POST" }), /不能变更/);
    await window.Store.api(`/api/orders/${id}/pay`, { method: "POST" });
    await assert.rejects(() => window.Store.api(`/api/orders/${id}/refund`, { method: "POST", body: { reason: "坏了" } }), /至少 4 个字/);
    const refund = await window.Store.api(`/api/orders/${id}/refund`, { method: "POST", body: { reason: "收到时杯身有磕碰，与描述不符" } });
    assert.equal(refund.order.status, "售后中");

    /* 卖家同意退款 */
    await window.Store.login({ phone: "18800000001", password: "demo1234" });
    const accepted = await window.Store.api(`/api/orders/${id}/refund-accept`, { method: "POST" });
    assert.equal(accepted.order.status, "已退款");
    const product = await window.Store.api(`/api/products/${target.id}`);
    assert.equal(product.product.status, "在售", "退款后商品应回到在售状态");
  });

  /* ---------- 消息与通知 ---------- */
  await check("消息中心：发送消息、敏感词拦截、未读与通知", async () => {
    const { window } = await loadPage("messages.html");
    await window.Store.login({ phone: "18800000002", password: "demo1234" });
    assert.match($(window, "#messagesHost").textContent, /登录后查看消息|会话/);

    await assert.rejects(
      () => window.Store.api("/api/messages", { method: "POST", body: { to: 2, body: "加微信转账给你便宜点" } }),
      /违规词/
    );
    await window.Store.api("/api/messages", { method: "POST", body: { to: 2, body: "请问折扇还在吗？", productId: "fan" } });

    await window.Store.login({ phone: "18800000001", password: "demo1234" });
    const convs = await window.Store.api("/api/conversations");
    assert.equal(convs.conversations.length, 1);
    assert.equal(convs.conversations[0].unread, 1);
    await window.App.initMessages();
    assert.match($(window, "#convList").textContent, /湖畔旧物/);
    assert.match($(window, "#noticeList").textContent, /消息|通知/);
  });

  /* ---------- 运营后台 ---------- */
  await check("后台：管理员可见数据看板、审核、举报、用户与日志五个标签", async () => {
    const { window, errors } = await loadPage("admin.html");
    /* 先用普通用户发布一件商品，验证“先审核后上架” */
    await window.Store.login({ phone: "18800000002", password: "demo1234" });
    const created = await window.Store.api("/api/products", {
      method: "POST",
      body: {
        name: "后台审核测试书签", scenic: "敦煌莫高窟", category: "书签", condition: "全新",
        price: 20, original: 30, freight: 5, description: "全新未拆封", images: ["/uploads/demo.png"]
      }
    });
    assert.equal(created.status, "待审核", "普通用户发布的商品应进入待审核");
    const hidden = await window.Store.api("/api/products?limit=48");
    assert.equal(hidden.products.some((p) => p.id === created.id), false, "未审核商品不应出现在集市列表");

    /* 切换到管理员 */
    await window.Store.login({ phone: "18800000000", password: "admin888" });
    await window.App.initAdmin();
    assert.equal(errors.length, 0, `存在脚本异常：${errors.join(" | ")}`);
    assert.equal($$(window, "#adminTabs button").length, 5);
    assert.ok($$(window, ".kpi-card").length >= 12, "应渲染至少 12 张 KPI 卡");
    assert.match($(window, ".kpi-grid").textContent, /在售商品|注册用户|成交订单/);

    $(window, '#adminTabs button[data-tab="audit"]').click();
    await new Promise((r) => setTimeout(r, 60));
    assert.match($(window, "#adminPanel").textContent, /后台审核测试书签/);

    await window.Store.api(`/api/admin/products/${created.id}/review`, { method: "POST", body: { approve: true } });
    const detail = await window.Store.api(`/api/products/${created.id}`);
    assert.equal(detail.product.status, "在售", "审核通过后应上架");

    /* 驳回必须填写原因 */
    const second = await window.Store.login({ phone: "18800000002", password: "demo1234" });
    void second;
    const another = await window.Store.api("/api/products", {
      method: "POST",
      body: {
        name: "待驳回测试徽章", scenic: "平遥古城", category: "纪念徽章", condition: "95新",
        price: 15, original: 25, images: ["/uploads/demo2.png"]
      }
    });
    await window.Store.login({ phone: "18800000000", password: "admin888" });
    await assert.rejects(
      () => window.Store.api(`/api/admin/products/${another.id}/review`, { method: "POST", body: { approve: false } }),
      /驳回时必须填写原因/
    );
    await window.Store.api(`/api/admin/products/${another.id}/review`, { method: "POST", body: { approve: false, reason: "图片无法确认真实性" } });
    const rejected = await window.Store.api(`/api/products/${another.id}`);
    assert.equal(rejected.product.status, "已下架");
    assert.equal(rejected.product.rejectReason, "图片无法确认真实性");
  });

  await check("后台：非管理员访问被拒绝", async () => {
    const { window } = await loadPage("admin.html");
    await window.Store.login({ phone: "18800000002", password: "demo1234" });
    await window.App.initAdmin();
    assert.match($(window, "#adminHost").textContent, /没有后台权限/);
  });

  /* ---------- 合规页 ---------- */
  await check("用户协议与隐私说明页：六个章节齐全", async () => {
    const { window, errors } = await loadPage("legal.html");
    assert.equal(errors.length, 0, `存在脚本异常：${errors.join(" | ")}`);
    assert.ok($$(window, ".legal-content .panel").length >= 6, "应包含服务性质、账号实名、隐私、内容安全、数据来源、AI 使用与免责等章节");
    assert.match($(window, ".legal-content").textContent, /仅保存脱敏后的证件号/);
    assert.match($(window, ".legal-content").textContent, /Open-Meteo/);
  });

  console.log(`\n页面 DOM 冒烟测试通过：${passed} 项\n`);
  process.exitCode = 0;
} catch (error) {
  console.error(`\n页面 DOM 冒烟测试失败：${error.message}\n`);
  process.exitCode = 1;
} finally {
  for (const dom of OPEN_DOMS) {
    try { dom.window.close(); } catch { /* ignore */ }
  }
  /* jsdom 定时器可能残留，显式退出避免测试进程挂起 */
  setTimeout(() => process.exit(process.exitCode || 0), 50);
}
