/*
  智价宝 - 丰富演示数据生成器（MySQL）
  在已初始化的数据库上，通过真实接口跑出更完整的演示数据：埋点、商品（含审核驳回）、
  担保交易全流程订单、售后单、取消单、估价记录、收藏与降价提醒、足迹、搜索历史、问答、站内消息与举报。
  这样运营后台的看板、订单中心、消息中心一打开就有内容。
  用法：node tools/seed-demo.mjs   （建议先执行 npm run db:reset 得到干净库）
*/
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const PORT = 8310;
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, [join(root, "server", "server.mjs")], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"]
});
const log = [];
server.stdout.on("data", (d) => log.push(String(d)));
server.stderr.on("data", (d) => log.push(String(d)));

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
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* 等待 */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`服务未能启动：${log.join("").slice(-300)}`);
}

const login = async (phone, password) =>
  (await api("/api/auth/login", { method: "POST", body: { phone, password } })).token;

try {
  await waitForServer();
  console.log("1/6 连接后端，开始生成演示数据…");
  const admin = await login("18800000000", "admin888");
  const seller = await login("18800000001", "demo1234");
  const buyer = await login("18800000002", "demo1234");

  console.log("2/6 写入近 7 天埋点（PV / UV / 事件分布）…");
  const events = ["page_view", "product_view", "estimate", "product_publish", "order_create"];
  for (let day = 6; day >= 0; day -= 1) {
    const visits = 6 + ((day * 5) % 9);
    for (let i = 0; i < visits; i += 1) {
      await api("/api/events", {
        method: "POST",
        body: { name: events[(day + i) % events.length], payload: { source: "seed-demo" }, visitor: `v_demo${(day * 7 + i) % 23}` }
      });
    }
  }

  console.log("3/6 发布商品并走审核（含一条驳回）…");
  const approved = await api("/api/products", {
    method: "POST", token: seller,
    body: {
      name: "故宫瑞兽冰箱贴（全新未拆）", scenic: "故宫博物院", category: "摆件", condition: "全新",
      tag: "限定联名", price: 68, original: 88, freight: 6,
      description: "太和殿瑞兽系列，全新未拆封，附购买小票。", images: ["assets/img/product-pin.webp"]
    }
  });
  await api(`/api/admin/products/${approved.id}/review`, { method: "POST", token: admin, body: { approve: true } });

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

  console.log("4/6 跑通担保交易（付款 → 发货 → 确认收货 → 评价）与进行中/售后/取消订单…");
  const orderA = (await api("/api/orders", {
    method: "POST", token: buyer,
    body: { productId: "fan", name: "李同学", phone: "13800002222", region: "上海市 浦东新区", detail: "张江路 1 号 3 楼" }
  })).order;
  await api(`/api/orders/${orderA.id}/pay`, { method: "POST", token: buyer });
  await api(`/api/orders/${orderA.id}/ship`, { method: "POST", token: seller, body: { expressCompany: "顺丰速运", trackingNo: "SF1024305678" } });
  await api(`/api/orders/${orderA.id}/confirm`, { method: "POST", token: buyer });
  await api(`/api/orders/${orderA.id}/review`, { method: "POST", token: buyer, body: { score: 5, content: "扇面完好，包装很仔细，卖家还送了书签。" } });

  const orderB = (await api("/api/orders", {
    method: "POST", token: seller,
    body: { productId: "cup", name: "陈老师", phone: "13900003333", region: "北京市 海淀区", detail: "中关村大街 27 号" }
  })).order;
  await api(`/api/orders/${orderB.id}/pay`, { method: "POST", token: seller });

  const orderC = (await api("/api/orders", {
    method: "POST", token: seller,
    body: { productId: "bookmark", name: "陈老师", phone: "13900003333", region: "北京市 海淀区", detail: "中关村大街 27 号" }
  })).order;
  await api(`/api/orders/${orderC.id}/cancel`, { method: "POST", token: seller, body: { reason: "买家改选其他款式" } });

  const orderD = (await api("/api/orders", {
    method: "POST", token: buyer,
    body: { productId: "sachet", name: "李同学", phone: "13800002222", region: "上海市 浦东新区", detail: "张江路 1 号 3 楼" }
  })).order;
  await api(`/api/orders/${orderD.id}/pay`, { method: "POST", token: buyer });
  await api(`/api/orders/${orderD.id}/refund`, { method: "POST", token: buyer, body: { reason: "香囊气味较淡，与描述不符" } });

  console.log("5/6 写入估价记录、收藏、降价提醒、足迹、搜索历史…");
  for (const e of [
    { scenic: "故宫博物院", original: 168, condition: "95新", note: "限定款、包装完整", result: 126, low: 111, high: 145, confidence: 92 },
    { scenic: "敦煌莫高窟", original: 69, condition: "全新", note: "带购买凭证", result: 47, low: 41, high: 54, confidence: 88 },
    { scenic: "丽江古城", original: 35, condition: "9成新", note: "明信片套装", result: 21, low: 18, high: 24, confidence: 79 }
  ]) {
    await api("/api/estimates", {
      method: "POST", token: buyer,
      body: { ...e, boughtAt: "2025-08-16", hasPackage: true, weather: { weatherFactor: 1.01 }, breakdown: [{ label: "品相系数", value: "0.72" }] }
    });
  }
  for (const id of ["tea", "bell"]) await api(`/api/favorites/${id}`, { method: "POST", token: buyer });
  await api("/api/favorites/tea/alert", { method: "POST", token: buyer, body: { alertPrice: 99 } });
  for (const id of ["fan", "cup", "pin", "bookmark", "tea"]) await api(`/api/products/${id}/view`, { method: "POST", token: buyer });
  for (const kw of ["敦煌", "折扇", "非遗手作"]) await api("/api/search-history", { method: "POST", token: buyer, body: { keyword: kw } });

  console.log("6/6 写入问答、站内消息与一条举报…");
  await api("/api/products/tea/questions", { method: "POST", token: buyer, body: { body: "茶罐里还有茶叶吗？想买来当收纳罐。" } });
  await api("/api/messages", { method: "POST", token: buyer, body: { to: 2, body: "你好，折扇还支持当面验货吗？我在北京。", productId: "fan" } });
  await api("/api/messages", { method: "POST", token: seller, body: { to: 3, body: "可以的，周末在故宫附近可以约时间。", productId: "fan" } });
  await api("/api/messages", { method: "POST", token: buyer, body: { to: 2, body: "好，那我先拍下，谢谢！", productId: "fan" } });
  await api("/api/reports", {
    method: "POST", token: buyer,
    body: { targetType: "product", targetId: rejected.id, targetLabel: "西湖丝绸手帕", reason: "虚假宣传", detail: "描述称 95 新，实物有明显污渍" }
  });

  const stats = await api("/api/admin/stats", { token: admin });
  const s = stats.stats;
  console.log("\n演示数据生成完成：");
  console.log(`  用户 ${s.users} · 商品 ${s.products}（在售 ${s.onSale}，待审核 ${s.pendingAudit}）`);
  console.log(`  订单 ${s.orders}（已完成 ${s.completedOrders}）· GMV ¥${s.gmv}`);
  console.log(`  评价 ${s.reviews} · 估价 ${s.estimates} · 埋点 ${s.pv}（UV ${s.uv}）· 待处理举报 ${s.pendingReports}`);
} catch (error) {
  console.error("\n生成失败：", error.message);
  process.exitCode = 1;
} finally {
  server.kill();
  setTimeout(() => process.exit(process.exitCode || 0), 300);
}
