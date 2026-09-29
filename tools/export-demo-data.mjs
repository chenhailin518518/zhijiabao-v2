/*
  智价宝 - 演示数据库导出工具
  做法：在临时目录启动一次真实后端，用真实接口跑出「发布 → 审核 → 下单 → 付款 → 发货 → 确认收货 → 评价 → 售后」
  等业务数据（含通知、审计日志、埋点、信用分），然后清空会话令牌与短信验证码，产出一份可随仓库发布的演示数据库：
      server/data/demo-seed.db
  服务端启动时若发现没有运行库（zhijiabao.db）而存在该快照，会自动复制一份作为初始数据。
  运行：node tools/export-demo-data.mjs
*/
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = resolve(import.meta.dirname, "..");
const OUT_DIR = join(ROOT, "server", "data");
const OUT_DB = join(OUT_DIR, "demo-seed.db");
const PORT = 8310;
const BASE = `http://127.0.0.1:${PORT}`;
const workDir = mkdtempSync(join(tmpdir(), "zhj-export-"));

const server = spawn(process.execPath, [join(ROOT, "server", "server.mjs")], {
  env: { ...process.env, PORT: String(PORT), ZHJ_DATA_DIR: workDir },
  stdio: ["ignore", "pipe", "pipe"]
});
const serverLog = [];
server.stdout.on("data", (d) => serverLog.push(String(d)));
server.stderr.on("data", (d) => serverLog.push(String(d)));

async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(`${method} ${path} -> ${data.message || res.status}`);
  return data;
}

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch { /* 继续等待 */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`服务未能启动：${serverLog.join("").slice(-400)}`);
}

const login = async (phone, password) => (await api("/api/auth/login", { method: "POST", body: { phone, password } })).token;

try {
  await waitForServer();
  console.log("1/7 已在临时目录启动后端，开始构造演示数据…");

  const admin = await login("18800000000", "admin888");
  const seller = await login("18800000001", "demo1234");
  const buyer = await login("18800000002", "demo1234");

  /* --- 埋点：制造一周的访问数据，让运营看板有 PV/UV/转化率 --- */
  console.log("2/7 写入埋点数据（PV / UV / 事件）…");
  const events = ["page_view", "product_view", "estimate", "product_publish", "order_create"];
  for (let day = 6; day >= 0; day -= 1) {
    const visits = 6 + ((day * 5) % 9);
    for (let i = 0; i < visits; i += 1) {
      const name = events[(day + i) % events.length];
      await api("/api/events", { method: "POST", body: { name, payload: { source: "demo-seed" }, visitor: `v_demo${(day * 7 + i) % 23}` } });
    }
  }

  /* --- 商品：两位卖家各发布，管理员审核 --- */
  console.log("3/7 发布并审核商品…");
  const draft = await api("/api/products", {
    method: "POST", token: seller,
    body: {
      name: "故宫瑞兽冰箱贴（全新未拆）", scenic: "故宫博物院", category: "摆件", condition: "全新",
      tag: "限定联名", price: 68, original: 88, freight: 6,
      description: "太和殿瑞兽系列，全新未拆封，附购买小票。", images: ["assets/img/product-pin.webp"]
    }
  });
  await api(`/api/admin/products/${draft.id}/review`, { method: "POST", token: admin, body: { approve: true } });

  const rejected = await api("/api/products", {
    method: "POST", token: buyer,
    body: {
      name: "西湖丝绸手帕", scenic: "杭州西湖", category: "服饰配件", condition: "95新",
      tag: "实用文创", price: 25, original: 45, freight: 5,
      description: "丝绸手帕，使用过一次，已清洗。", images: ["assets/img/product-sachet.webp"]
    }
  });
  await api(`/api/admin/products/${rejected.id}/review`, {
    method: "POST", token: admin, body: { approve: false, reason: "图片不够清晰，请补充实物细节图" }
  });

  /* --- 订单一：全流程走完（含评价），用于展示担保交易闭环 --- */
  console.log("4/7 跑通一笔完整的担保交易（付款→发货→确认收货→评价）…");
  const orderA = (await api("/api/orders", {
    method: "POST", token: buyer,
    body: { productId: "fan", name: "李同学", phone: "13800002222", region: "上海市 浦东新区", detail: "张江路 1 号 3 楼" }
  })).order;
  await api(`/api/orders/${orderA.id}/pay`, { method: "POST", token: buyer });
  await api(`/api/orders/${orderA.id}/ship`, {
    method: "POST", token: seller, body: { expressCompany: "顺丰速运", trackingNo: "SF1024305678" }
  });
  await api(`/api/orders/${orderA.id}/confirm`, { method: "POST", token: buyer });
  await api(`/api/orders/${orderA.id}/review`, {
    method: "POST", token: buyer, body: { score: 5, content: "扇面完好，包装很仔细，卖家还送了书签。" }
  });

  /* --- 订单二：停在待发货，展示进行中的订单与后台统计 --- */
  const orderB = (await api("/api/orders", {
    method: "POST", token: seller,
    body: { productId: "cup", name: "陈老师", phone: "13900003333", region: "北京市 海淀区", detail: "中关村大街 27 号" }
  })).order;
  await api(`/api/orders/${orderB.id}/pay`, { method: "POST", token: seller });

  /* --- 订单三：待付款 + 取消，展示状态机与取消记录 --- */
  const orderC = (await api("/api/orders", {
    method: "POST", token: seller,
    body: { productId: "bookmark", name: "陈老师", phone: "13900003333", region: "北京市 海淀区", detail: "中关村大街 27 号" }
  })).order;
  await api(`/api/orders/${orderC.id}/cancel`, { method: "POST", token: seller, body: { reason: "买家改选其他款式" } });

  /* --- 售后：一笔进行中的售后申请 --- */
  const orderD = (await api("/api/orders", {
    method: "POST", token: buyer,
    body: { productId: "sachet", name: "李同学", phone: "13800002222", region: "上海市 浦东新区", detail: "张江路 1 号 3 楼" }
  })).order;
  await api(`/api/orders/${orderD.id}/pay`, { method: "POST", token: buyer });
  await api(`/api/orders/${orderD.id}/refund`, {
    method: "POST", token: buyer, body: { reason: "香囊气味较淡，与描述不符" }
  });

  /* --- 估价记录、收藏与降价提醒、足迹、搜索历史 --- */
  console.log("5/7 写入估价记录、收藏、足迹与搜索历史…");
  const estimates = [
    { scenic: "故宫博物院", original: 168, condition: "95新", note: "限定款、包装完整", result: 126, low: 111, high: 145, confidence: 92 },
    { scenic: "敦煌莫高窟", original: 69, condition: "全新", note: "带购买凭证", result: 47, low: 41, high: 54, confidence: 88 },
    { scenic: "丽江古城", original: 35, condition: "9成新", note: "明信片套装", result: 21, low: 18, high: 24, confidence: 79 }
  ];
  for (const e of estimates) {
    await api("/api/estimates", {
      method: "POST", token: buyer,
      body: {
        ...e, boughtAt: "2025-08-16", hasPackage: true, weather: { weatherFactor: 1.01 },
        breakdown: [{ label: "品相系数（95新）", value: "0.72" }, { label: "景区保值系数", value: "1.12" }]
      }
    });
  }
  for (const id of ["tea", "bell"]) {
    await api(`/api/favorites/${id}`, { method: "POST", token: buyer });
  }
  await api("/api/favorites/tea/alert", { method: "POST", token: buyer, body: { alertPrice: 99 } });
  for (const id of ["fan", "cup", "pin", "bookmark"]) {
    await api(`/api/products/${id}/view`, { method: "POST", token: buyer });
  }
  for (const kw of ["敦煌", "折扇", "非遗手作"]) {
    await api("/api/search-history", { method: "POST", token: buyer, body: { keyword: kw } });
  }

  /* --- 商品问答与站内消息 --- */
  console.log("6/7 写入问答与站内消息…");
  const ask = await fetch(`${BASE}/api/products/tea/questions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${buyer}` },
    body: JSON.stringify({ body: "茶罐里还有茶叶吗？想买来当收纳罐。" })
  });
  if (!ask.ok) console.log("  （问答写入跳过）");
  await api("/api/messages", {
    method: "POST", token: buyer,
    body: { to: 2, body: "你好，折扇还支持当面验货吗？我在北京。", productId: "fan" }
  });
  await api("/api/messages", {
    method: "POST", token: seller,
    body: { to: 3, body: "可以的，周末在故宫附近可以约时间。", productId: "fan" }
  });
  await api("/api/messages", {
    method: "POST", token: buyer, body: { to: 2, body: "好，那我先拍下，谢谢！", productId: "fan" }
  });

  /* --- 举报一条，让后台举报处理页有数据 --- */
  const report = await api("/api/reports", {
    method: "POST", token: buyer,
    body: { targetType: "product", targetId: rejected.id, targetLabel: "西湖丝绸手帕", reason: "虚假宣传", detail: "描述称95新，实物有明显污渍" }
  });

  await new Promise((r) => setTimeout(r, 400));
  server.kill();
  await new Promise((r) => setTimeout(r, 500));

  /* --- 清理敏感数据并产出快照 --- */
  console.log("7/7 清理会话与验证码，生成快照…");
  const dbFile = join(workDir, "zhijiabao.db");
  const db = new DatabaseSync(dbFile);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  const removedSessions = db.prepare("SELECT COUNT(*) AS c FROM sessions").get().c;
  const removedCodes = db.prepare("SELECT COUNT(*) AS c FROM sms_codes").get().c;
  db.exec("DELETE FROM sessions; DELETE FROM sms_codes;");

  /* 去掉「我的发布」里那条被驳回商品之外的测试残留：保留即可，它是演示内容 */
  db.exec("VACUUM;");
  const summary = {
    users: db.prepare("SELECT COUNT(*) AS c FROM users WHERE status = 'active'").get().c,
    products: db.prepare("SELECT COUNT(*) AS c FROM products").get().c,
    onSale: db.prepare("SELECT COUNT(*) AS c FROM products WHERE status = '在售'").get().c,
    orders: db.prepare("SELECT COUNT(*) AS c FROM orders").get().c,
    completed: db.prepare("SELECT COUNT(*) AS c FROM orders WHERE status = '已完成'").get().c,
    reviews: db.prepare("SELECT COUNT(*) AS c FROM reviews").get().c,
    estimates: db.prepare("SELECT COUNT(*) AS c FROM estimates").get().c,
    events: db.prepare("SELECT COUNT(*) AS c FROM events").get().c,
    gmv: db.prepare("SELECT COALESCE(SUM(price + freight), 0) AS s FROM orders WHERE status = '已完成'").get().s,
    notifications: db.prepare("SELECT COUNT(*) AS c FROM notifications").get().c,
    auditLogs: db.prepare("SELECT COUNT(*) AS c FROM audit_logs").get().c
  };
  db.close();

  mkdirSync(OUT_DIR, { recursive: true });
  copyFileSync(dbFile, OUT_DB);
  for (const suffix of ["-wal", "-shm"]) {
    const extra = `${OUT_DB}${suffix}`;
    if (existsSync(extra)) rmSync(extra, { force: true });
  }

  console.log("\n演示数据库已生成：server/data/demo-seed.db");
  console.log(`  体积: ${(statSync(OUT_DB).size / 1024).toFixed(1)}KB`);
  console.log(`  已清空的会话令牌: ${removedSessions} 条，短信验证码: ${removedCodes} 条`);
  console.log(`  用户 ${summary.users} · 商品 ${summary.products}（在售 ${summary.onSale}）`);
  console.log(`  订单 ${summary.orders}（已完成 ${summary.completed}）· GMV ¥${summary.gmv}`);
  console.log(`  评价 ${summary.reviews} · 估价记录 ${summary.estimates} · 埋点 ${summary.events}`);
  console.log(`  通知 ${summary.notifications} · 审计日志 ${summary.auditLogs} · 举报 1 条（待处理 #${report.id}）`);
  console.log(`  演示账号密码不变：admin 18800000000/admin888，用户 18800000001、18800000002 / demo1234`);
} catch (error) {
  console.error("导出失败：", error.message);
  process.exitCode = 1;
} finally {
  if (!server.killed) server.kill();
  try { rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
  setTimeout(() => process.exit(process.exitCode || 0), 200);
}
