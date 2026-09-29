import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { writeFile, stat, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, join, normalize, extname } from "node:path";
import {
  creditLevel, findSensitive, now, inDays, inMinutes, toMysqlTime, hashPassword,
  audit, notify, verifyPassword, maskIdNo, recalcCredit, uid,
  one, many, run, transaction, initDatabase, tableStats, MYSQL_CONFIG
} from "./db.mjs";
/*
  字典与业务规则只有一份实现：直接复用前端同一套纯模块（无 DOM 依赖，Node 可直接加载）。
  过去服务端各自维护 SCENICS / CATEGORIES / ORDER_FLOW / priceHistory 副本，
  改动共享字典后服务端不会同步（例如新增品类会被服务端拒绝），故统一到此处引用。
*/
import "../site-data.js";
import "../pricing.js";
const SD = globalThis.ZhijiabaoData;
const P = globalThis.ZhijiabaoPricing;

const ROOT = resolve(import.meta.dirname, "..");
/* 上传文件落盘目录（与数据库无关，默认 server/uploads，可用 UPLOAD_DIR 覆盖） */
const UPLOAD_DIR = process.env.UPLOAD_DIR || resolve(ROOT, "server", "uploads");
mkdirSync(UPLOAD_DIR, { recursive: true });
const PORT = Number(process.env.PORT || 8080);
const SESSION_DAYS = 7;
const BODY_LIMIT = 12 * 1024 * 1024;
/* =========================
   通用工具
   ========================= */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json"
};
function json(res, status, payload) {
  if (res.writableEnded) return true;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(body);
  /* 返回 true 便于调用方用 `if (denied) return denied;` 中断后续逻辑 */
  return true;
}
const ok = (res, data = {}) => json(res, 200, { ok: true, ...data });
const fail = (res, status, message, extra = {}) => json(res, status, { ok: false, message, ...extra });

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new Error("请求体过大");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("请求体不是合法 JSON");
  }
}
/* 简易限流：按 用户/IP + 桶 计数 */
const buckets = new Map();
function rateLimit(key, limit, windowMs) {
  const stamp = Date.now();
  const entry = buckets.get(key);
  if (!entry || stamp > entry.resetAt) {
    buckets.set(key, { count: 1, resetAt: stamp + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count += 1;
  return true;
}
function clientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "local";
}
/* =========================
   登录态
   ========================= */
async function currentUser(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const session = await one("SELECT * FROM sessions WHERE token = ?", token);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await run("DELETE FROM sessions WHERE token = ?", token);
    return null;
  }
  const user = await one("SELECT * FROM users WHERE id = ?", session.user_id);
  if (!user || user.status !== "active") return null;
  return user;
}
async function createSession(userId) {
  const token = randomBytes(24).toString("hex");
  const created = new Date();
  const expires = new Date(created.getTime() + SESSION_DAYS * 86400000);
  await run(
    "INSERT INTO `sessions` (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    [token, userId, toMysqlTime(created), toMysqlTime(expires)]
  );
  return token;
}
function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    phone: user.phone,
    nickname: user.nickname,
    avatar: user.avatar,
    bio: user.bio,
    city: user.city,
    credit: user.credit,
    creditLevel: creditLevel(user.credit),
    balance: user.balance,
    isAdmin: !!user.is_admin,
    realName: user.real_name,
    idNoMasked: user.id_no_masked,
    idVerified: !!user.id_verified,
    createdAt: user.created_at
  };
}
/* =========================
   业务校验
   ========================= */
/* 以下均来自共享字典，服务端不再保留副本 */
const SCENICS = SD.SCENICS.map((s) => s.id);
const CATEGORIES = SD.CATEGORIES;
const CONDITIONS = SD.CONDITIONS.map((c) => c.value);
const PRODUCT_STATUS = ["待审核", "在售", "交易中", "已售出", "已下架"];
const ORDER_FLOW = P.ORDER_FLOW;
/* 发布校验只有一份实现：复用前端同一模块（规则见 pricing.js），避免前后端漂移 */
const validateProduct = P.validateProduct;
/* =========================
   价格走势：直接复用共享纯模块，响应中仍明确标注 simulated
   ========================= */
const priceHistory = P.priceHistory;
async function productView(row, { withDetail = false, viewer = null } = {}) {
  if (!row) return null;
  const owner = row.owner_id ? await one("SELECT id, nickname, credit, avatar, city FROM users WHERE id = ?", row.owner_id) : null;
  const reviewAgg = await one("SELECT COUNT(*) AS c, AVG(score) AS avg FROM reviews WHERE product_id = ?", row.id);
  const favCount = (await one("SELECT COUNT(*) AS c FROM favorites WHERE product_id = ?", row.id)).c;
  const data = {
    id: row.id,
    name: row.name,
    scenic: row.scenic,
    category: row.category,
    condition: row.condition,
    tag: row.tag,
    price: row.price,
    original: row.original,
    freight: row.freight,
    description: row.description,
    images: JSON.parse(row.images || "[]"),
    heat: row.heat,
    retention: row.retention,
    views: row.views,
    status: row.status,
    rejectReason: row.reject_reason,
    seller: owner ? { id: owner.id, name: owner.nickname, credit: owner.credit, level: creditLevel(owner.credit), city: owner.city } : { id: null, name: row.seller_name, credit: 80, level: "良好", city: "" },
    reviewCount: reviewAgg.c,
    reviewScore: reviewAgg.avg ? Math.round(Number(reviewAgg.avg) * 10) / 10 : null,
    favoriteCount: favCount,
    createdAt: row.created_at,
    code: `ZJB${String(row.id).toUpperCase()}`
  };
  if (viewer) {
    data.favorited = !!await one("SELECT 1 FROM favorites WHERE user_id = ? AND product_id = ?", viewer.id, row.id);
  }
  if (withDetail) {
    data.priceHistory = priceHistory(row);
    data.reviews = (await many(`SELECT r.*, u.nickname, u.credit FROM reviews r LEFT JOIN users u ON u.id = r.from_user
       WHERE r.product_id = ? ORDER BY r.created_at DESC LIMIT 20`, row.id)).map((r) => ({
      id: r.id, score: r.score, content: r.content, nickname: r.nickname || "匿名用户",
      credit: r.credit, role: r.role, createdAt: r.created_at
    }));
    data.questions = (await many("SELECT * FROM questions WHERE product_id = ? ORDER BY created_at DESC LIMIT 20", row.id)).map((q) => ({
      id: q.id, asker: q.asker, body: q.body, answer: q.answer, createdAt: q.created_at, answeredAt: q.answered_at
    }));
    data.similar = (await many("SELECT id, name, price, images, scenic FROM products WHERE category = ? AND id <> ? AND status = '在售' LIMIT 3", row.category, row.id)).map((s) => ({ id: s.id, name: s.name, price: s.price, image: JSON.parse(s.images || "[]")[0] || "", scenic: s.scenic }));
  }
  return data;
}
async function orderView(row) {
  if (!row) return null;
  const buyer = await one("SELECT id, nickname FROM users WHERE id = ?", row.buyer_id);
  const seller = row.seller_id ? await one("SELECT id, nickname FROM users WHERE id = ?", row.seller_id) : null;
  const reviewed = (await one("SELECT COUNT(*) AS c FROM reviews WHERE order_id = ?", row.id)).c > 0;
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    productImage: row.product_image,
    scenic: row.scenic,
    price: row.price,
    freight: row.freight,
    fee: row.fee,
    total: row.price + row.freight,
    status: row.status,
    buyer: buyer ? { id: buyer.id, name: buyer.nickname } : null,
    seller: seller ? { id: seller.id, name: seller.nickname } : null,
    address: JSON.parse(row.address_json || "{}"),
    timeline: JSON.parse(row.timeline || "[]"),
    trackingNo: row.tracking_no,
    expressCompany: row.express_company,
    cancelReason: row.cancel_reason,
    reviewed,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function pushTimeline(row, label, extra = "") {
  const timeline = JSON.parse(row.timeline || "[]");
  timeline.push({ at: now(), label, extra });
  return JSON.stringify(timeline);
}
/* =========================
   路由表
   ========================= */
const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, parts: pattern.split("/").filter(Boolean), handler, ...opts });
/* --- 健康检查 --- */
route("GET", "/api/health", async (ctx) => ok(ctx.res, {
  service: "zhijiabao-api",
  version: "2.0.0",
  serverTime: now(),
  scenics: SCENICS,
  categories: CATEGORIES,
  conditions: CONDITIONS
}));

/* 公开运营概览：首页数据看板使用，仅聚合统计，不含任何用户隐私字段 */
route("GET", "/api/stats/overview", async (ctx) => {
  const countOf = async (sql, args = []) => Number((await one(sql, args))?.c ?? 0);
  const avg = await one("SELECT COALESCE(AVG(score), 0) AS s FROM `reviews`");
  const gmv = await one("SELECT COALESCE(SUM(price + freight), 0) AS s FROM `orders` WHERE status = '已完成'");
  return ok(ctx.res, {
    overview: {
      products: await countOf("SELECT COUNT(*) AS c FROM `products` WHERE status = '在售'"),
      scenicCount: SCENICS.length,
      categories: CATEGORIES.length,
      users: await countOf("SELECT COUNT(*) AS c FROM `users` WHERE status = 'active'"),
      estimates: await countOf("SELECT COUNT(*) AS c FROM `estimates`"),
      completedOrders: await countOf("SELECT COUNT(*) AS c FROM `orders` WHERE status = '已完成'"),
      reviews: await countOf("SELECT COUNT(*) AS c FROM `reviews`"),
      avgScore: Math.round(Number(avg.s) * 10) / 10,
      gmv: Number(gmv.s)
    }
  });
}, { public: true });
/* --- 账号 --- */
route("POST", "/api/auth/code", async (ctx) => {
  const phone = String(ctx.body.phone || "").trim();
  if (!/^1[3-9]\d{9}$/.test(phone)) return fail(ctx.res, 400, "请输入 11 位有效手机号");
  const purpose = String(ctx.body.purpose || "login");
  if (!rateLimit(`code:${phone}`, 5, 60000)) return fail(ctx.res, 429, "验证码发送过于频繁，请稍后再试");
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await run("INSERT INTO sms_codes (phone, code, expire_at, purpose) VALUES (?, ?, ?, ?) " +
    "AS new ON DUPLICATE KEY UPDATE code = new.code, expire_at = new.expire_at, purpose = new.purpose",
    [phone, code, inMinutes(5), purpose]
  );
  /* 演示环境不接短信网关，直接回传验证码，正式部署应改为短信下发 */
  return ok(ctx.res, {
    message: "验证码已生成（演示环境直接返回，正式部署需接入短信网关）",
    devCode: code,
    expireInSeconds: 300,
    purpose
  });
}, { public: true });
async function consumeCode(phone, code, purpose) {
  const row = await one("SELECT * FROM sms_codes WHERE phone = ?", phone);
  if (!row || row.code !== String(code).trim()) return false;
  if (purpose && row.purpose !== purpose) return false;
  if (new Date(row.expire_at).getTime() < Date.now()) return false;
  await run("DELETE FROM sms_codes WHERE phone = ?", phone);
  return true;
}
route("POST", "/api/auth/register", async (ctx) => {
  const phone = String(ctx.body.phone || "").trim();
  const nickname = String(ctx.body.nickname || "").trim();
  const password = String(ctx.body.password || "");
  if (!/^1[3-9]\d{9}$/.test(phone)) return fail(ctx.res, 400, "请输入 11 位有效手机号");
  if (nickname.length < 2 || nickname.length > 16) return fail(ctx.res, 400, "昵称需为 2-16 个字符");
  if (password.length < 6) return fail(ctx.res, 400, "密码至少 6 位");
  if (await one("SELECT 1 FROM users WHERE phone = ?", phone)) return fail(ctx.res, 409, "该手机号已注册，请直接登录");
  if (!await consumeCode(phone, ctx.body.code, "register")) return fail(ctx.res, 400, "验证码错误或已过期");
  const info = await run("INSERT INTO users (phone, password_hash, nickname, bio, city, credit, created_at) VALUES (?, ?, ?, ?, ?, 70, ?)", phone, hashPassword(password), nickname, "", String(ctx.body.city || "").trim(), now());
  const token = await createSession(info.insertId);
  await audit(Number(info.insertId), "register", phone, "新用户注册");
  await notify(Number(info.insertId), "system", "欢迎加入智价宝", "完成实名认证并售出首件闲置，可提升信用分。", "/profile/");
  const user = await one("SELECT * FROM users WHERE id = ?", info.insertId);
  return ok(ctx.res, { token, user: publicUser(user) });
}, { public: true });
route("POST", "/api/auth/login", async (ctx) => {
  const phone = String(ctx.body.phone || "").trim();
  const user = await one("SELECT * FROM users WHERE phone = ?", phone);
  if (!user) return fail(ctx.res, 404, "该手机号尚未注册");
  if (user.status !== "active") return fail(ctx.res, 403, "账号已注销或被冻结");
  let passed = false;
  if (ctx.body.password) passed = verifyPassword(ctx.body.password, user.password_hash);
  else passed = await consumeCode(phone, ctx.body.code, "login");
  if (!passed) return fail(ctx.res, 401, ctx.body.password ? "手机号或密码不正确" : "验证码错误或已过期");
  const token = await createSession(user.id);
  await audit(user.id, "login", phone, "");
  return ok(ctx.res, { token, user: publicUser(user) });
}, { public: true });
route("POST", "/api/auth/reset-password", async (ctx) => {
  const phone = String(ctx.body.phone || "").trim();
  const password = String(ctx.body.password || "");
  if (password.length < 6) return fail(ctx.res, 400, "新密码至少 6 位");
  const user = await one("SELECT * FROM users WHERE phone = ?", phone);
  if (!user) return fail(ctx.res, 404, "该手机号尚未注册");
  if (!await consumeCode(phone, ctx.body.code, "reset")) return fail(ctx.res, 400, "验证码错误或已过期");
  await run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(password), user.id);
  await run("DELETE FROM sessions WHERE user_id = ?", user.id);
  await audit(user.id, "reset-password", phone, "");
  return ok(ctx.res, { message: "密码已重置，请使用新密码登录" });
}, { public: true });
route("POST", "/api/auth/logout", async (ctx) => {
  const header = ctx.req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token) await run("DELETE FROM sessions WHERE token = ?", token);
  return ok(ctx.res, { message: "已退出登录" });
});
route("GET", "/api/auth/me", async (ctx) => {
  if (!ctx.user) return ok(ctx.res, { user: null });
  const unreadMsg = (await one("SELECT COUNT(*) AS c FROM messages WHERE to_user = ? AND read_at IS NULL", ctx.user.id)).c;
  const unreadNotice = (await one("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL", ctx.user.id)).c;
  const counts = {
    estimates: (await one("SELECT COUNT(*) AS c FROM estimates WHERE user_id = ?", ctx.user.id)).c,
    products: (await one("SELECT COUNT(*) AS c FROM products WHERE owner_id = ?", ctx.user.id)).c,
    favorites: (await one("SELECT COUNT(*) AS c FROM favorites WHERE user_id = ?", ctx.user.id)).c,
    orders: (await one("SELECT COUNT(*) AS c FROM orders WHERE buyer_id = ? OR seller_id = ?", ctx.user.id, ctx.user.id)).c,
    unreadMsg,
    unreadNotice
  };
  return ok(ctx.res, { user: publicUser(ctx.user), counts });
});
/* --- 个人资料 --- */
route("PATCH", "/api/me", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录");
  const nickname = ctx.body.nickname !== undefined ? String(ctx.body.nickname).trim() : ctx.user.nickname;
  if (nickname.length < 2 || nickname.length > 16) return fail(ctx.res, 400, "昵称需为 2-16 个字符");
  const bio = ctx.body.bio !== undefined ? String(ctx.body.bio).trim().slice(0, 60) : ctx.user.bio;
  const city = ctx.body.city !== undefined ? String(ctx.body.city).trim().slice(0, 20) : ctx.user.city;
  const avatar = ctx.body.avatar !== undefined ? String(ctx.body.avatar).slice(0, 300) : ctx.user.avatar;
  const hit = findSensitive(`${nickname} ${bio}`);
  if (hit.length) return fail(ctx.res, 400, `资料包含违规词：${hit.join("、")}`);
  await run("UPDATE users SET nickname = ?, bio = ?, city = ?, avatar = ? WHERE id = ?", nickname, bio, city, avatar, ctx.user.id);
  return ok(ctx.res, { user: publicUser(await one("SELECT * FROM users WHERE id = ?", ctx.user.id)) });
});
route("POST", "/api/me/realname", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录");
  const realName = String(ctx.body.realName || "").trim();
  const idNo = String(ctx.body.idNo || "").trim();
  if (realName.length < 2) return fail(ctx.res, 400, "请输入真实姓名");
  if (!/^\d{17}[\dXx]$/.test(idNo)) return fail(ctx.res, 400, "请输入 18 位有效身份证号");
  /* 仅保存掩码，不落库完整证件号 */
  await run("UPDATE users SET real_name = ?, id_no_masked = ?, id_verified = 1 WHERE id = ?", realName, maskIdNo(idNo), ctx.user.id);
  await recalcCredit(ctx.user.id);
  await audit(ctx.user.id, "realname", `user:${ctx.user.id}`, "实名认证通过");
  await notify(ctx.user.id, "system", "实名认证已通过", "信用分已更新，可发布与交易。", "/profile/");
  return ok(ctx.res, { user: publicUser(await one("SELECT * FROM users WHERE id = ?", ctx.user.id)) });
});
route("POST", "/api/me/withdraw", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录");
  const amount = Number(ctx.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return fail(ctx.res, 400, "请输入有效提现金额");
  if (amount > ctx.user.balance) return fail(ctx.res, 400, `可提现余额不足（当前 ¥${ctx.user.balance}）`);
  await run("UPDATE users SET balance = balance - ? WHERE id = ?", Math.round(amount), ctx.user.id);
  await notify(ctx.user.id, "wallet", "提现申请已提交", `¥${Math.round(amount)} 将在 1-3 个工作日到账。`, "/profile/");
  await audit(ctx.user.id, "withdraw", `user:${ctx.user.id}`, `提现 ¥${Math.round(amount)}`);
  return ok(ctx.res, { user: publicUser(await one("SELECT * FROM users WHERE id = ?", ctx.user.id)) });
});
route("DELETE", "/api/me", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录");
  await run("UPDATE users SET status = 'deleted', phone = phone || '#deleted', nickname = '已注销用户' WHERE id = ?", ctx.user.id);
  await run("DELETE FROM sessions WHERE user_id = ?", ctx.user.id);
  await run("UPDATE products SET status = '已下架' WHERE owner_id = ? AND status IN ('在售','待审核')", ctx.user.id);
  await audit(ctx.user.id, "delete-account", `user:${ctx.user.id}`, "用户注销账号");
  return ok(ctx.res, { message: "账号已注销，相关在售商品已下架" });
});
/* --- 收货地址 --- */
route("GET", "/api/addresses", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录");
  const rows = await many("SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC", ctx.user.id);
  return ok(ctx.res, { addresses: rows });
});
route("POST", "/api/addresses", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录");
  const name = String(ctx.body.name || "").trim();
  const phone = String(ctx.body.phone || "").trim();
  const region = String(ctx.body.region || "").trim();
  const detail = String(ctx.body.detail || "").trim();
  if (name.length < 1 || name.length > 20) return fail(ctx.res, 400, "收件人姓名需为 1-20 个字符");
  if (!/^1[3-9]\d{9}$/.test(phone)) return fail(ctx.res, 400, "请输入有效收件人手机号");
  if (region.length < 2) return fail(ctx.res, 400, "请填写所在地区");
  if (detail.length < 4) return fail(ctx.res, 400, "请填写详细地址（至少 4 个字符）");
  const count = (await one("SELECT COUNT(*) AS c FROM addresses WHERE user_id = ?", ctx.user.id)).c;
  if (count >= 10) return fail(ctx.res, 400, "最多保存 10 个收货地址");
  const isDefault = ctx.body.isDefault ? 1 : count === 0 ? 1 : 0;
  if (isDefault) await run("UPDATE addresses SET is_default = 0 WHERE user_id = ?", ctx.user.id);
  const info = await run("INSERT INTO addresses (user_id, name, phone, region, detail, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", ctx.user.id, name, phone, region, detail, isDefault, now());
  return ok(ctx.res, { id: info.insertId });
});
route("POST", "/api/addresses/:id/default", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录");
  const row = await one("SELECT * FROM addresses WHERE id = ? AND user_id = ?", Number(ctx.params.id), ctx.user.id);
  if (!row) return fail(ctx.res, 404, "地址不存在");
  await run("UPDATE addresses SET is_default = 0 WHERE user_id = ?", ctx.user.id);
  await run("UPDATE addresses SET is_default = 1 WHERE id = ?", row.id);
  return ok(ctx.res, { message: "已设为默认地址" });
});
route("DELETE", "/api/addresses/:id", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录");
  await run("DELETE FROM addresses WHERE id = ? AND user_id = ?", Number(ctx.params.id), ctx.user.id);
  return ok(ctx.res, { message: "地址已删除" });
});
/* --- 商品 --- */
route("GET", "/api/products", async (ctx) => {
  const q = ctx.query;
  const where = [];
  const args = [];
  const status = q.status || "在售";
  if (status !== "all") {
    where.push("status = ?");
    args.push(status);
  }
  if (q.scenic) { where.push("scenic = ?"); args.push(q.scenic); }
  if (q.category) { where.push("category = ?"); args.push(q.category); }
  if (q.tag) { where.push("tag = ?"); args.push(q.tag); }
  if (q.keyword) {
    where.push("(name LIKE ? OR description LIKE ? OR scenic LIKE ?)");
    const like = `%${q.keyword}%`;
    args.push(like, like, like);
  }
  if (q.priceMin) { where.push("price >= ?"); args.push(Number(q.priceMin)); }
  if (q.priceMax) { where.push("price <= ?"); args.push(Number(q.priceMax)); }
  if (q.owner === "me") {
    if (!ctx.user) return fail(ctx.res, 401, "请先登录");
    where.push("owner_id = ?");
    args.push(ctx.user.id);
  }
  const sortMap = {
    heat: "heat DESC, views DESC",
    new: "created_at DESC",
    "price-asc": "price ASC",
    "price-desc": "price DESC",
    value: "CAST(price AS DECIMAL(10,2)) / original ASC"
  };
  const order = sortMap[q.sort] || sortMap.heat;
  const limit = Math.min(Number(q.limit) || 12, 48);
  const page = Math.max(Number(q.page) || 1, 1);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (await one(`SELECT COUNT(*) AS c FROM products ${whereSql}`, ...args)).c;
  /* MySQL 不允许在 LIMIT/OFFSET 使用占位符，这里直接拼接已校验过的整数 */
  const rows = await many(
    `SELECT * FROM \`products\` ${whereSql} ORDER BY ${order} LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    args
  );
  return ok(ctx.res, {
    total, page, limit,
    hasMore: page * limit < total,
    products: await Promise.all(rows.map((r) => productView(r, { viewer: ctx.user })))
  });
});
route("GET", "/api/products/:id", async (ctx) => {
  const row = await one("SELECT * FROM products WHERE id = ?", ctx.params.id);
  if (!row) return fail(ctx.res, 404, "商品不存在或已下架");
  if (row.status !== "在售" && row.owner_id !== ctx.user?.id && !ctx.user?.is_admin) {
    return fail(ctx.res, 403, "该商品当前不可见");
  }
  return ok(ctx.res, { product: await productView(row, { withDetail: true, viewer: ctx.user }) });
});
route("POST", "/api/products", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录后再发布闲置");
  if (!rateLimit(`product:${ctx.user.id}`, 5, 60000)) return fail(ctx.res, 429, "发布过于频繁，请稍后再试");
  const { errors, value } = validateProduct(ctx.body);
  if (errors.length) return fail(ctx.res, 400, errors[0].message, { errors: errors.map((e) => e.message) });
  const id = uid("p");
  await run(`INSERT INTO \`products\` (id, owner_id, name, scenic, category, \`condition\`, tag, price, original, freight,
      description, images, heat, retention, views, status, seller_name, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 60, 0.6, 0, '待审核', ?, 'user', ?)`, id, ctx.user.id, value.name, value.scenic, value.category, value.condition, value.tag,
    value.price, value.original, value.freight, value.description, JSON.stringify(value.images),
    ctx.user.nickname, now());
  await audit(ctx.user.id, "publish-product", `product:${id}`, value.name);
  await notify(ctx.user.id, "product", "发布已提交审核", `「${value.name}」将在审核通过后上架集市。`, `/market/`);
  const admins = await many("SELECT id FROM users WHERE is_admin = 1");
  for (const a of admins) await notify(a.id, "audit", "有待审核商品", `「${value.name}」等待审核`, "/admin/");
  return ok(ctx.res, { id, status: "待审核", message: "发布成功，等待平台审核后上架" });
});
route("PATCH", "/api/products/:id", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录");
  const row = await one("SELECT * FROM products WHERE id = ?", ctx.params.id);
  if (!row) return fail(ctx.res, 404, "商品不存在");
  if (row.owner_id !== ctx.user.id && !ctx.user.is_admin) return fail(ctx.res, 403, "只能修改自己发布的商品");
  if (row.status === "交易中") return fail(ctx.res, 400, "交易中的商品不能修改");
  const { errors, value } = validateProduct(ctx.body, { partial: true });
  if (errors.length) return fail(ctx.res, 400, errors[0].message, { errors: errors.map((e) => e.message) });
  const fields = Object.keys(value);
  if (!fields.length) return fail(ctx.res, 400, "没有需要更新的字段");
  const sets = fields.map((f) => `\`${f}\` = ?`).join(", ");
  const args = fields.map((f) => (f === "images" ? JSON.stringify(value[f]) : value[f]));
  const nextStatus = row.owner_id === ctx.user.id ? "待审核" : row.status;
  await run(`UPDATE products SET ${sets}, status = ? WHERE id = ?`, ...args, nextStatus, row.id);
  return ok(ctx.res, { message: "修改已保存，将重新进入审核", status: nextStatus });
});
route("POST", "/api/products/:id/offline", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录");
  const row = await one("SELECT * FROM products WHERE id = ?", ctx.params.id);
  if (!row) return fail(ctx.res, 404, "商品不存在");
  if (row.owner_id !== ctx.user.id && !ctx.user.is_admin) return fail(ctx.res, 403, "无操作权限");
  if (row.status === "交易中") return fail(ctx.res, 400, "交易中的商品不能下架");
  await run("UPDATE products SET status = '已下架' WHERE id = ?", row.id);
  await audit(ctx.user.id, "offline-product", `product:${row.id}`, ctx.body.reason || "");
  return ok(ctx.res, { message: "商品已下架" });
});
route("POST", "/api/products/:id/relist", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录");
  const row = await one("SELECT * FROM products WHERE id = ?", ctx.params.id);
  if (!row) return fail(ctx.res, 404, "商品不存在");
  if (row.owner_id !== ctx.user.id && !ctx.user.is_admin) return fail(ctx.res, 403, "无操作权限");
  await run("UPDATE products SET status = '待审核' WHERE id = ?", row.id);
  return ok(ctx.res, { message: "已重新提交审核" });
});
route("DELETE", "/api/products/:id", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录");
  const row = await one("SELECT * FROM products WHERE id = ?", ctx.params.id);
  if (!row) return fail(ctx.res, 404, "商品不存在");
  if (row.owner_id !== ctx.user.id && !ctx.user.is_admin) return fail(ctx.res, 403, "无操作权限");
  if (row.status === "交易中") return fail(ctx.res, 400, "交易中的商品不能删除");
  await run("DELETE FROM favorites WHERE product_id = ?", row.id);
  await run("DELETE FROM products WHERE id = ?", row.id);
  await audit(ctx.user.id, "delete-product", `product:${row.id}`, row.name);
  return ok(ctx.res, { message: "商品已删除" });
});
route("POST", "/api/products/:id/view", async (ctx) => {
  await run("UPDATE products SET views = views + 1 WHERE id = ?", ctx.params.id);
  if (ctx.user) {
    await run("INSERT INTO `footprints` (user_id, product_id, viewed_at) VALUES (?, ?, ?) " +
      "AS new ON DUPLICATE KEY UPDATE viewed_at = new.viewed_at", [ctx.user.id, ctx.params.id, now()]);
  }
  return ok(ctx.res, {});
}, { public: true });
route("GET", "/api/products/:id/price-history", async (ctx) => {
  const row = await one("SELECT * FROM products WHERE id = ?", ctx.params.id);
  if (!row) return fail(ctx.res, 404, "商品不存在");
  return ok(ctx.res, { history: priceHistory(row), current: row.price, freight: row.freight });
}, { public: true });
/* --- 收藏 / 足迹 / 搜索历史 / 降价提醒 --- */
route("GET", "/api/favorites", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录");
  const rows = await many(`SELECT p.*, f.price_alert, f.alert_price, f.created_at AS fav_at FROM favorites f
     JOIN products p ON p.id = f.product_id WHERE f.user_id = ? ORDER BY f.created_at DESC`, ctx.user.id);
  return ok(ctx.res, {
    favorites: await Promise.all(rows.map(async (r) => ({ ...await productView(r, { viewer: ctx.user }), priceAlert: !!r.price_alert, alertPrice: r.alert_price, favAt: r.fav_at })))
  });
});
route("POST", "/api/favorites/:id", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录后收藏");
  const row = await one("SELECT * FROM products WHERE id = ?", ctx.params.id);
  if (!row) return fail(ctx.res, 404, "商品不存在");
  const exists = await one("SELECT 1 FROM favorites WHERE user_id = ? AND product_id = ?", ctx.user.id, row.id);
  if (exists) {
    await run("DELETE FROM favorites WHERE user_id = ? AND product_id = ?", ctx.user.id, row.id);
    return ok(ctx.res, { favorited: false, message: "已取消收藏" });
  }
  const alertPrice = ctx.body?.alertPrice ? Math.round(Number(ctx.body.alertPrice)) : null;
  await run("INSERT INTO favorites (user_id, product_id, price_alert, alert_price, created_at) VALUES (?, ?, ?, ?, ?)", ctx.user.id, row.id, alertPrice ? 1 : 0, alertPrice, now());
  return ok(ctx.res, { favorited: true, message: "已加入收藏" });
});
route("POST", "/api/favorites/:id/alert", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录");
  const price = Math.round(Number(ctx.body.alertPrice));
  if (!Number.isFinite(price) || price <= 0) return fail(ctx.res, 400, "请输入有效的提醒价格");
  const row = await one("SELECT * FROM products WHERE id = ?", ctx.params.id);
  if (!row) return fail(ctx.res, 404, "商品不存在");
  if (price >= row.price) return fail(ctx.res, 400, `提醒价需低于当前售价 ¥${row.price}`);
  await run("INSERT INTO `favorites` (user_id, product_id, price_alert, alert_price, created_at) VALUES (?, ?, 1, ?, ?) " +
    "AS new ON DUPLICATE KEY UPDATE price_alert = 1, alert_price = new.alert_price",
    [ctx.user.id, row.id, price, now()]);
  return ok(ctx.res, { message: `已设置降价提醒：低于 ¥${price} 时通知你` });
});
route("GET", "/api/footprints", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录");
  const rows = await many(`SELECT p.*, fp.viewed_at FROM footprints fp JOIN products p ON p.id = fp.product_id
     WHERE fp.user_id = ? ORDER BY fp.viewed_at DESC LIMIT 30`, ctx.user.id);
  return ok(ctx.res, { footprints: await Promise.all(rows.map(async (r) => ({ ...await productView(r), viewedAt: r.viewed_at }))) });
});
route("DELETE", "/api/footprints", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录");
  await run("DELETE FROM footprints WHERE user_id = ?", ctx.user.id);
  return ok(ctx.res, { message: "浏览足迹已清空" });
});
route("GET", "/api/search-history", async (ctx) => {
  if (!ctx.user) return ok(ctx.res, { history: [] });
  /* MySQL 下 DISTINCT 与 ORDER BY 非选择列冲突，改为按关键词分组取最近一次 */
  const rows = await many(
    "SELECT keyword, MAX(id) AS last_id FROM `search_history` WHERE user_id = ? GROUP BY keyword ORDER BY last_id DESC LIMIT 12",
    [ctx.user.id]
  );
  return ok(ctx.res, { history: rows.map((r) => r.keyword) });
});
route("POST", "/api/search-history", async (ctx) => {
  const keyword = String(ctx.body.keyword || "").trim().slice(0, 40);
  if (!keyword) return fail(ctx.res, 400, "关键词不能为空");
  if (!ctx.user) return ok(ctx.res, { history: [] });
  await run("DELETE FROM search_history WHERE user_id = ? AND keyword = ?", ctx.user.id, keyword);
  await run("INSERT INTO search_history (user_id, keyword, created_at) VALUES (?, ?, ?)", ctx.user.id, keyword, now());
  /* MySQL 不支持在 IN 子查询里直接带 LIMIT，需要包一层派生表；只保留最近 20 条 */
  await run(
    `DELETE FROM \`search_history\` WHERE user_id = ? AND id NOT IN (
       SELECT id FROM (SELECT id FROM \`search_history\` WHERE user_id = ? ORDER BY id DESC LIMIT 20) AS keep
     )`,
    [ctx.user.id, ctx.user.id]
  );
  return ok(ctx.res, { message: "已记录" });
});
route("DELETE", "/api/search-history", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录");
  await run("DELETE FROM search_history WHERE user_id = ?", ctx.user.id);
  return ok(ctx.res, { message: "搜索历史已清空" });
});
/* --- 估价记录 --- */
route("GET", "/api/estimates", async (ctx) => {
  if (!ctx.user) return ok(ctx.res, { estimates: [] });
  const rows = await many("SELECT * FROM estimates WHERE user_id = ? ORDER BY created_at DESC LIMIT 50", ctx.user.id);
  return ok(ctx.res, { estimates: rows.map((r) => ({ ...r, weather: JSON.parse(r.weather_json || "{}"), breakdown: JSON.parse(r.breakdown_json || "[]") })) });
});
route("POST", "/api/estimates", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录后再保存估价记录");
  if (!rateLimit(`estimate:${ctx.user.id}`, 20, 60000)) return fail(ctx.res, 429, "估价操作过于频繁，请稍后再试");
  const payload = ctx.body;
  const id = payload.id || uid("e");
  await run(`INSERT INTO \`estimates\` (id, user_id, scenic, original, \`condition\`, note, bought_at, has_certificate,
      has_package, limited, flawed, result, range_low, range_high, confidence, weather_json, breakdown_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     AS new ON DUPLICATE KEY UPDATE result = new.result, confidence = new.confidence`, id, ctx.user.id, String(payload.scenic || ""), Math.round(Number(payload.original) || 0),
    String(payload.condition || "95新"), String(payload.note || "").slice(0, 200),
    String(payload.boughtAt || ""), payload.hasCertificate ? 1 : 0, payload.hasPackage ? 1 : 0,
    payload.limited ? 1 : 0, payload.flawed ? 1 : 0,
    Math.round(Number(payload.result) || 0), Math.round(Number(payload.rangeLow) || 0),
    Math.round(Number(payload.rangeHigh) || 0), Math.round(Number(payload.confidence) || 80),
    JSON.stringify(payload.weather || {}), JSON.stringify(payload.breakdown || []), now());
  return ok(ctx.res, { id });
});
route("DELETE", "/api/estimates/:id", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录");
  await run("DELETE FROM estimates WHERE id = ? AND user_id = ?", ctx.params.id, ctx.user.id);
  return ok(ctx.res, { message: "估价记录已删除" });
});
/* --- 订单（担保交易闭环） --- */
route("POST", "/api/orders", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录后再下单");
  const product = await one("SELECT * FROM products WHERE id = ?", String(ctx.body.productId || ""));
  if (!product) return fail(ctx.res, 404, "商品不存在");
  if (product.status !== "在售") return fail(ctx.res, 400, `该商品当前状态为「${product.status}」，无法下单`);
  if (product.owner_id && product.owner_id === ctx.user.id) return fail(ctx.res, 400, "不能购买自己发布的商品");

  let address;
  if (ctx.body.addressId) {
    address = await one("SELECT * FROM addresses WHERE id = ? AND user_id = ?", Number(ctx.body.addressId), ctx.user.id);
    if (!address) return fail(ctx.res, 400, "收货地址不存在");
  } else {
    const name = String(ctx.body.name || "").trim();
    const phone = String(ctx.body.phone || "").trim();
    const region = String(ctx.body.region || "").trim();
    const detail = String(ctx.body.detail || "").trim();
    if (name.length < 1 || !/^1[3-9]\d{9}$/.test(phone) || region.length < 2 || detail.length < 4) {
      return fail(ctx.res, 400, "请填写完整的收货信息或选择已保存地址");
    }
    address = { name, phone, region, detail };
  }

  const id = uid("o");
  const t = now();
  try {
    /* 事务内重新加锁校验商品状态，避免并发下同一件商品被重复下单 */
    await transaction(async (tx) => {
      const fresh = await tx.one("SELECT * FROM `products` WHERE id = ? FOR UPDATE", [product.id]);
      if (!fresh) {
        const error = new Error("商品不存在");
        error.httpStatus = 404;
        throw error;
      }
      if (fresh.status !== "在售") {
        const error = new Error(`该商品当前状态为「${fresh.status}」，无法下单`);
        error.httpStatus = 400;
        throw error;
      }
      await tx.run(
        `INSERT INTO \`orders\` (id, product_id, product_name, product_image, scenic, buyer_id, seller_id, price,
          freight, fee, address_json, status, timeline, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '待付款', ?, ?, ?)`,
        [id, fresh.id, fresh.name, JSON.parse(fresh.images || "[]")[0] || "", fresh.scenic,
          ctx.user.id, fresh.owner_id, fresh.price, fresh.freight, Math.round(fresh.price * 0.02),
          JSON.stringify(address),
          JSON.stringify([{ at: t, label: "订单创建", extra: "等待买家付款，款项由平台担保" }]), t, t]
      );
      await tx.run("UPDATE `products` SET status = '交易中' WHERE id = ?", [fresh.id]);
    });
  } catch (error) {
    if (error.httpStatus) return fail(ctx.res, error.httpStatus, error.message);
    throw error;
  }
  if (product.owner_id) await notify(product.owner_id, "order", "有买家发起担保交易", `「${product.name}」等待买家付款`, "/orders/");
  await audit(ctx.user.id, "create-order", `order:${id}`, product.name);
  return ok(ctx.res, { order: await orderView(await one("SELECT * FROM `orders` WHERE id = ?", [id])) });
});
route("GET", "/api/orders", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录");
  const role = ctx.query.role === "seller" ? "seller" : ctx.query.role === "all" ? "all" : "buyer";
  const status = ctx.query.status;
  let sql = "SELECT * FROM orders WHERE ";
  const args = [];
  if (role === "buyer") { sql += "buyer_id = ?"; args.push(ctx.user.id); }
  else if (role === "seller") { sql += "seller_id = ?"; args.push(ctx.user.id); }
  else { sql += "(buyer_id = ? OR seller_id = ?)"; args.push(ctx.user.id, ctx.user.id); }
  if (status && status !== "all") { sql += " AND status = ?"; args.push(status); }
  sql += " ORDER BY created_at DESC LIMIT 60";
  const rows = await many(sql, ...args);
  const stats = {
    all: rows.length,
    pending: rows.filter((r) => r.status === "待付款").length,
    shipping: rows.filter((r) => r.status === "待发货").length,
    receiving: rows.filter((r) => r.status === "待收货").length,
    done: rows.filter((r) => r.status === "已完成").length,
    afterSale: rows.filter((r) => ["售后中", "已退款"].includes(r.status)).length
  };
  return ok(ctx.res, { orders: await Promise.all(rows.map((r) => orderView(r))), stats });
});
route("GET", "/api/orders/:id", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录");
  const row = await one("SELECT * FROM orders WHERE id = ?", ctx.params.id);
  if (!row) return fail(ctx.res, 404, "订单不存在");
  if (row.buyer_id !== ctx.user.id && row.seller_id !== ctx.user.id && !ctx.user.is_admin) {
    return fail(ctx.res, 403, "无权查看该订单");
  }
  return ok(ctx.res, { order: await orderView(row) });
});
/* 担保交易状态机：待付款 → 待发货 → 待收货 → 已完成 / 售后中 → 已退款
   全部在事务内完成，并对订单行加排他锁，避免并发重复放款或重复流转 */
async function transitionOrder(ctx, nextStatus, { label, extra = "", fields = {} } = {}) {
  const businessError = (message, httpStatus = 400) => {
    const error = new Error(message);
    error.httpStatus = httpStatus;
    return error;
  };

  let payload;
  try {
    payload = await transaction(async (tx) => {
      const row = await tx.one("SELECT * FROM `orders` WHERE id = ? FOR UPDATE", [ctx.params.id]);
      if (!row) throw businessError("订单不存在", 404);

      const isBuyer = row.buyer_id === ctx.user.id;
      const isSeller = row.seller_id === ctx.user.id;
      if (!isBuyer && !isSeller && !ctx.user.is_admin) throw businessError("无权操作该订单", 403);

      const allowed = ORDER_FLOW[row.status] || [];
      if (!allowed.includes(nextStatus)) {
        throw businessError(`订单当前状态为「${row.status}」，不能变更为「${nextStatus}」`);
      }
      const guards = {
        "待发货": () => isBuyer || ctx.user.is_admin || "只有买家可以付款",
        "待收货": () => isSeller || ctx.user.is_admin || "只有卖家可以发货",
        "已完成": () => isBuyer || ctx.user.is_admin || "只有买家可以确认收货",
        "已取消": () => isBuyer || ctx.user.is_admin || "只有买家可以取消订单",
        "售后中": () => isBuyer || ctx.user.is_admin || "只有买家可以发起售后",
        "已退款": () => isSeller || ctx.user.is_admin || "只有卖家可以确认退款"
      };
      const guard = guards[nextStatus];
      if (guard) {
        const passed = guard();
        if (passed !== true) throw businessError(passed, 403);
      }

      const sets = { ...fields };
      const notices = [];
      let productStatus = null;
      if (nextStatus === "待发货") {
        productStatus = "交易中";
        notices.push([row.seller_id, "order", "买家已付款（平台担保）", `「${row.product_name}」请尽快发货`, "/orders/"]);
      }
      if (nextStatus === "待收货") {
        notices.push([row.buyer_id, "order", "卖家已发货",
          `「${row.product_name}」${fields.express_company || ""} ${fields.tracking_no || ""}`, "/orders/"]);
      }
      if (nextStatus === "已完成") {
        /* 确认收货后放款给卖家（扣除 2% 平台服务费） */
        const income = row.price + row.freight - row.fee;
        if (row.seller_id) {
          await tx.run("UPDATE `users` SET balance = balance + ? WHERE id = ?", [income, row.seller_id]);
          notices.push([row.seller_id, "wallet", "货款已入账",
            `「${row.product_name}」确认收货，到账 ¥${income}（已扣 2% 服务费 ¥${row.fee}）`, "/profile/"]);
        }
        productStatus = "已售出";
        notices.push([row.buyer_id, "order", "交易完成", `「${row.product_name}」已完成，快去评价卖家吧`, "/orders/"]);
      }
      if (nextStatus === "已取消") {
        productStatus = "在售";
        sets.cancel_reason = String(extra || "买家取消").slice(0, 60);
        notices.push([row.seller_id, "order", "订单已取消", `「${row.product_name}」订单已取消`, "/orders/"]);
      }
      if (nextStatus === "售后中") {
        notices.push([row.seller_id, "order", "买家发起售后", `「${row.product_name}」${String(extra || "").slice(0, 40)}`, "/orders/"]);
      }
      if (nextStatus === "已退款") {
        productStatus = "在售";
        notices.push([row.buyer_id, "order", "退款已完成", `「${row.product_name}」退款 ¥${row.price + row.freight} 已按原路退回`, "/orders/"]);
      }

      const setSql = Object.keys(sets).map((k) => `\`${k}\` = ?`).join(", ");
      const values = Object.values(sets);
      const timeline = pushTimeline(row, label, extra);
      await tx.run(
        `UPDATE \`orders\` SET ${setSql}${setSql ? ", " : ""}status = ?, timeline = ?, updated_at = ? WHERE id = ?`,
        [...values, nextStatus, timeline, now(), row.id]
      );
      if (productStatus) await tx.run("UPDATE `products` SET status = ? WHERE id = ?", [productStatus, row.product_id]);
      return { row, notices };
    });
  } catch (error) {
    if (error.httpStatus) return fail(ctx.res, error.httpStatus, error.message);
    throw error;
  }

  /* 事务提交后再写通知与审计，避免通知因回滚而丢失或重复 */
  for (const [userId, type, title, body, link] of payload.notices) await notify(userId, type, title, body, link);
  await audit(ctx.user.id, `order-${nextStatus}`, `order:${payload.row.id}`, extra);
  const fresh = await one("SELECT * FROM `orders` WHERE id = ?", [payload.row.id]);
  return ok(ctx.res, { order: await orderView(fresh), message: label });
}
route("POST", "/api/orders/:id/pay", async (ctx) => transitionOrder(ctx, "待发货", { label: "买家付款", extra: "款项进入平台担保账户" }));
route("POST", "/api/orders/:id/ship", async (ctx) => {
  const carrier = String(ctx.body.expressCompany || "顺丰速运").slice(0, 20);
  const no = String(ctx.body.trackingNo || "").trim();
  if (no && !/^[A-Za-z0-9-]{6,24}$/.test(no)) return fail(ctx.res, 400, "快递单号格式不正确");
  return transitionOrder(ctx, "待收货", {
    label: "卖家发货",
    extra: `${carrier} ${no}`.trim(),
    fields: { express_company: carrier, tracking_no: no }
  });
});
route("POST", "/api/orders/:id/confirm", async (ctx) => transitionOrder(ctx, "已完成", { label: "买家确认收货", extra: "担保款项已放款给卖家" }));
route("POST", "/api/orders/:id/cancel", async (ctx) => transitionOrder(ctx, "已取消", { label: "订单取消", extra: String(ctx.body.reason || "买家取消").slice(0, 60) }));
route("POST", "/api/orders/:id/refund", async (ctx) => {
  const reason = String(ctx.body.reason || "").trim();
  if (reason.length < 4) return fail(ctx.res, 400, "请填写至少 4 个字的售后原因");
  return transitionOrder(ctx, "售后中", { label: "买家发起售后", extra: reason.slice(0, 60) });
});
route("POST", "/api/orders/:id/refund-accept", async (ctx) => transitionOrder(ctx, "已退款", { label: "卖家同意退款", extra: "款项原路退回买家" }));
route("POST", "/api/orders/:id/review", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录");
  const row = await one("SELECT * FROM orders WHERE id = ?", ctx.params.id);
  if (!row) return fail(ctx.res, 404, "订单不存在");
  if (row.status !== "已完成") return fail(ctx.res, 400, "订单完成后才能评价");
  if (row.buyer_id !== ctx.user.id && row.seller_id !== ctx.user.id) return fail(ctx.res, 403, "无权评价该订单");
  if (await one("SELECT 1 FROM reviews WHERE order_id = ? AND from_user = ?", row.id, ctx.user.id)) {
    return fail(ctx.res, 400, "你已经评价过该订单");
  }
  const score = Math.round(Number(ctx.body.score));
  if (!(score >= 1 && score <= 5)) return fail(ctx.res, 400, "评分需为 1-5 星");
  const content = String(ctx.body.content || "").trim().slice(0, 200);
  const hit = findSensitive(content);
  if (hit.length) return fail(ctx.res, 400, `评价包含违规词：${hit.join("、")}`);
  const isBuyer = row.buyer_id === ctx.user.id;
  await run(`INSERT INTO reviews (order_id, product_id, from_user, to_user, role, score, content, images, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?)`, row.id, row.product_id, ctx.user.id, isBuyer ? row.seller_id : row.buyer_id, isBuyer ? "buyer" : "seller", score, content, now());
  const targetUser = isBuyer ? row.seller_id : row.buyer_id;
  if (targetUser) {
    await recalcCredit(targetUser);
    await notify(targetUser, "review", "收到一条新评价", `${score} 星：${content || "卖家未填写评价内容"}`, "/profile/");
  }
  return ok(ctx.res, { message: "评价已提交，感谢你的反馈" });
});
route("GET", "/api/reviews", async (ctx) => {
  const q = ctx.query;
  const where = [];
  const args = [];
  if (q.productId) { where.push("r.product_id = ?"); args.push(q.productId); }
  if (q.userId) { where.push("r.to_user = ?"); args.push(Number(q.userId)); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await many(`SELECT r.*, u.nickname, u.credit FROM reviews r LEFT JOIN users u ON u.id = r.from_user
     ${whereSql} ORDER BY r.created_at DESC LIMIT 50`, ...args);
  return ok(ctx.res, {
    reviews: rows.map((r) => ({
      id: r.id, productId: r.product_id, score: r.score, content: r.content, nickname: r.nickname || "匿名用户",
      credit: r.credit, role: r.role, createdAt: r.created_at
    }))
  });
}, { public: true });
/* --- 商品问答 --- */
route("POST", "/api/products/:id/questions", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录后提问");
  const body = String(ctx.body.body || "").trim();
  if (body.length < 2 || body.length > 100) return fail(ctx.res, 400, "问题需为 2-100 个字符");
  const hit = findSensitive(body);
  if (hit.length) return fail(ctx.res, 400, `提问包含违规词：${hit.join("、")}`);
  const product = await one("SELECT * FROM products WHERE id = ?", ctx.params.id);
  if (!product) return fail(ctx.res, 404, "商品不存在");
  await run("INSERT INTO questions (product_id, user_id, asker, body, created_at) VALUES (?, ?, ?, ?, ?)", product.id, ctx.user.id, ctx.user.nickname, body, now());
  if (product.owner_id) await notify(product.owner_id, "question", "有买家向你提问", body, `/market/?id=${product.id}`);
  return ok(ctx.res, { message: "提问已提交" });
});
route("POST", "/api/questions/:id/answer", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录");
  const row = await one("SELECT * FROM questions WHERE id = ?", Number(ctx.params.id));
  if (!row) return fail(ctx.res, 404, "问题不存在");
  const product = await one("SELECT * FROM products WHERE id = ?", row.product_id);
  if (!product) return fail(ctx.res, 404, "商品不存在");
  if (product.owner_id !== ctx.user.id && !ctx.user.is_admin) return fail(ctx.res, 403, "只有卖家可以回答");
  const answer = String(ctx.body.answer || "").trim();
  if (answer.length < 2 || answer.length > 200) return fail(ctx.res, 400, "回答需为 2-200 个字符");
  await run("UPDATE questions SET answer = ?, answered_at = ? WHERE id = ?", answer, now(), row.id);
  if (row.user_id) await notify(row.user_id, "question", "卖家已回答你的提问", answer, `/market/?id=${product.id}`);
  return ok(ctx.res, { message: "回答已提交" });
});
/* --- 站内消息 --- */
route("GET", "/api/conversations", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录");
  const rows = await many(`SELECT c.*, u.nickname AS peer_name, u.credit AS peer_credit FROM conversations c
     LEFT JOIN users u ON u.id = c.peer_id WHERE c.user_id = ? ORDER BY c.last_at DESC`, ctx.user.id);
  return ok(ctx.res, { conversations: rows });
});
route("GET", "/api/messages", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录");
  const peerId = Number(ctx.query.peer);
  if (!peerId) return fail(ctx.res, 400, "缺少会话对象");
  const rows = await many(`SELECT * FROM messages WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)
     ORDER BY created_at ASC LIMIT 200`, ctx.user.id, peerId, peerId, ctx.user.id);
  await run("UPDATE messages SET read_at = ? WHERE to_user = ? AND from_user = ? AND read_at IS NULL", now(), ctx.user.id, peerId);
  await run("UPDATE conversations SET unread = 0 WHERE user_id = ? AND peer_id = ?", ctx.user.id, peerId);
  return ok(ctx.res, { messages: rows });
});
route("POST", "/api/messages", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录后联系卖家");
  const to = Number(ctx.body.to);
  const body = String(ctx.body.body || "").trim();
  if (!to) return fail(ctx.res, 400, "缺少接收方");
  if (to === ctx.user.id) return fail(ctx.res, 400, "不能给自己发送消息");
  const target = await one("SELECT * FROM users WHERE id = ?", to);
  if (!target) return fail(ctx.res, 404, "对方账号不存在");
  if (body.length < 1 || body.length > 300) return fail(ctx.res, 400, "消息长度需为 1-300 个字符");
  if (!rateLimit(`msg:${ctx.user.id}`, 30, 60000)) return fail(ctx.res, 429, "发送过于频繁");
  const hit = findSensitive(body);
  if (hit.length) return fail(ctx.res, 400, `消息包含违规词：${hit.join("、")}（平台禁止站外交易）`);
  const productId = String(ctx.body.productId || "");
  const t = now();
  await run("INSERT INTO `messages` (from_user, to_user, product_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
    [ctx.user.id, to, productId, body, t]);
  const UPSERT_CONVERSATION =
    `INSERT INTO \`conversations\` (user_id, peer_id, product_id, last_body, last_at, unread)
     VALUES (?, ?, ?, ?, ?, ?)
     AS new ON DUPLICATE KEY UPDATE last_body = new.last_body, last_at = new.last_at,
       unread = new.unread, product_id = new.product_id`;
  await run(UPSERT_CONVERSATION, [ctx.user.id, to, productId, body, t, 0]);
  const prevUnread = await one("SELECT unread FROM `conversations` WHERE user_id = ? AND peer_id = ?", [to, ctx.user.id]);
  await run(UPSERT_CONVERSATION, [to, ctx.user.id, productId, body, t, Number(prevUnread?.unread || 0) + 1]);
  await notify(to, "message", `来自 ${ctx.user.nickname} 的消息`, body.slice(0, 40), "/messages/");
  return ok(ctx.res, { message: "已发送" });
});
/* --- 通知 --- */
route("GET", "/api/notifications", async (ctx) => {
  if (!ctx.user) return ok(ctx.res, { notifications: [] });
  const rows = await many("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50", ctx.user.id);
  const unread = rows.filter((r) => !r.read_at).length;
  return ok(ctx.res, { notifications: rows, unread });
});
route("POST", "/api/notifications/read", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录");
  if (ctx.body.id) await run("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?", now(), Number(ctx.body.id), ctx.user.id);
  else await run("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL", now(), ctx.user.id);
  return ok(ctx.res, { message: "已标记为已读" });
});
/* --- 举报 --- */
route("POST", "/api/reports", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录后举报");
  const targetType = String(ctx.body.targetType || "");
  if (!["product", "user", "review", "question", "message"].includes(targetType)) return fail(ctx.res, 400, "举报对象类型不正确");
  const reason = String(ctx.body.reason || "").trim();
  if (reason.length < 2) return fail(ctx.res, 400, "请选择或填写举报理由");
  if (!rateLimit(`report:${ctx.user.id}`, 5, 300000)) return fail(ctx.res, 429, "举报过于频繁，请稍后再试");
  const info = await run(`INSERT INTO reports (target_type, target_id, target_label, reason, detail, reporter_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, '待处理', ?)`, targetType, String(ctx.body.targetId || ""), String(ctx.body.targetLabel || "").slice(0, 60), reason.slice(0, 40), String(ctx.body.detail || "").slice(0, 300), ctx.user.id, now());
  const admins = await many("SELECT id FROM users WHERE is_admin = 1");
  for (const a of admins) await notify(a.id, "audit", "收到新的举报", `${targetType} · ${reason}`, "/admin/");
  await audit(ctx.user.id, "report", `${targetType}:${ctx.body.targetId}`, reason);
  return ok(ctx.res, { id: info.insertId, message: "举报已提交，平台将在 24 小时内处理" });
});
/* --- 埋点 --- */
route("POST", "/api/events", async (ctx) => {
  const name = String(ctx.body.name || "").slice(0, 40);
  if (!name) return fail(ctx.res, 400, "缺少事件名");
  let visitor = String(ctx.body.visitor || "");
  if (!/^v_[a-z0-9]{6,20}$/.test(visitor)) visitor = `v_${randomUUID().slice(0, 12)}`;
  await run("INSERT INTO events (user_id, visitor, name, payload, created_at) VALUES (?, ?, ?, ?, ?)", ctx.user?.id ?? null, visitor, name, JSON.stringify(ctx.body.payload || {}), now());
  return ok(ctx.res, { visitor });
}, { public: true });
/* --- 运营后台 --- */
const adminOnly = (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录");
  if (!ctx.user.is_admin) return fail(ctx.res, 403, "需要管理员权限");
  return null;
};
route("GET", "/api/admin/stats", async (ctx) => {
  const denied = adminOnly(ctx);
  if (denied) return denied;
  const dayAgo = inDays(-1);
  const weekAgo = inDays(-7);
  const countOf = async (sql, args = []) => Number((await one(sql, args))?.c ?? 0);
  const gmvRow = await one("SELECT COALESCE(SUM(price + freight), 0) AS s FROM `orders` WHERE status = '已完成'");
  const avgRow = await one("SELECT COALESCE(AVG(score), 0) AS s FROM `reviews`");
  const pv = await countOf("SELECT COUNT(*) AS c FROM `events`");
  const orderCount = await countOf("SELECT COUNT(*) AS c FROM `orders`");
  const stats = {
    users: await countOf("SELECT COUNT(*) AS c FROM `users` WHERE status = 'active'"),
    newUsers7d: await countOf("SELECT COUNT(*) AS c FROM `users` WHERE created_at > ?", [weekAgo]),
    verifiedUsers: await countOf("SELECT COUNT(*) AS c FROM `users` WHERE id_verified = 1"),
    products: await countOf("SELECT COUNT(*) AS c FROM `products`"),
    onSale: await countOf("SELECT COUNT(*) AS c FROM `products` WHERE status = '在售'"),
    pendingAudit: await countOf("SELECT COUNT(*) AS c FROM `products` WHERE status = '待审核'"),
    orders: orderCount,
    completedOrders: await countOf("SELECT COUNT(*) AS c FROM `orders` WHERE status = '已完成'"),
    gmv: Number(gmvRow.s),
    estimates: await countOf("SELECT COUNT(*) AS c FROM `estimates`"),
    reports: await countOf("SELECT COUNT(*) AS c FROM `reports`"),
    pendingReports: await countOf("SELECT COUNT(*) AS c FROM `reports` WHERE status = '待处理'"),
    reviews: await countOf("SELECT COUNT(*) AS c FROM `reviews`"),
    avgScore: Math.round(Number(avgRow.s) * 10) / 10,
    messages: await countOf("SELECT COUNT(*) AS c FROM `messages`"),
    pv,
    uv: await countOf("SELECT COUNT(DISTINCT visitor) AS c FROM `events`"),
    dau: await countOf("SELECT COUNT(DISTINCT visitor) AS c FROM `events` WHERE created_at > ?", [dayAgo]),
    conversion: pv ? Math.round((orderCount / pv) * 1000) / 10 : 0,
    events7d: await many("SELECT name, COUNT(*) AS c FROM `events` WHERE created_at > ? GROUP BY name ORDER BY c DESC LIMIT 12", [weekAgo]),
    scenicRank: await many("SELECT scenic, COUNT(*) AS c, COALESCE(SUM(views), 0) AS views FROM `products` GROUP BY scenic ORDER BY views DESC"),
    categoryRank: await many("SELECT category, COUNT(*) AS c, ROUND(AVG(price)) AS avgPrice FROM `products` GROUP BY category ORDER BY c DESC"),
    dailyPv: (await many("SELECT LEFT(created_at, 10) AS day, COUNT(*) AS c, COUNT(DISTINCT visitor) AS uv FROM `events` GROUP BY day ORDER BY day DESC LIMIT 14")).reverse(),
    dailyOrders: (await many("SELECT LEFT(created_at, 10) AS day, COUNT(*) AS c FROM `orders` GROUP BY day ORDER BY day DESC LIMIT 14")).reverse()
  };
  return ok(ctx.res, { stats });
});
route("GET", "/api/admin/products", async (ctx) => {
  const denied = adminOnly(ctx);
  if (denied) return denied;
  const status = ctx.query.status || "待审核";
  const rows = status === "all"
    ? await many("SELECT * FROM products ORDER BY created_at DESC LIMIT 100")
    : await many("SELECT * FROM products WHERE status = ? ORDER BY created_at DESC LIMIT 100", status);
  return ok(ctx.res, { products: await Promise.all(rows.map((r) => productView(r))) });
});
route("POST", "/api/admin/products/:id/review", async (ctx) => {
  const denied = adminOnly(ctx);
  if (denied) return denied;
  const row = await one("SELECT * FROM products WHERE id = ?", ctx.params.id);
  if (!row) return fail(ctx.res, 404, "商品不存在");
  const approve = !!ctx.body.approve;
  const reason = String(ctx.body.reason || "").slice(0, 100);
  if (!approve && !reason) return fail(ctx.res, 400, "驳回时必须填写原因");
  await run("UPDATE products SET status = ?, reject_reason = ? WHERE id = ?", approve ? "在售" : "已下架", approve ? "" : reason, row.id);
  if (row.owner_id) {
    await notify(
      row.owner_id, "audit",
      approve ? "商品审核通过" : "商品未通过审核",
      approve ? `「${row.name}」已在集市上架` : `「${row.name}」驳回原因：${reason}`,
      "/market/"
    );
  }
  await audit(ctx.user.id, approve ? "approve-product" : "reject-product", `product:${row.id}`, reason);
  return ok(ctx.res, { message: approve ? "已通过审核并上架" : "已驳回并通知发布者" });
});
route("GET", "/api/admin/reports", async (ctx) => {
  const denied = adminOnly(ctx);
  if (denied) return denied;
  const rows = await many(`SELECT r.*, u.nickname AS reporter FROM reports r LEFT JOIN users u ON u.id = r.reporter_id
     ORDER BY CASE r.status WHEN '待处理' THEN 0 ELSE 1 END, r.created_at DESC LIMIT 100`);
  return ok(ctx.res, { reports: rows });
});
route("POST", "/api/admin/reports/:id", async (ctx) => {
  const denied = adminOnly(ctx);
  if (denied) return denied;
  const row = await one("SELECT * FROM reports WHERE id = ?", Number(ctx.params.id));
  if (!row) return fail(ctx.res, 404, "举报不存在");
  const accept = !!ctx.body.accept;
  const note = String(ctx.body.note || "").slice(0, 200);
  await run("UPDATE reports SET status = ?, handle_note = ?, handled_at = ? WHERE id = ?", accept ? "已处理" : "已驳回", note, now(), row.id);
  if (accept) {
    if (row.target_type === "product") {
      await run("UPDATE products SET status = '已下架' WHERE id = ?", row.target_id);
      const product = await one("SELECT owner_id, name FROM products WHERE id = ?", row.target_id);
      if (product?.owner_id) await notify(product.owner_id, "audit", "商品因违规被下架", note || "违反平台规则", "/market/");
    }
    if (row.target_type === "user") {
      await recalcCredit(Number(row.target_id));
    }
    if (row.target_type === "review") {
      await run("DELETE FROM reviews WHERE id = ?", Number(row.target_id));
    }
    if (row.target_type === "question") {
      await run("DELETE FROM questions WHERE id = ?", Number(row.target_id));
    }
  }
  if (row.reporter_id) await notify(row.reporter_id, "audit", "举报处理完成", accept ? `已处理：${note || "违规内容已下架"}` : "经核实未违规", "/market/");
  await audit(ctx.user.id, "handle-report", `report:${row.id}`, note);
  return ok(ctx.res, { message: "处理完成" });
});
route("GET", "/api/admin/users", async (ctx) => {
  const denied = adminOnly(ctx);
  if (denied) return denied;
  const rows = await many(`SELECT u.*, (SELECT COUNT(*) FROM products p WHERE p.owner_id = u.id) AS productCount,
      (SELECT COUNT(*) FROM orders o WHERE o.buyer_id = u.id OR o.seller_id = u.id) AS orderCount
     FROM users u ORDER BY u.created_at DESC LIMIT 100`);
  return ok(ctx.res, {
    users: rows.map((u) => ({ ...publicUser(u), productCount: u.productCount, orderCount: u.orderCount, status: u.status }))
  });
});
route("POST", "/api/admin/users/:id/status", async (ctx) => {
  const denied = adminOnly(ctx);
  if (denied) return denied;
  const id = Number(ctx.params.id);
  const status = ctx.body.status === "frozen" ? "frozen" : "active";
  if (id === ctx.user.id) return fail(ctx.res, 400, "不能冻结自己的账号");
  await run("UPDATE users SET status = ? WHERE id = ?", status, id);
  if (status === "frozen") await run("DELETE FROM sessions WHERE user_id = ?", id);
  await audit(ctx.user.id, `user-${status}`, `user:${id}`, "");
  return ok(ctx.res, { message: status === "frozen" ? "账号已冻结" : "账号已恢复" });
});
route("GET", "/api/admin/audit", async (ctx) => {
  const denied = adminOnly(ctx);
  if (denied) return denied;
  const rows = await many(`SELECT a.*, u.nickname FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
     ORDER BY a.created_at DESC LIMIT 80`);
  return ok(ctx.res, { logs: rows });
});
/* --- 图片上传（前端已压缩，服务端再限制体积与类型） --- */
route("POST", "/api/uploads", async (ctx) => {
  if (!ctx.user) return fail(ctx.res, 401, "请先登录后上传图片");
  if (!rateLimit(`upload:${ctx.user.id}`, 30, 60000)) return fail(ctx.res, 429, "上传过于频繁");
  const dataUrl = String(ctx.body.dataUrl || "");
  const match = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return fail(ctx.res, 400, "仅支持 PNG / JPEG / WebP 格式的图片");
  const ext = match[1] === "jpeg" ? "jpg" : match[1];
  const buf = Buffer.from(match[2], "base64");
  if (buf.length > 3 * 1024 * 1024) return fail(ctx.res, 413, "单张图片不能超过 3MB");
  const name = `${uid("img")}.${ext}`;
  await writeFile(join(UPLOAD_DIR, name), buf);
  return ok(ctx.res, { url: `/uploads/${name}`, size: buf.length });
});
/* =========================
   静态文件
   ========================= */

async function serveStatic(req, res, pathname) {
  let target;
  if (pathname.startsWith("/uploads/")) {
    target = join(UPLOAD_DIR, normalize(pathname.slice("/uploads/".length)).replace(/^(\.\.[/\\])+/, ""));
  } else {
    target = join(ROOT, normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, ""));
  }
  if (!target.startsWith(ROOT) && !target.startsWith(UPLOAD_DIR)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    let info = await stat(target);
    if (info.isDirectory()) {
      target = join(target, "index.html");
      info = await stat(target);
    }
    const body = await readFile(target);
    res.writeHead(200, {
      "Content-Type": MIME[extname(target).toLowerCase()] || "application/octet-stream",
      "Content-Length": info.size,
      "Cache-Control": target.endsWith(".html") ? "no-cache" : "public, max-age=604800",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    });
    res.end(body);
  } catch {
    try {
      const page = await readFile(join(ROOT, "404.html"));
      res.writeHead(404, { "Content-Type": MIME[".html"], "X-Content-Type-Options": "nosniff" });
      res.end(page);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
    }
  }
}
/* =========================
   启动
   ========================= */
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (!pathname.startsWith("/api/")) {
    return serveStatic(req, res, pathname);
  }

  const parts = pathname.split("/").filter(Boolean);
  const hit = routes.find((r) => {
    if (r.method !== req.method) return false;
    if (r.parts.length !== parts.length) return false;
    return r.parts.every((p, i) => p.startsWith(":") || p === parts[i]);
  });
  if (!hit) return fail(res, 404, `接口不存在：${req.method} ${pathname}`);

  const params = {};
  hit.parts.forEach((p, i) => { if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(parts[i]); });

  try {
    const user = await currentUser(req);
    let body = {};
    if (req.method !== "GET" && req.method !== "DELETE") {
      try { body = await readBody(req); } catch (e) { return fail(res, 400, e.message); }
    }
    const query = Object.fromEntries(url.searchParams.entries());
    const ctx = { req, res, params, query, body, user };
    const result = await hit.handler(ctx);
    if (result === undefined && !res.writableEnded) fail(res, 500, "服务端未返回结果");
  } catch (error) {
    console.error("[api error]", req.method, pathname, error);
    if (res.writableEnded) return;
    /* 携带状态码的业务异常（如订单状态机校验失败） */
    if (error.httpStatus) return fail(res, error.httpStatus, error.message);
    /* 数据库层常见错误转成更明确的响应 */
    if (error.code === "ER_DUP_ENTRY") return fail(res, 409, "数据已存在，请勿重复提交");
    if (error.code === "ER_NO_SUCH_TABLE") {
      return fail(res, 500, "数据表不存在，请先执行 npm run db:init 初始化数据库");
    }
    if (["ECONNREFUSED", "PROTOCOL_CONNECTION_LOST", "ER_ACCESS_DENIED_ERROR"].includes(error.code)) {
      return fail(res, 503, "数据库连接失败，请检查 MySQL 是否启动以及 .env 配置");
    }
    return fail(res, 500, "服务端处理异常，请稍后重试");
  }
});

/* 启动前先确认数据库可用并完成建表/种子数据 */
try {
  const info = await initDatabase();
  console.log(`[db] 已连接 MySQL：${MYSQL_CONFIG.user}@${MYSQL_CONFIG.host}:${MYSQL_CONFIG.port}/${info.database}`);
} catch (error) {
  console.error("\n[db] 数据库初始化失败：", error.message);
  console.error("    请确认：1) MySQL 已启动；2) 已复制 .env.example 为 .env 并填好账号密码；3) 已执行 npm run db:init");
  process.exit(1);
}

server.listen(PORT, () => {
  console.log(`\n智价宝服务已启动：http://localhost:${PORT}`);
  console.log(`  静态站点：http://localhost:${PORT}/`);
  console.log(`  运营后台：http://localhost:${PORT}/admin/  （管理员 18800000000 / admin888）`);
  console.log(`  接口自检：http://localhost:${PORT}/api/health`);
  console.log(`  数据库：MySQL ${MYSQL_CONFIG.host}:${MYSQL_CONFIG.port}/${MYSQL_CONFIG.database}\n`);
});
