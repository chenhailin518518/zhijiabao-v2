/*
  智价宝 - 接口集成测试
  启动一个使用临时数据库的后端实例，跑通「注册 → 发布 → 审核 → 下单 → 担保付款 → 发货 → 确认收货 → 评价」
  以及权限、状态机、内容安全等边界校验。
  运行：node tests/api.mjs
*/
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const PORT = 8123;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = mkdtempSync(join(tmpdir(), "zhj-api-"));
const root = resolve(import.meta.dirname, "..");

const child = spawn(process.execPath, [join(root, "server", "server.mjs")], {
  env: { ...process.env, PORT: String(PORT), ZHJ_DATA_DIR: dataDir },
  stdio: ["ignore", "pipe", "pipe"]
});
child.stdout.on("data", () => {});
child.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

let passed = 0;
function check(label, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${label}`);
    })
    .catch((error) => {
      console.error(`  ✗ ${label}\n    ${error.message}`);
      throw error;
    });
}

async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: res.status, data };
}

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch { /* 继续等待 */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("服务未能在 15 秒内启动");
}

async function login(phone, password) {
  const { data } = await api("/api/auth/login", { method: "POST", body: { phone, password } });
  assert.equal(data.ok, true, data.message);
  return data.token;
}

try {
  await waitForServer();
  console.log("\n接口集成测试");

  const admin = await login("18800000000", "admin888");
  const seller = await login("18800000001", "demo1234");
  const buyer = await login("18800000002", "demo1234");

  let newUserToken = "";
  let orderId = "";
  let productId = "";
  let reportId = 0;

  await check("演示数据库快照存在，且不含会话令牌与验证码", async () => {
    const seed = join(resolve(import.meta.dirname, ".."), "server", "data", "demo-seed.db");
    assert.ok(existsSync(seed), "应随仓库发布 server/data/demo-seed.db（可用 npm run export:demo 重新生成）");
    const seedDb = new DatabaseSync(seed);
    assert.equal(seedDb.prepare("SELECT COUNT(*) AS c FROM sessions").get().c, 0, "快照中不能包含会话令牌");
    assert.equal(seedDb.prepare("SELECT COUNT(*) AS c FROM sms_codes").get().c, 0, "快照中不能包含短信验证码");
    assert.ok(seedDb.prepare("SELECT COUNT(*) AS c FROM products").get().c >= 8, "快照应包含演示商品");
    assert.ok(seedDb.prepare("SELECT COUNT(*) AS c FROM orders").get().c >= 1, "快照应包含演示订单");
    assert.ok(seedDb.prepare("SELECT COUNT(*) AS c FROM events").get().c > 0, "快照应包含埋点数据，便于展示运营看板");
    seedDb.close();
  });

  await check("健康检查返回 8 个景区与品类字典", async () => {
    const { data } = await api("/api/health");
    assert.equal(data.scenics.length, 8);
    assert.ok(data.categories.includes("书签"));
    assert.deepEqual(data.conditions, ["全新", "95新", "9成新", "8成新"]);
  });

  await check("种子商品为 8 件且在售", async () => {
    const { data } = await api("/api/products?limit=48");
    assert.equal(data.total, 8);
    assert.equal(data.products[0].status, "在售");
    assert.ok(data.products[0].seller.name);
  });

  await check("可按景区 / 品类 / 价格区间 / 关键词组合筛选", async () => {
    const byScenic = await api("/api/products?scenic=" + encodeURIComponent("故宫博物院"));
    assert.equal(byScenic.data.total, 1);
    const byCategory = await api("/api/products?category=" + encodeURIComponent("书签"));
    assert.equal(byCategory.data.total, 1);
    const byPrice = await api("/api/products?priceMax=30");
    assert.ok(byPrice.data.products.every((p) => p.price <= 30));
    const byKeyword = await api("/api/products?keyword=" + encodeURIComponent("敦煌"));
    assert.equal(byKeyword.data.total, 1);
  });

  await check("注册需要验证码，重复注册被拒绝", async () => {
    const code = await api("/api/auth/code", { method: "POST", body: { phone: "13900001111", purpose: "register" } });
    assert.equal(code.data.devCode.length, 6);
    const dup = await api("/api/auth/register", {
      method: "POST",
      body: { phone: "13900001111", code: code.data.devCode, nickname: "测试买家", password: "test1234" }
    });
    assert.equal(dup.status, 200);
    newUserToken = dup.data.token;
    const again = await api("/api/auth/register", {
      method: "POST",
      body: { phone: "13900001111", code: "000000", nickname: "测试买家", password: "test1234" }
    });
    assert.equal(again.status, 409);
  });

  await check("未登录不能发布商品", async () => {
    const res = await api("/api/products", { method: "POST", body: { name: "测试商品" } });
    assert.equal(res.status, 401);
  });

  await check("发布商品会拦截违规词与不合理价格", async () => {
    const bad = await api("/api/products", {
      method: "POST", token: newUserToken,
      body: { name: "内部刷单专用", scenic: "故宫博物院", category: "书签", condition: "全新", price: 10, original: 20, images: ["/uploads/x.png"] }
    });
    assert.equal(bad.status, 400);
    assert.match(bad.data.message, /违规词/);

    const price = await api("/api/products", {
      method: "POST", token: newUserToken,
      body: { name: "故宫纪念书签", scenic: "故宫博物院", category: "书签", condition: "全新", price: 9999, original: 20, images: ["/uploads/x.png"] }
    });
    assert.equal(price.status, 400);
    assert.match(price.data.message, /期望价/);

    const noImage = await api("/api/products", {
      method: "POST", token: newUserToken,
      body: { name: "故宫纪念书签", scenic: "故宫博物院", category: "书签", condition: "全新", price: 18, original: 20 }
    });
    assert.equal(noImage.status, 400);
    assert.match(noImage.data.message, /实拍图/);
  });

  await check("商品发布后进入待审核，审核通过才上架", async () => {
    const created = await api("/api/products", {
      method: "POST", token: newUserToken,
      body: {
        name: "故宫纪念书签", scenic: "故宫博物院", category: "书签", condition: "全新", tag: "个人闲置",
        price: 18, original: 20, freight: 5, description: "全新未拆封，可开发票。", images: ["/uploads/demo.png", "/uploads/demo2.png"]
      }
    });
    assert.equal(created.data.status, "待审核");
    productId = created.data.id;

    const hidden = await api(`/api/products/${productId}`, { token: buyer });
    assert.equal(hidden.status, 403);

    const adminList = await api("/api/admin/products?status=" + encodeURIComponent("待审核"), { token: admin });
    assert.ok(adminList.data.products.some((p) => p.id === productId));

    const rejected = await api(`/api/admin/products/${productId}/review`, {
      method: "POST", token: admin, body: { approve: false }
    });
    assert.equal(rejected.status, 400, "驳回必须填写原因");

    const approved = await api(`/api/admin/products/${productId}/review`, {
      method: "POST", token: admin, body: { approve: true }
    });
    assert.equal(approved.data.message, "已通过审核并上架");

    const visible = await api(`/api/products/${productId}`, { token: buyer });
    assert.equal(visible.data.product.status, "在售");
    assert.deepEqual(visible.data.product.images, ["/uploads/demo.png", "/uploads/demo2.png"]);
  });

  await check("非管理员访问后台接口被拒绝", async () => {
    const res = await api("/api/admin/stats", { token: buyer });
    assert.equal(res.status, 403);
  });

  await check("不能购买自己发布的商品，也不能重复下单", async () => {
    const own = await api("/api/orders", {
      method: "POST", token: newUserToken,
      body: { productId, name: "测试买家", phone: "13900001111", region: "上海市 浦东新区", detail: "张江路 1 号" }
    });
    assert.equal(own.status, 400);
    assert.match(own.data.message, /自己/);
  });

  await check("填写不完整收货信息会被拦截", async () => {
    const res = await api("/api/orders", {
      method: "POST", token: buyer, body: { productId, name: "李四", phone: "123", region: "上海", detail: "1" }
    });
    assert.equal(res.status, 400);
  });

  await check("担保交易：下单后商品置为交易中", async () => {
    const created = await api("/api/orders", {
      method: "POST", token: buyer,
      body: { productId, name: "李四", phone: "13800002222", region: "上海市 浦东新区", detail: "张江路 1 号 3 楼" }
    });
    assert.equal(created.data.order.status, "待付款");
    orderId = created.data.order.id;
    const product = await api(`/api/products/${productId}`, { token: admin });
    assert.equal(product.data.product.status, "交易中");
  });

  await check("状态机拦住越权与非法跳转", async () => {
    const wrongActor = await api(`/api/orders/${orderId}/pay`, { method: "POST", token: seller });
    assert.equal(wrongActor.status, 403);
    const skip = await api(`/api/orders/${orderId}/confirm`, { method: "POST", token: buyer });
    assert.equal(skip.status, 400);
    assert.match(skip.data.message, /不能变更/);
  });

  await check("付款 → 发货 → 确认收货，货款进入卖家余额", async () => {
    const paid = await api(`/api/orders/${orderId}/pay`, { method: "POST", token: buyer });
    assert.equal(paid.data.order.status, "待发货");

    const badTrack = await api(`/api/orders/${orderId}/ship`, {
      method: "POST", token: newUserToken, body: { expressCompany: "顺丰速运", trackingNo: "!!" }
    });
    assert.equal(badTrack.status, 400);

    const shipped = await api(`/api/orders/${orderId}/ship`, {
      method: "POST", token: newUserToken, body: { expressCompany: "顺丰速运", trackingNo: "SF123456789" }
    });
    assert.equal(shipped.data.order.status, "待收货");

    const before = (await api("/api/auth/me", { token: newUserToken })).data.user.balance;
    const done = await api(`/api/orders/${orderId}/confirm`, { method: "POST", token: buyer });
    assert.equal(done.data.order.status, "已完成");
    assert.ok(done.data.order.timeline.length >= 4);

    const after = (await api("/api/auth/me", { token: newUserToken })).data.user.balance;
    assert.equal(after - before, 18 + 5 - Math.round(18 * 0.02), "卖家到账金额应扣除 2% 服务费");

    const product = await api(`/api/products/${productId}`, { token: admin });
    assert.equal(product.data.product.status, "已售出");
  });

  await check("订单评价：写入评价、重算信用分、禁止重复评价", async () => {
    const review = await api(`/api/orders/${orderId}/review`, {
      method: "POST", token: buyer, body: { score: 5, content: "书签做工精致，卖家发货很快。" }
    });
    assert.equal(review.status, 200);
    const again = await api(`/api/orders/${orderId}/review`, {
      method: "POST", token: buyer, body: { score: 1, content: "再评一次" }
    });
    assert.equal(again.status, 400);
    const list = await api(`/api/reviews?productId=${productId}`);
    assert.equal(list.data.reviews.length, 1);
    const sellerMe = await api("/api/auth/me", { token: newUserToken });
    assert.ok(sellerMe.data.user.credit >= 86, `收货好评后卖家信用分应提升，实际 ${sellerMe.data.user.credit}`);
  });

  await check("已售出商品不能再次下单", async () => {
    const second = await api("/api/orders", {
      method: "POST", token: buyer, body: { productId, name: "李四", phone: "13800002222", region: "上海市", detail: "张江路 1 号" }
    });
    assert.equal(second.status, 400);
  });

  await check("售后流程：发起售后 → 卖家同意退款 → 商品回到在售", async () => {
    const product = (await api("/api/products?limit=1", { token: buyer })).data.products[0];
    const created = await api("/api/orders", {
      method: "POST", token: buyer,
      body: { productId: product.id, name: "李四", phone: "13800002222", region: "上海市 徐汇区", detail: "漕溪北路 1 号" }
    });
    assert.equal(created.status, 200);
    const id = created.data.order.id;
    await api(`/api/orders/${id}/pay`, { method: "POST", token: buyer });
    const noReason = await api(`/api/orders/${id}/refund`, { method: "POST", token: buyer, body: { reason: "坏了" } });
    assert.equal(noReason.status, 400);
    const refund = await api(`/api/orders/${id}/refund`, {
      method: "POST", token: buyer, body: { reason: "商品与描述不符，收到时有磕碰" }
    });
    assert.equal(refund.data.order.status, "售后中");
    const accepted = await api(`/api/orders/${id}/refund-accept`, { method: "POST", token: seller });
    assert.equal(accepted.data.order.status, "已退款");
    const after = await api(`/api/products/${product.id}`, { token: admin });
    assert.equal(after.data.product.status, "在售");
  });

  await check("收藏、降价提醒、足迹、搜索历史均落库", async () => {
    const fav = await api(`/api/favorites/${productId}`, { method: "POST", token: buyer });
    assert.equal(fav.data.favorited, true);
    const alert = await api(`/api/favorites/${productId}/alert`, { method: "POST", token: buyer, body: { alertPrice: 5 } });
    assert.equal(alert.status, 200);
    const tooHigh = await api(`/api/favorites/${productId}/alert`, { method: "POST", token: buyer, body: { alertPrice: 99999 } });
    assert.equal(tooHigh.status, 400);
    await api(`/api/products/${productId}/view`, { method: "POST", token: buyer });
    const foot = await api("/api/footprints", { token: buyer });
    assert.ok(foot.data.footprints.some((f) => f.id === productId));
    await api("/api/search-history", { method: "POST", token: buyer, body: { keyword: "敦煌" } });
    const hist = await api("/api/search-history", { token: buyer });
    assert.deepEqual(hist.data.history, ["敦煌"]);
    const list = await api("/api/favorites", { token: buyer });
    assert.equal(list.data.favorites[0].priceAlert, true);
  });

  await check("价格走势接口明确标注为演示数据", async () => {
    const { data } = await api(`/api/products/${productId}/price-history`);
    assert.equal(data.history.simulated, true);
    assert.equal(data.history.series.length, 30);
    assert.equal(data.history.series.at(-1).price, data.current);
  });

  await check("提问与卖家回答打通通知", async () => {
    const ask = await api(`/api/products/${productId}/questions`, {
      method: "POST", token: buyer, body: { body: "书签是金属材质吗？" }
    });
    assert.equal(ask.status, 200);
    const detail = await api(`/api/products/${productId}`, { token: admin });
    const q = detail.data.product.questions[0];
    assert.equal(q.body, "书签是金属材质吗？");
    const answer = await api(`/api/questions/${q.id}/answer`, {
      method: "POST", token: newUserToken, body: { answer: "是的，黄铜镀色，长度 12cm。" }
    });
    assert.equal(answer.status, 200);
    const buyerNotice = await api("/api/notifications", { token: buyer });
    assert.ok(buyerNotice.data.notifications.some((n) => n.type === "question"));
  });

  await check("站内消息禁止站外交易话术", async () => {
    const bad = await api("/api/messages", {
      method: "POST", token: buyer, body: { to: 2, body: "加微信转账给你便宜点" }
    });
    assert.equal(bad.status, 400);
    const okMsg = await api("/api/messages", {
      method: "POST", token: buyer, body: { to: 2, body: "请问这件还在吗？", productId }
    });
    assert.equal(okMsg.status, 200);
    const convs = await api("/api/conversations", { token: seller });
    assert.equal(convs.data.conversations[0].unread, 1);
    const msgs = await api("/api/messages?peer=3", { token: seller });
    assert.equal(msgs.data.messages.length, 1);
    const convs2 = await api("/api/conversations", { token: seller });
    assert.equal(convs2.data.conversations[0].unread, 0);
  });

  await check("举报 → 后台处理 → 商品下架并通知", async () => {
    const created = await api("/api/reports", {
      method: "POST", token: buyer,
      body: { targetType: "product", targetId: productId, targetLabel: "故宫纪念书签", reason: "虚假宣传", detail: "描述与实物不符" }
    });
    assert.equal(created.status, 200);
    reportId = created.data.id;
    const list = await api("/api/admin/reports", { token: admin });
    assert.ok(list.data.reports.some((r) => r.id === reportId));
    const handled = await api(`/api/admin/reports/${reportId}`, {
      method: "POST", token: admin, body: { accept: true, note: "核实违规，已下架" }
    });
    assert.equal(handled.status, 200);
    const product = await api(`/api/products/${productId}`, { token: admin });
    assert.equal(product.data.product.status, "已下架");
  });

  await check("图片上传校验格式与体积", async () => {
    const bad = await api("/api/uploads", { method: "POST", token: buyer, body: { dataUrl: "data:text/plain;base64,aGk=" } });
    assert.equal(bad.status, 400);
    const png = "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    const good = await api("/api/uploads", { method: "POST", token: buyer, body: { dataUrl: png } });
    assert.equal(good.status, 200);
    assert.match(good.data.url, /^\/uploads\/img-/);
  });

  await check("埋点与运营看板统计", async () => {
    const ev = await api("/api/events", { method: "POST", body: { name: "page_view", payload: { path: "/" } } });
    assert.match(ev.data.visitor, /^v_/);
    const stats = await api("/api/admin/stats", { token: admin });
    assert.ok(stats.data.stats.users >= 4);
    assert.equal(stats.data.stats.completedOrders >= 1, true);
    assert.ok(stats.data.stats.gmv >= 23);
    assert.ok(stats.data.stats.scenicRank.length >= 1);
    assert.ok(stats.data.stats.dailyPv.length >= 1);
  });

  await check("账号资料、实名、提现、注销全链路", async () => {
    const profile = await api("/api/me", { method: "PATCH", token: newUserToken, body: { nickname: "测试买家", bio: "喜欢收集书签", city: "上海" } });
    assert.equal(profile.data.user.nickname, "测试买家");
    const real = await api("/api/me/realname", {
      method: "POST", token: newUserToken, body: { realName: "李四", idNo: "310101199001011234" }
    });
    assert.equal(real.data.user.idVerified, true);
    assert.equal(real.data.user.idNoMasked, "310***********1234");
    const tooMuch = await api("/api/me/withdraw", { method: "POST", token: newUserToken, body: { amount: 99999 } });
    assert.equal(tooMuch.status, 400, "超出余额不能提现");
    const withdraw = await api("/api/me/withdraw", { method: "POST", token: newUserToken, body: { amount: 1 } });
    assert.equal(withdraw.status, 200, "有货款入账后可以提现");
    const closed = await api("/api/me", { method: "DELETE", token: newUserToken });
    assert.equal(closed.status, 200);
    const me = await api("/api/auth/me", { token: newUserToken });
    assert.equal(me.data.user, null, "注销后会话应失效");
  });

  await check("地址簿：最多 10 条并支持默认地址", async () => {
    for (let i = 0; i < 10; i += 1) {
      const res = await api("/api/addresses", {
        method: "POST", token: buyer,
        body: { name: `收件人${i}`, phone: "13800002222", region: "上海市 浦东新区", detail: `张江路 ${i} 号` }
      });
      assert.equal(res.status, 200);
    }
    const overflow = await api("/api/addresses", {
      method: "POST", token: buyer,
      body: { name: "溢出", phone: "13800002222", region: "上海市", detail: "张江路 99 号" }
    });
    assert.equal(overflow.status, 400);
    const list = await api("/api/addresses", { token: buyer });
    assert.equal(list.data.addresses.length, 10);
    assert.equal(list.data.addresses[0].is_default, 1);
  });

  console.log(`\n接口集成测试通过：${passed} 项\n`);
} catch (error) {
  console.error(`\n接口集成测试失败：${error.message}\n`);
  process.exitCode = 1;
} finally {
  child.kill();
  await new Promise((r) => setTimeout(r, 300));
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
}
