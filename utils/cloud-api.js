/*
  智价宝小程序 · 云端数据层（WorkBuddy 云服务）

  和 utils/store.js 里的 LocalApi 是同一套路由的两种实现：
  页面调用方式一个字都不用改（还是 Store.api("/api/products?...")），
  换掉的只是背后那份数据 —— 本地演示模式落手机存储，云端模式落云数据库。

  业务规则不重复实现：商品校验、订单状态机、信用分、价格走势全部直接用
  utils/pricing.js —— 也就是前端即时反馈用的那一份，两端不会漂移。

  数据落在哪：public schema 下 11 张 zjb_ 开头的表。
  权限由数据库的行级安全（RLS）兜底，不是靠前端过滤：
    公开可读      zjb_profiles / zjb_products / zjb_posts（评价与提问）
    仅本人可读写  zjb_profile_private / zjb_estimates / zjb_refs / zjb_addresses /
                  zjb_messages / zjb_notifications
    买卖双方      zjb_orders（买家是 owner_id，卖家是 seller_id）
  商品状态与卖家余额的联动写在了 zjb_orders 的触发器里，
  所以买家确认收货时不需要（也不允许）去改卖家的商品行。
*/
"use strict";

require("./site-data.js");
require("./pricing.js");

const { getCloud, cloudError } = require("./cloud.js");
const CloudMedia = require("./cloud-media.js");
const Upload = require("./upload.js");

/*
  取业务规则（字典 / 定价引擎）。

  两个来源，按顺序试：
    1. globalThis —— utils/site-data.js 与 utils/pricing.js 是从 Web 版原样搬来的 UMD，
       直接往全局挂载；
    2. require 的返回值 —— pricing.js 同时写了 module.exports，两条路指向同一个对象。

  用取值函数而不是加载时取一次：规则能不能用，不该由「谁先加载」或运行环境决定。
  取成 undefined 的后果很难查 —— P.validateProduct 会变成「读 undefined 的属性」，
  报错跟真实原因完全无关。
*/
const dict = () => globalThis.ZhijabaoData || {};
const pricing = () => globalThis.ZhijabaoPricing || require("./pricing.js") || {};

const clone = (v) => JSON.parse(JSON.stringify(v));
const nowIso = () => new Date().toISOString();
let seq = 0;
const nextId = (prefix) => `${prefix}${Date.now().toString(36)}${(seq += 1).toString(36)}`;

/* 发码与验码要分开两步，中间那个 challenge 必须留在事件处理器外面 */
let pendingOtp = null;

/* 当前身份：getSession() 要读凭据并可能续期，缓存一下避免每次请求都问一遍 */
let cachedUid = "";
let cachedUidAt = 0;
const UID_TTL = 30000;

/* =========================
   基础设施
   ========================= */
function fail(message) {
  const e = new Error(message);
  e.cloud = true;
  throw e;
}

function client() {
  const c = getCloud();
  if (!c) fail(cloudError() || "云服务不可用");
  return c;
}

const db = () => client().database;

/*
  把 SDK 归一化后的错误翻成「能照着做」的中文。
  只按 kind / code 分支，不 match message 文案 —— 文案会变，契约不会。
*/
function translate(error) {
  const e = new Error();
  e.cloud = true;
  const kind = error && error.kind;
  const code = error && error.code;
  const msg = (error && error.message) || "";

  if (kind === "network") {
    e.message = "连不上云服务";
    e.hint = "本次操作未保存到云端，请检查网络后重试。";
    return e;
  }
  if (kind === "backend-unavailable") { e.message = "云服务暂时不可用，请稍后再试"; return e; }
  if (kind === "rate-limited") { e.message = "操作过于频繁，请稍后再试"; return e; }
  if (kind === "credits-exhausted") { e.message = "云服务额度已用尽"; e.hint = "需在「设置 → 数据管理 → 应用」中升级或释放额度后方可继续写入。"; return e; }
  if (kind === "unauthenticated") { e.message = "登录状态已过期，请重新登录"; return e; }
  if (kind === "permission-denied" || code === "42501") {
    e.message = "没有权限操作这条数据";
    e.hint = "该数据不属于当前账号，无权操作。";
    return e;
  }
  if (code === "42P01") { e.message = "云端数据表尚未就绪（错误码 42P01）"; return e; }
  if (code === "23505") { e.message = "这条记录已经存在了"; return e; }
  if (code === "PGRST116") { e.message = "没有找到这条记录"; return e; }
  if (kind === "invalid-request") { e.message = msg || "提交的内容不合法"; return e; }
  e.message = msg || "云端请求失败";
  return e;
}

function unwrap(res, fallback) {
  if (!res) fail(fallback || "云端没有返回结果");
  if (res.error) throw translate(res.error);
  return res.data;
}

async function countOf(query) {
  const res = await query;
  if (res && res.error) throw translate(res.error);
  if (typeof res.count === "number") return res.count;
  return Array.isArray(res.data) ? res.data.length : 0;
}

/* =========================
   会话
   ========================= */
async function currentSession() {
  const res = await client().auth.getSession();
  if (res && res.error) {
    if (res.error.kind === "unauthenticated") return null;
    throw translate(res.error);
  }
  return (res && res.data) || null;
}

async function uid(force) {
  if (!force && cachedUid && Date.now() - cachedUidAt < UID_TTL) return cachedUid;
  const s = await currentSession();
  cachedUid = s && s.user ? String(s.user.id) : "";
  cachedUidAt = Date.now();
  return cachedUid;
}

function setUid(id) {
  cachedUid = id ? String(id) : "";
  cachedUidAt = Date.now();
}

async function requireUid() {
  const id = await uid();
  if (!id) fail("请先登录");
  return id;
}

/* =========================
   公开读表缓存（一次请求内共用）
   ========================= */
async function loadProfiles() {
  const rows = unwrap(await db().from("zjb_profiles").select("*").limit(1000)) || [];
  const map = new Map();
  rows.forEach((r) => map.set(r.owner_id, r));
  return map;
}

async function loadFavorites(productIds, uidValue) {
  if (!productIds.length) return { counts: new Map(), mine: new Set() };
  const rows = unwrap(
    await db().from("zjb_refs").select("owner_id, product_id").eq("kind", "favorite").in("product_id", productIds)
  ) || [];
  const counts = new Map();
  const mine = new Set();
  rows.forEach((r) => {
    counts.set(r.product_id, (counts.get(r.product_id) || 0) + 1);
    if (uidValue && r.owner_id === uidValue) mine.add(r.product_id);
  });
  return { counts, mine };
}

async function loadPosts(kind, productIds) {
  if (!productIds.length) return new Map();
  const rows = unwrap(
    await db().from("zjb_posts").select("*").eq("kind", kind).in("product_id", productIds).order("created_at", { ascending: false })
  ) || [];
  const map = new Map();
  rows.forEach((r) => {
    if (!map.has(r.product_id)) map.set(r.product_id, []);
    map.get(r.product_id).push(r);
  });
  return map;
}

/* =========================
   视图映射（字段名与 LocalApi 对齐，页面不用改）
   ========================= */
function sellerView(row, profiles) {
  const owner = profiles.get(row.owner_id);
  const credit = owner && typeof owner.credit === "number" ? owner.credit : 80;
  return {
    id: row.owner_id || null,
    name: (owner && owner.nickname) || row.seller_name || "平台代管",
    credit,
    level: pricing().creditLevel(credit),
    city: (owner && owner.city) || ""
  };
}

function productView(row, ctx) {
  const reviews = ctx.reviews.get(row.id) || [];
  const avg = reviews.length ? reviews.reduce((a, r) => a + (r.score || 0), 0) / reviews.length : 0;
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
    /* 列表页只画封面，列表响应就只带封面；详情页带全量 */
    images: ctx.coverOnly ? clone((row.images || []).slice(0, 1)) : clone(row.images || []),
    heat: row.heat,
    retention: Number(row.retention),
    views: row.views,
    status: row.status,
    rejectReason: row.reject_reason || "",
    seller: sellerView(row, ctx.profiles),
    reviewCount: reviews.length,
    reviewScore: avg ? Math.round(avg * 10) / 10 : null,
    favoriteCount: ctx.favCounts.get(row.id) || 0,
    createdAt: row.created_at,
    code: `ZJB${String(row.id).toUpperCase()}`
  };
  if (ctx.viewerUid) data.favorited = ctx.favMine.has(row.id);
  if (ctx.withDetail) {
    data.priceHistory = pricing().priceHistory(row);
    data.reviews = reviews.slice(0, 20).map((r) => {
      const from = ctx.profiles.get(r.owner_id);
      const credit = from && typeof from.credit === "number" ? from.credit : undefined;
      return {
        id: r.id,
        score: r.score,
        content: r.body,
        nickname: (from && from.nickname) || r.author_name || "匿名用户",
        credit,
        role: r.role,
        createdAt: r.created_at
      };
    });
    data.questions = (ctx.questions.get(row.id) || []).map((q) => ({
      id: q.id,
      asker: (ctx.profiles.get(q.owner_id) || {}).nickname || q.author_name || "游客",
      body: q.body,
      answer: q.answer || "",
      createdAt: q.created_at,
      answeredAt: q.answered_at || null
    }));
    data.similar = ctx.similar.get(row.id) || [];
  }
  return data;
}

function orderView(row, ctx) {
  const buyer = ctx.profiles.get(row.owner_id);
  const seller = ctx.profiles.get(row.seller_id);
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
    buyer: { id: row.owner_id, name: (buyer && buyer.nickname) || "买家" },
    seller: { id: row.seller_id, name: (seller && seller.nickname) || "卖家" },
    address: clone(row.address || {}),
    timeline: clone(row.timeline || []),
    trackingNo: row.tracking_no || "",
    expressCompany: row.express_company || "",
    cancelReason: row.cancel_reason || "",
    reviewed: ctx.reviewedOrders.has(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function profileView(row, priv, id) {
  const credit = row && typeof row.credit === "number" ? row.credit : 70;
  return {
    id,
    /* 手机号由云服务的账号体系托管，应用侧不再保存一份 */
    phone: "",
    nickname: (row && row.nickname) || "文创用户",
    avatar: (row && row.avatar) || "",
    bio: (row && row.bio) || "",
    city: (row && row.city) || "",
    credit,
    creditLevel: pricing().creditLevel(credit),
    balance: (priv && priv.balance) || 0,
    isAdmin: !!(row && row.is_admin),
    realName: (priv && priv.real_name) || "",
    idNoMasked: (priv && priv.id_no_masked) || "",
    idVerified: !!(priv && priv.id_verified),
    createdAt: (row && row.created_at) || ""
  };
}

/* =========================
   路由辅助
   ========================= */
function parseUrl(path) {
  const raw = String(path || "");
  const cut = raw.indexOf("?");
  const pathname = cut === -1 ? raw : raw.slice(0, cut);
  const params = {};
  if (cut !== -1) {
    raw.slice(cut + 1).split("&").forEach((pair) => {
      if (!pair) return;
      const eq = pair.indexOf("=");
      const k = eq === -1 ? pair : pair.slice(0, eq);
      const v = eq === -1 ? "" : pair.slice(eq + 1);
      try { params[decodeURIComponent(k)] = decodeURIComponent(v); } catch (e) { params[k] = v; }
    });
  }
  return { pathname, q: params };
}

/* PostgREST 的 or 过滤器用逗号分隔、括号分组，关键词里必须先剔掉这些字符 */
const safeKeyword = (kw) => String(kw || "").replace(/[,()%*\\"']/g, "").trim().slice(0, 40);

async function nextProfilePatch(uidValue, patch) {
  const rows = unwrap(await db().from("zjb_profiles").update(patch).eq("owner_id", uidValue).select()) || [];
  if (!rows.length) fail("未做任何改动：该资料不属于当前账号");
  return rows[0];
}

async function notify(ownerId, type, title, body, link) {
  if (!ownerId) return;
  await db().from("zjb_notifications").insert({
    id: nextId("n"), owner_id: ownerId, type, title, body: body || "", link: link || ""
  });
}

/* =========================
   路由表
   ========================= */
async function products(query, viewerUid) {
  let q = db().from("zjb_products").select("*").limit(500);
  const status = query.status || "在售";
  if (status !== "all") q = q.eq("status", status);
  if (query.scenic) q = q.eq("scenic", query.scenic);
  if (query.category) q = q.eq("category", query.category);
  if (query.tag) q = q.eq("tag", query.tag);
  if (query.priceMin) q = q.gte("price", Number(query.priceMin));
  if (query.priceMax) q = q.lte("price", Number(query.priceMax));
  if (query.owner === "me") q = q.eq("owner_id", viewerUid);
  if (query.keyword) {
    const kw = safeKeyword(query.keyword);
    if (kw) q = q.or(`name.ilike.%${kw}%,description.ilike.%${kw}%,scenic.ilike.%${kw}%,category.ilike.%${kw}%`);
  }
  const rows = unwrap(await q) || [];

  /* 排序与分页放在 JS 里做：value（性价比）是按 price/original 排的，PostgREST 排不了表达式，
     放服务端会导致不同排序方式语义不一致 */
  const sorters = {
    heat: (a, b) => b.heat - a.heat,
    new: (a, b) => String(b.created_at).localeCompare(String(a.created_at)),
    "price-asc": (a, b) => a.price - b.price,
    "price-desc": (a, b) => b.price - a.price,
    value: (a, b) => a.price / a.original - b.price / b.original
  };
  rows.sort(sorters[query.sort] || sorters.heat);

  const limit = Math.min(Number(query.limit) || 12, 48);
  const page = Math.max(Number(query.page) || 1, 1);
  const total = rows.length;
  const slice = rows.slice((page - 1) * limit, page * limit);
  const ids = slice.map((r) => r.id);
  const [profiles, favs, reviews] = await Promise.all([
    loadProfiles(), loadFavorites(ids, viewerUid), loadPosts("review", ids)
  ]);
  const productCtx = { profiles, favCounts: favs.counts, favMine: favs.mine, reviews, viewerUid, coverOnly: true };
  return {
    ok: true, total, page, limit, hasMore: page * limit < total,
    products: slice.map((r) => productView(r, productCtx))
  };
}

async function productDetail(id, viewerUid) {
  const rows = unwrap(await db().from("zjb_products").select("*").eq("id", id).limit(1)) || [];
  const row = rows[0];
  if (!row) fail("商品不存在或已下架");
  const profiles = await loadProfiles();
  const isOwner = row.owner_id && row.owner_id === viewerUid;
  if (row.status !== "在售" && !isOwner) fail("该商品当前不可见");

  /* 浏览量 +1；失败不影响浏览本身 */
  db().from("zjb_products").update({ views: (row.views || 0) + 1 }).eq("id", id).then(() => {}, () => {});

  if (viewerUid) {
    const exist = unwrap(await db().from("zjb_refs").select("id").eq("kind", "footprint").eq("owner_id", viewerUid).eq("product_id", id)) || [];
    if (exist.length) {
      await db().from("zjb_refs").update({ created_at: nowIso() }).eq("id", exist[0].id);
    } else {
      await db().from("zjb_refs").insert({ id: nextId("f"), kind: "footprint", product_id: id });
    }
  }

  const [favs, reviews, questions] = await Promise.all([
    loadFavorites([id], viewerUid), loadPosts("review", [id]), loadPosts("question", [id])
  ]);
  const similarRows = unwrap(
    await db().from("zjb_products").select("id, name, price, images, scenic").eq("category", row.category).eq("status", "在售").neq("id", id).limit(3)
  ) || [];
  const similar = new Map([[id, similarRows.map((p) => ({ id: p.id, name: p.name, price: p.price, image: (p.images || [])[0] || "", scenic: p.scenic }))]]);

  const ctx = {
    profiles, favCounts: favs.counts, favMine: favs.mine, reviews, questions, similar,
    viewerUid, coverOnly: false, withDetail: true
  };
  return { ok: true, product: productView(row, ctx) };
}

async function me(uidValue) {
  if (!uidValue) return { ok: true, user: null };

  /* 第一次登录时资料行还不存在，补一条，后续页面才有昵称可用 */
  let row = (unwrap(await db().from("zjb_profiles").select("*").eq("owner_id", uidValue).limit(1)) || [])[0] || null;
  if (!row) {
    const inserted = unwrap(await db().from("zjb_profiles").insert({ nickname: defaultNickname(uidValue) }).select()) || [];
    row = inserted[0] || null;
  }
  if (!row) {
    /* 行级安全没放行写时，先给一份内存里的默认资料，页面不至于拿到 null 崩掉 */
    row = { owner_id: uidValue, nickname: defaultNickname(uidValue), credit: 70, bio: "", city: "", avatar: "" };
  }

  let privateRow = (unwrap(await db().from("zjb_profile_private").select("*").eq("owner_id", uidValue).limit(1)) || [])[0] || null;
  if (!privateRow) {
    const created = await db().from("zjb_profile_private").insert({ owner_id: uidValue }).select();
    privateRow = (created && !created.error && created.data && created.data[0]) || { balance: 0, id_verified: false, real_name: "", id_no_masked: "" };
  }

  const [est, prods, favs, orders, msgs, notices] = await Promise.all([
    countOf(db().from("zjb_estimates").select("*", { count: "exact", head: true }).eq("owner_id", uidValue)),
    countOf(db().from("zjb_products").select("*", { count: "exact", head: true }).eq("owner_id", uidValue)),
    countOf(db().from("zjb_refs").select("*", { count: "exact", head: true }).eq("kind", "favorite").eq("owner_id", uidValue)),
    countOf(db().from("zjb_orders").select("*", { count: "exact", head: true }).or(`owner_id.eq.${uidValue},seller_id.eq.${uidValue}`)),
    countOf(db().from("zjb_messages").select("*", { count: "exact", head: true }).eq("to_user", uidValue).is("read_at", null)),
    countOf(db().from("zjb_notifications").select("*", { count: "exact", head: true }).eq("owner_id", uidValue).is("read_at", null))
  ]);

  return {
    ok: true,
    user: profileView(row, privateRow, uidValue),
    counts: { estimates: est, products: prods, favorites: favs, orders, unreadMsg: msgs, unreadNotice: notices }
  };
}

function defaultNickname(id) {
  const tail = String(id).replace(/[^A-Za-z0-9]/g, "").slice(-4) || "0000";
  return `文创用户${tail}`;
}

/* =========================
   对外的 handle
   ========================= */
async function dispatch(path, method, inputBody, store) {
  const body = inputBody || {};
  const { pathname, q } = parseUrl(path);
  const route = `${method} ${pathname.replace(/\/$/, "")}`;
  const seg = pathname.split("/").filter(Boolean);
  const viewerUid = await uid();

  switch (route) {
    case "GET /api/auth/me":
      return me(viewerUid);

    case "GET /api/products":
      if (q.owner === "me") await requireUid();
      return products(q, viewerUid);

    case "POST /api/products": {
      const id = await requireUid();
      const check = pricing().validateProduct(body);
      if (!check.valid) fail(check.errors[0].message);
      const v = check.value;
      const prof = unwrap(await db().from("zjb_profiles").select("is_admin, nickname").eq("owner_id", id).limit(1)) || [];
      const isAdmin = !!(prof[0] && prof[0].is_admin);
      /* 实拍图在这里上传，库里存对象键 —— 本机 wxfile:// 路径换台手机就是白图 */
      const images = await Upload.toCloud(v.images || []);
      const row = {
        id: nextId("p"),
        name: v.name, scenic: v.scenic, category: v.category, condition: v.condition,
        tag: v.tag, price: v.price, original: v.original, freight: v.freight || 0,
        description: v.description || "", images,
        heat: 60, retention: 0.6, views: 0,
        status: isAdmin ? "在售" : "待审核",
        seller_name: (prof[0] && prof[0].nickname) || "",
        source: "user"
      };
      const created = unwrap(await db().from("zjb_products").insert(row).select()) || [];
      if (!created.length) fail("发布没有成功写入云端");
      await notify(id, "product", "发布已提交审核", `「${row.name}」将在审核通过后上架集市。`, "/pages/market/market");
      return { ok: true, id: row.id, status: row.status, message: "发布成功，等待平台审核后上架" };
    }

    case "GET /api/stats/overview": {
      const [prod, onSale, users, est, done, reviews] = await Promise.all([
        countOf(db().from("zjb_products").select("*", { count: "exact", head: true })),
        countOf(db().from("zjb_products").select("*", { count: "exact", head: true }).eq("status", "在售")),
        countOf(db().from("zjb_profiles").select("*", { count: "exact", head: true })),
        countOf(db().from("zjb_estimates").select("*", { count: "exact", head: true })),
        countOf(db().from("zjb_orders").select("*", { count: "exact", head: true }).eq("status", "已完成")),
        db().from("zjb_posts").select("score").eq("kind", "review")
      ]);
      let scores = [];
      try { scores = (unwrap(reviews) || []).map((r) => r.score || 0); } catch (e) { scores = []; }
      let gmv = 0;
      try {
        const doneRows = unwrap(await db().from("zjb_orders").select("price, freight").eq("status", "已完成")) || [];
        gmv = doneRows.reduce((a, o) => a + o.price + o.freight, 0);
      } catch (e) { gmv = 0; }
      return {
        ok: true,
        overview: {
          products: onSale,
          scenicCount: (dict().SCENICS || []).length,
          categories: (dict().CATEGORIES || []).length,
          users, estimates: est, completedOrders: done, reviews: scores.length,
          avgScore: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0,
          gmv: gmv || 0,
          allProducts: prod
        }
      };
    }

    /* ---- 估价记录 ---- */
    case "GET /api/estimates": {
      if (!viewerUid) return { ok: true, estimates: [] };
      const rows = unwrap(
        await db().from("zjb_estimates").select("*").eq("owner_id", viewerUid).order("created_at", { ascending: false }).limit(50)
      ) || [];
      return {
        ok: true,
        estimates: rows.map((r) => ({ ...(r.payload || {}), id: r.id, userId: viewerUid, createdAt: r.created_at }))
      };
    }
    case "POST /api/estimates": {
      const id = await requireUid();
      const sid = body.id || nextId("e");
      const payload = { ...body };
      delete payload.id;
      unwrap(await db().from("zjb_estimates").insert({ id: sid, payload }).select()) || [];
      /* 只留最近 50 条，和本地模式一致 */
      const keep = unwrap(await db().from("zjb_estimates").select("id").eq("owner_id", id).order("created_at", { ascending: false }).limit(200)) || [];
      const stale = keep.slice(50).map((r) => r.id);
      if (stale.length) await db().from("zjb_estimates").delete().in("id", stale).eq("owner_id", id);
      return { ok: true, id: sid };
    }

    /* ---- 收货地址 ---- */
    case "GET /api/addresses": {
      const id = await requireUid();
      const rows = unwrap(
        await db().from("zjb_addresses").select("*").eq("owner_id", id).order("is_default", { ascending: false }).order("created_at", { ascending: false })
      ) || [];
      return {
        ok: true,
        addresses: rows.map((r) => ({
          id: r.id, userId: id, name: r.name, phone: r.phone, region: r.region,
          detail: r.detail, isDefault: r.is_default ? 1 : 0, created_at: r.created_at, createdAt: r.created_at
        }))
      };
    }
    case "POST /api/addresses": {
      const id = await requireUid();
      const list = unwrap(await db().from("zjb_addresses").select("id, is_default").eq("owner_id", id)) || [];
      if (list.length >= 10) fail("最多可保存 10 个收货地址");
      if (!/^1[3-9]\d{9}$/.test(String(body.phone || ""))) fail("请输入有效收件人手机号");
      if (String(body.detail || "").trim().length < 4) fail("请填写详细地址（不少于 4 个字符）");
      const isDefault = body.isDefault || list.length === 0;
      if (isDefault && list.length) {
        await db().from("zjb_addresses").update({ is_default: false }).eq("owner_id", id);
      }
      const rid = nextId("a");
      unwrap(await db().from("zjb_addresses").insert({
        id: rid, name: String(body.name || "").trim(), phone: body.phone,
        region: body.region || "", detail: String(body.detail).trim(), is_default: !!isDefault
      }).select()) || [];
      return { ok: true, id: rid };
    }

    /* ---- 收藏 / 足迹 / 搜索历史 ---- */
    case "GET /api/favorites": {
      const id = await requireUid();
      const refs = unwrap(await db().from("zjb_refs").select("*").eq("kind", "favorite").eq("owner_id", id)) || [];
      if (!refs.length) return { ok: true, favorites: [] };
      const ids = refs.map((r) => r.product_id);
      const rows = unwrap(await db().from("zjb_products").select("*").in("id", ids)) || [];
      const [profiles, favs, reviews] = await Promise.all([loadProfiles(), loadFavorites(ids, id), loadPosts("review", ids)]);
      const ctx = { profiles, favCounts: favs.counts, favMine: favs.mine, reviews, viewerUid: id, coverOnly: true };
      const byId = new Map(rows.map((r) => [r.id, r]));
      return {
        ok: true,
        favorites: refs.map((ref) => {
          const row = byId.get(ref.product_id);
          if (!row) return null;
          return { ...productView(row, ctx), priceAlert: !!ref.price_alert, alertPrice: ref.alert_price, favAt: ref.created_at };
        }).filter(Boolean)
      };
    }
    case "GET /api/footprints": {
      const id = await requireUid();
      const refs = unwrap(
        await db().from("zjb_refs").select("*").eq("kind", "footprint").eq("owner_id", id).order("created_at", { ascending: false }).limit(200)
      ) || [];
      if (!refs.length) return { ok: true, footprints: [] };
      const ids = refs.map((r) => r.product_id);
      const rows = unwrap(await db().from("zjb_products").select("*").in("id", ids)) || [];
      const [profiles, favs, reviews] = await Promise.all([loadProfiles(), loadFavorites(ids, id), loadPosts("review", ids)]);
      const ctx = { profiles, favCounts: favs.counts, favMine: favs.mine, reviews, viewerUid: id, coverOnly: true };
      const byId = new Map(rows.map((r) => [r.id, r]));
      return {
        ok: true,
        footprints: refs.map((ref) => {
          const row = byId.get(ref.product_id);
          if (!row) return null;
          return { ...productView(row, ctx), viewedAt: ref.created_at };
        }).filter(Boolean)
      };
    }
    case "DELETE /api/footprints": {
      const id = await requireUid();
      await db().from("zjb_refs").delete().eq("kind", "footprint").eq("owner_id", id);
      return { ok: true, message: "浏览足迹已清空" };
    }
    case "GET /api/search-history": {
      if (!viewerUid) return { ok: true, history: [] };
      const rows = unwrap(
        await db().from("zjb_refs").select("keyword").eq("kind", "search").eq("owner_id", viewerUid).order("created_at", { ascending: false }).limit(12)
      ) || [];
      return { ok: true, history: [...new Set(rows.map((r) => r.keyword).filter(Boolean))] };
    }
    case "POST /api/search-history": {
      if (!viewerUid) return { ok: true, history: [] };
      const keyword = safeKeyword(body.keyword);
      if (!keyword) fail("关键词不能为空");
      await db().from("zjb_refs").delete().eq("kind", "search").eq("owner_id", viewerUid).eq("keyword", keyword);
      await db().from("zjb_refs").insert({ id: nextId("s"), kind: "search", keyword });
      return { ok: true, message: "已记录" };
    }
    case "DELETE /api/search-history": {
      const id = await requireUid();
      await db().from("zjb_refs").delete().eq("kind", "search").eq("owner_id", id);
      return { ok: true, message: "搜索历史已清空" };
    }

    /* ---- 订单 ---- */
    case "GET /api/orders": {
      const id = await requireUid();
      const role = q.role || "buyer";
      let query = db().from("zjb_orders").select("*").limit(300);
      if (role === "buyer") query = query.eq("owner_id", id);
      else if (role === "seller") query = query.eq("seller_id", id);
      else query = query.or(`owner_id.eq.${id},seller_id.eq.${id}`);
      if (q.status && q.status !== "all") query = query.eq("status", q.status);
      const rows = unwrap(await query) || [];
      rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      const all = unwrap(await db().from("zjb_orders").select("id, status").or(`owner_id.eq.${id},seller_id.eq.${id}`)) || [];
      const reviews = unwrap(await db().from("zjb_posts").select("order_id").eq("kind", "review")) || [];
      const profiles = await loadProfiles();
      const ctx = { profiles, reviewedOrders: new Set(reviews.map((r) => r.order_id)) };
      return {
        ok: true,
        orders: rows.map((r) => orderView(r, ctx)),
        stats: {
          all: all.length,
          pending: all.filter((o) => o.status === "待付款").length,
          shipping: all.filter((o) => o.status === "待发货").length,
          receiving: all.filter((o) => o.status === "待收货").length,
          done: all.filter((o) => o.status === "已完成").length,
          afterSale: all.filter((o) => ["售后中", "已退款"].includes(o.status)).length
        }
      };
    }
    case "POST /api/orders": {
      const id = await requireUid();
      const rows = unwrap(await db().from("zjb_products").select("*").eq("id", body.productId).limit(1)) || [];
      const product = rows[0];
      if (!product) fail("商品不存在");
      if (product.status !== "在售") fail(`该商品当前状态为「${product.status}」，无法下单`);
      if (product.owner_id === id) fail("不能购买自己发布的商品");
      if (product.owner_id === "seed-platform") fail("演示商品由平台代管，不支持下单，请选择由卖家发布的商品。");

      let address = null;
      if (body.addressId) {
        const found = unwrap(await db().from("zjb_addresses").select("*").eq("id", String(body.addressId)).eq("owner_id", id).limit(1)) || [];
        if (found[0]) {
          address = { name: found[0].name, phone: found[0].phone, region: found[0].region, detail: found[0].detail };
        }
      }
      if (!address) {
        if (!/^1[3-9]\d{9}$/.test(String(body.phone || "")) || String(body.detail || "").length < 4) {
          fail("请填写完整的收货信息或选择已保存地址");
        }
        address = { name: body.name, phone: body.phone, region: body.region, detail: body.detail };
      }

      const t = nowIso();
      const order = {
        id: nextId("o"),
        seller_id: product.owner_id,
        product_id: product.id,
        product_name: product.name,
        product_image: (product.images || [])[0] || "",
        scenic: product.scenic,
        price: product.price,
        freight: product.freight,
        fee: Math.round(product.price * 0.02),
        address,
        status: "待付款",
        timeline: [{ at: t, label: "订单创建", extra: "等待买家付款，款项由平台担保" }]
      };
      const created = unwrap(await db().from("zjb_orders").insert(order).select()) || [];
      if (!created.length) fail("下单没有成功写入云端");
      const profiles = await loadProfiles();
      return { ok: true, order: orderView(created[0], { profiles, reviewedOrders: new Set() }) };
    }

    /* ---- 站内信 / 通知 ---- */
    case "GET /api/conversations": {
      const id = await requireUid();
      const rows = unwrap(
        await db().from("zjb_messages").select("*").or(`owner_id.eq.${id},to_user.eq.${id}`).order("created_at", { ascending: false }).limit(500)
      ) || [];
      const profiles = await loadProfiles();
      const byPeer = new Map();
      rows.forEach((m) => {
        const peer = m.owner_id === id ? m.to_user : m.owner_id;
        if (!peer) return;
        if (!byPeer.has(peer)) {
          byPeer.set(peer, { userId: id, peerId: peer, productId: m.product_id || "", lastBody: m.body, lastAt: m.created_at, unread: 0 });
        }
        if (m.to_user === id && !m.read_at) byPeer.get(peer).unread += 1;
      });
      const peerProfile = (pid) => profiles.get(pid) || {};
      return {
        ok: true,
        conversations: [...byPeer.values()].sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)))
          .map((c) => ({
            ...c,
            peer_name: peerProfile(c.peerId).nickname || "已注销用户",
            peer_credit: peerProfile(c.peerId).credit
          }))
      };
    }
    case "GET /api/messages": {
      const id = await requireUid();
      const peer = String(q.peer || "");
      if (!peer) return { ok: true, messages: [] };
      const rows = unwrap(
        await db().from("zjb_messages").select("*")
          .or(`and(owner_id.eq.${id},to_user.eq.${peer}),and(owner_id.eq.${peer},to_user.eq.${id})`)
          .order("created_at", { ascending: true }).limit(300)
      ) || [];
      await db().from("zjb_messages").update({ read_at: nowIso() }).eq("to_user", id).eq("owner_id", peer).is("read_at", null);
      return {
        ok: true,
        messages: rows.map((m) => ({
          id: m.id, fromUser: m.owner_id, toUser: m.to_user, productId: m.product_id,
          body: m.body, createdAt: m.created_at, readAt: m.read_at
        }))
      };
    }
    case "POST /api/messages": {
      const id = await requireUid();
      const to = String(body.to || "");
      const text = String(body.body || "").trim();
      if (!to || to === id) fail("请选择有效的接收方");
      if (text.length < 1 || text.length > 300) fail("消息长度需为 1-300 个字符");
      const hit = pricing().SENSITIVE_WORDS.filter((w) => text.includes(w));
      if (hit.length) fail(`消息包含违规词：${hit.join("、")}（平台禁止站外交易）`);
      const profiles = await loadProfiles();
      const mine = profiles.get(id) || {};
      unwrap(await db().from("zjb_messages").insert({
        id: nextId("m"), to_user: to, product_id: body.productId || "", body: text,
        author_name: mine.nickname || ""
      }).select()) || [];
      await notify(to, "message", `来自 ${mine.nickname || "对方"} 的消息`, text.slice(0, 40), "/pages/messages/messages");
      return { ok: true, message: "已发送" };
    }
    case "GET /api/notifications": {
      if (!viewerUid) return { ok: true, notifications: [], unread: 0 };
      const rows = unwrap(
        await db().from("zjb_notifications").select("*").eq("owner_id", viewerUid).order("created_at", { ascending: false }).limit(60)
      ) || [];
      return {
        ok: true,
        notifications: rows.map((n) => ({
          id: n.id, userId: viewerUid, type: n.type, title: n.title, body: n.body, link: n.link,
          readAt: n.read_at, createdAt: n.created_at
        })),
        unread: rows.filter((n) => !n.read_at).length
      };
    }
    case "POST /api/notifications/read": {
      const id = await requireUid();
      await db().from("zjb_notifications").update({ read_at: nowIso() }).eq("owner_id", id).is("read_at", null);
      return { ok: true, message: "已标记为已读" };
    }

    /* ---- 埋点 ---- */
    case "POST /api/events": {
      await db().from("zjb_events").insert({
        visitor: String(body.visitor || "v_local").slice(0, 40),
        name: String(body.name || "unknown").slice(0, 40),
        payload: body.payload || {}
      }).then(() => {}, () => {});
      return { ok: true, visitor: body.visitor || "v_local" };
    }

    default:
      break;
  }

  /* ---- 带路径参数的路由 ---- */
  if (seg[1] === "estimates" && seg[2] && method === "DELETE") {
    const id = await requireUid();
    const removed = unwrap(await db().from("zjb_estimates").delete().eq("id", decodeURIComponent(seg[2])).eq("owner_id", id).select()) || [];
    if (!removed.length) fail("该估价记录不存在，或不属于当前账号");
    return { ok: true, message: "已删除" };
  }

  if (seg[1] === "addresses" && seg[2]) {
    const id = await requireUid();
    const rid = decodeURIComponent(seg[2]);
    if (route === `POST /api/addresses/${seg[2]}/default`) {
      await db().from("zjb_addresses").update({ is_default: false }).eq("owner_id", id);
      const rows = unwrap(await db().from("zjb_addresses").update({ is_default: true }).eq("id", rid).eq("owner_id", id).select()) || [];
      if (!rows.length) fail("该收货地址不存在，或不属于当前账号");
      return { ok: true, message: "已设为默认地址" };
    }
    if (route === `DELETE /api/addresses/${seg[2]}`) {
      const rows = unwrap(await db().from("zjb_addresses").delete().eq("id", rid).eq("owner_id", id).select()) || [];
      if (!rows.length) fail("该收货地址不存在，或不属于当前账号");
      return { ok: true, message: "地址已删除" };
    }
  }

  if (seg[1] === "favorites" && seg[2]) {
    const id = await requireUid();
    const pid = decodeURIComponent(seg[2]);
    const products_ = unwrap(await db().from("zjb_products").select("id, price").eq("id", pid).limit(1)) || [];
    const product = products_[0];
    if (!product) fail("商品不存在");

    if (route === `POST /api/favorites/${seg[2]}`) {
      const exist = unwrap(await db().from("zjb_refs").select("id").eq("kind", "favorite").eq("owner_id", id).eq("product_id", pid)) || [];
      if (exist.length) {
        await db().from("zjb_refs").delete().eq("id", exist[0].id);
        return { ok: true, favorited: false, message: "已取消收藏" };
      }
      await db().from("zjb_refs").insert({ id: nextId("v"), kind: "favorite", product_id: pid });
      return { ok: true, favorited: true, message: "已加入收藏" };
    }
    if (route === `POST /api/favorites/${seg[2]}/alert`) {
      const price = Math.round(Number(body.alertPrice));
      if (!Number.isFinite(price) || price <= 0) fail("请输入有效的提醒价格");
      if (price >= product.price) fail(`提醒价需低于当前售价 ¥${product.price}`);
      const exist = unwrap(await db().from("zjb_refs").select("id").eq("kind", "favorite").eq("owner_id", id).eq("product_id", pid)) || [];
      if (exist.length) {
        await db().from("zjb_refs").update({ price_alert: true, alert_price: price }).eq("id", exist[0].id);
      } else {
        await db().from("zjb_refs").insert({ id: nextId("v"), kind: "favorite", product_id: pid, price_alert: true, alert_price: price });
      }
      return { ok: true, message: `已设置降价提醒：低于 ¥${price} 时通知您` };
    }
  }

  if (seg[1] === "products" && seg[2]) {
    const pid = decodeURIComponent(seg[2]);

    if (route === `GET /api/products/${seg[2]}`) return productDetail(pid, viewerUid);

    if (route === `GET /api/products/${seg[2]}/price-history`) {
      const rows = unwrap(await db().from("zjb_products").select("id, price, original, freight").eq("id", pid).limit(1)) || [];
      if (!rows[0]) fail("商品不存在");
      return { ok: true, history: pricing().priceHistory(rows[0]), current: rows[0].price, freight: rows[0].freight };
    }

    if (route === `POST /api/products/${seg[2]}/questions`) {
      const id = await requireUid();
      const rows = unwrap(await db().from("zjb_products").select("id, owner_id, name").eq("id", pid).limit(1)) || [];
      const product = rows[0];
      if (!product) fail("商品不存在");
      const text = String(body.body || "").trim();
      if (text.length < 2 || text.length > 100) fail("问题需为 2-100 个字符");
      const profiles = await loadProfiles();
      const mine = profiles.get(id) || {};
      unwrap(await db().from("zjb_posts").insert({
        id: nextId("q"), kind: "question", product_id: pid, body: text,
        author_name: mine.nickname || ""
      }).select()) || [];
      await notify(product.owner_id, "question", "有买家向您提问", text, `/pages/product/product?id=${pid}`);
      return { ok: true, message: "提问已提交" };
    }

    if (route === `POST /api/products/${seg[2]}/offline`) {
      const id = await requireUid();
      const rows = unwrap(await db().from("zjb_products").select("id, owner_id, status").eq("id", pid).limit(1)) || [];
      const product = rows[0];
      if (!product) fail("商品不存在");
      if (product.owner_id !== id) fail("只能下架自己发布的商品");
      if (product.status === "交易中") fail("交易中的商品不能下架");
      const updated = unwrap(await db().from("zjb_products").update({ status: "已下架" }).eq("id", pid).select()) || [];
      if (!updated.length) fail("下架未生效：该商品不属于当前账号");
      return { ok: true, message: "商品已下架" };
    }

    if (route === `POST /api/products/${seg[2]}/relist`) {
      const id = await requireUid();
      const rows = unwrap(await db().from("zjb_products").select("id, owner_id").eq("id", pid).limit(1)) || [];
      const product = rows[0];
      if (!product) fail("商品不存在");
      if (product.owner_id !== id) fail("只能重新上架本人发布的商品");
      const updated = unwrap(await db().from("zjb_products").update({ status: "待审核" }).eq("id", pid).select()) || [];
      if (!updated.length) fail("重新提交未生效：该商品不属于当前账号");
      return { ok: true, message: "已重新提交审核" };
    }

    if (route === `DELETE /api/products/${seg[2]}`) {
      const id = await requireUid();
      const rows = unwrap(await db().from("zjb_products").select("id, owner_id, status").eq("id", pid).limit(1)) || [];
      const product = rows[0];
      if (!product) fail("商品不存在");
      if (product.owner_id !== id) fail("只能删除自己发布的商品");
      if (product.status === "交易中") fail("交易中的商品不能删除");
      const removed = unwrap(await db().from("zjb_products").delete().eq("id", pid).select()) || [];
      if (!removed.length) fail("删除未生效：该商品不属于当前账号");
      /* 顺手清掉指向它的收藏与足迹，避免收藏列表里出现空条目 */
      await db().from("zjb_refs").delete().eq("product_id", pid).eq("owner_id", id);
      return { ok: true, message: "商品已删除" };
    }
  }

  if (seg[1] === "orders" && seg[2]) {
    const id = await requireUid();
    const oid = decodeURIComponent(seg[2]);
    const rows = unwrap(await db().from("zjb_orders").select("*").eq("id", oid).limit(1)) || [];
    const order = rows[0];
    if (!order) fail("订单不存在");
    const isBuyer = order.owner_id === id;
    const isSeller = order.seller_id === id;
    if (!isBuyer && !isSeller) fail("无权操作该订单");

    if (route === `GET /api/orders/${seg[2]}`) {
      const profiles = await loadProfiles();
      const reviewed = unwrap(await db().from("zjb_posts").select("order_id").eq("kind", "review").eq("order_id", oid)) || [];
      return { ok: true, order: orderView(order, { profiles, reviewedOrders: new Set(reviewed.map((r) => r.order_id)) }) };
    }

    if (route === `POST /api/orders/${seg[2]}/review`) {
      if (order.status !== "已完成") fail("订单完成后才能评价");
      const exist = unwrap(await db().from("zjb_posts").select("id").eq("kind", "review").eq("order_id", oid).eq("owner_id", id)) || [];
      if (exist.length) fail("您已经评价过该订单");
      const score = Math.round(Number(body.score));
      if (!(score >= 1 && score <= 5)) fail("评分需为 1-5 星");
      const toUser = isBuyer ? order.seller_id : order.owner_id;
      const profiles = await loadProfiles();
      const mine = profiles.get(id) || {};
      unwrap(await db().from("zjb_posts").insert({
        id: nextId("r"), kind: "review", product_id: order.product_id, order_id: oid,
        role: isBuyer ? "buyer" : "seller", score,
        body: String(body.content || "").slice(0, 200), author_name: mine.nickname || "", to_user: toUser
      }).select()) || [];
      await notify(toUser, "review", "收到一条新评价", `${score} 星：${body.content || "对方未填写评价内容"}`, "/pages/profile/profile");
      return { ok: true, message: "评价已提交，感谢您的反馈" };
    }

    const transitions = {
      pay: { to: "待发货", label: "买家付款", extra: "款项进入平台担保账户", actor: "buyer", fields: {} },
      confirm: { to: "已完成", label: "买家确认收货", extra: "担保款项已放款给卖家", actor: "buyer", fields: {} },
      cancel: { to: "已取消", label: "订单取消", extra: String(body.reason || "买家取消"), actor: "buyer", fields: { cancel_reason: String(body.reason || "买家取消") } },
      refund: { to: "售后中", label: "买家发起售后", extra: String(body.reason || ""), actor: "buyer", fields: {} },
      "refund-accept": { to: "已退款", label: "卖家同意退款", extra: "款项原路退回买家", actor: "seller", fields: {} },
      ship: {
        to: "待收货", label: "卖家发货",
        extra: `${body.expressCompany || "顺丰速运"} ${body.trackingNo || ""}`,
        actor: "seller",
        fields: { express_company: body.expressCompany || "顺丰速运", tracking_no: String(body.trackingNo || "") }
      }
    };
    const key = seg[3];
    const t = transitions[key];
    if (!t) fail(`云端暂不支持该订单操作。`);
    if (t.actor === "buyer" && !isBuyer) fail("只有买家可以执行该操作");
    if (t.actor === "seller" && !isSeller) fail("只有卖家可以执行该操作");
    if (!pricing().canTransition(order.status, t.to)) fail(`订单当前状态为「${order.status}」，无法变更为「${t.to}」`);
    if (key === "refund" && String(body.reason || "").trim().length < 4) fail("请填写售后原因（不少于 4 个字）");
    if (key === "ship" && t.fields.tracking_no && !/^[A-Za-z0-9-]{6,24}$/.test(t.fields.tracking_no)) fail("快递单号格式不正确");

    const timeline = clone(order.timeline || []);
    timeline.push({ at: nowIso(), label: t.label, extra: t.extra });
    const updated = unwrap(await db().from("zjb_orders").update({
      ...t.fields, status: t.to, timeline, updated_at: nowIso()
    }).eq("id", oid).select()) || [];
    if (!updated.length) fail("状态未变更：该订单不属于当前账号");
    const profiles = await loadProfiles();
    return { ok: true, order: orderView(updated[0], { profiles, reviewedOrders: new Set() }), message: t.label };
  }

  /* 面向用户的提示不含路径；未覆盖的接口在控制台留痕，便于开发期定位 */
  console.warn("[cloud] 云端尚未覆盖该接口：", method, path);
  fail("云端模式暂不支持该操作。");
  return null;
}

/* =========================
   返回值的图片地址替换
   =========================
   数据库里商品图存的是对象键（users/<uid>/products/xxx.jpg），不是能直接显示的地址。
   读接口的返回值统一过一道：对象键 -> 可显示的地址。

   两种来源区别对待，见 utils/cloud-media.js：
    本机刚上传过的  缓存里已经有本地文件路径，直接命中，不额外请求
    别的设备上传的  批量签发一次临时下载地址（一次请求解决整页的图）

   签发失败不打断读请求：没换成功的键原样返回，
   页面上的 utils/ui.js productImage 会退回占位图，不会出现坏图框。
*/
function collectKeys(node, out) {
  if (typeof node === "string") {
    if (CloudMedia.isCloudKey(node) && !CloudMedia.get(node)) out.add(node);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item) => collectKeys(item, out));
    return;
  }
  if (node && typeof node === "object") {
    Object.keys(node).forEach((k) => collectKeys(node[k], out));
  }
}

function replaceKeys(node) {
  if (typeof node === "string") return CloudMedia.get(node) || node;
  if (Array.isArray(node)) return node.map(replaceKeys);
  if (node && typeof node === "object") {
    const out = {};
    Object.keys(node).forEach((k) => { out[k] = replaceKeys(node[k]); });
    return out;
  }
  return node;
}

async function signDeep(payload) {
  const keys = new Set();
  collectKeys(payload, keys);
  const list = [...keys];
  if (!list.length) return replaceKeys(payload);

  try {
    /* 缓存有效期比签名有效期短一截，避免拿到一个马上就到期的地址 */
    const res = await client().storage.createSignedUrls(list, 3600);
    if (res && !res.error && Array.isArray(res.data)) {
      res.data.forEach((item, i) => {
        const path = (item && item.path) || list[i];
        const url = (item && (item.signedUrl || item.signedURL)) || "";
        if (url) CloudMedia.set(path, url, 3000 * 1000);
      });
    }
  } catch (err) {
    console.warn("[cloud] 图片临时地址签发失败", err);
  }
  return replaceKeys(payload);
}

async function handle(path, method, body, store) {
  const result = await dispatch(path, method, body, store);
  try {
    return await signDeep(result);
  } catch (err) {
    /* 替换失败不该让整个请求失败 —— 大不了图片位是占位图 */
    return result;
  }
}

/* =========================
   账号（Auth 模块）
   ========================= */
const auth = {
  async sendCode(phone, purpose) {
    const res = await client().auth.sendOtp({ phone: String(phone || "").trim() });
    if (res.error) throw translate(res.error);
    const data = res.data || {};
    /* 发码与验码是两个动作，challenge 必须留到验码那一步 */
    pendingOtp = { phone: String(phone || "").trim(), verificationId: data.verificationId, isExistingUser: !!data.isExistingUser };
    /* 云端由平台真实下发短信，不会把验证码回显到页面上，所以这里返回空串 */
    if (pendingOtp.isExistingUser === false && purpose === "reset") {
      /* 找回密码在云端走不通：云端手机号账号本身没有应用侧密码，见 resetPassword */
    }
    return "";
  },

  async verify({ phone, code, password }) {
    const p = String(phone || "").trim();
    if (!pendingOtp || pendingOtp.phone !== p) fail("请先获取验证码");
    const res = await client().auth.verifyOtp({
      phone: pendingOtp.phone,
      verificationId: pendingOtp.verificationId,
      isExistingUser: pendingOtp.isExistingUser,
      token: String(code || "").trim(),
      password: pendingOtp.isExistingUser ? undefined : password
    });
    if (res.error) throw translate(res.error);
    const session = res.data;
    pendingOtp = null;
    setUid(session && session.user ? session.user.id : "");
    return session;
  },

  /*
    云端的账号体系里，密码只属于邮箱账号；手机号账号一律走验证码。
    所以这里只接受「手机号 + 验证码」这一种组合，密码登录留给本地演示模式。
  */
  async login({ phone, password, code }) {
    if (password && !code) fail("云端账号使用手机号验证码登录");
    if (!code) fail("请填写验证码");
    await this.verify({ phone, code });
    const id = await uid(true);
    if (!id) fail("登录未获取到身份信息，请重试");
    return (await me(id)).user;
  },

  async register({ phone, code, password, nickname, city }) {
    const p = String(phone || "").trim();
    const nick = String(nickname || "").trim();
    if (nick.length < 2 || nick.length > 16) fail("昵称需为 2-16 个字符");
    if (password && String(password).length < 6) fail("密码至少 6 位");
    await this.verify({ phone: p, code, password });
    const id = await uid(true);
    if (!id) fail("注册后未获取到登录状态，请重试");
    /* 昵称与城市是应用侧的资料，写在自己的资料行上 */
    const patch = { nickname: nick };
    if (city) patch.city = String(city).slice(0, 20);
    const rows = unwrap(await db().from("zjb_profiles").select("owner_id").eq("owner_id", id).limit(1)) || [];
    if (rows.length) await db().from("zjb_profiles").update(patch).eq("owner_id", id);
    else await db().from("zjb_profiles").insert(patch);
    await notify(id, "system", "欢迎加入智价宝", "完成实名认证并售出首件闲置，可提升信用分。", "/pages/profile/profile");
    return (await me(id)).user;
  },

  async resetPassword() {
    fail("云端手机号账号未设置密码，无需重置");
  },

  async logout() {
    const res = await client().auth.signOut();
    if (res && res.error) throw translate(res.error);
    setUid("");
    pendingOtp = null;
  },

  async refresh() {
    return me(await uid(true));
  },

  async updateProfile(payload) {
    const id = await requireUid();
    const patch = {};
    if (payload.nickname !== undefined) {
      const nickname = String(payload.nickname).trim();
      if (nickname.length < 2 || nickname.length > 16) fail("昵称需为 2-16 个字符");
      patch.nickname = nickname;
    }
    if (payload.bio !== undefined) patch.bio = String(payload.bio).slice(0, 60);
    if (payload.city !== undefined) patch.city = String(payload.city).slice(0, 20);
    if (payload.avatar !== undefined) patch.avatar = String(payload.avatar).slice(0, 200000);
    if (!Object.keys(patch).length) return (await me(id)).user;
    await nextProfilePatch(id, patch);
    return (await me(id)).user;
  },

  async verifyRealname({ realName, idNo }) {
    const id = await requireUid();
    if (!/^\d{17}[\dXx]$/.test(String(idNo || ""))) fail("请输入 18 位有效身份证号");
    const name = String(realName || "").trim();
    if (name.length < 2) fail("请输入真实姓名");
    const masked = `${String(idNo).slice(0, 3)}***********${String(idNo).slice(-4)}`;
    const exist = unwrap(await db().from("zjb_profile_private").select("owner_id").eq("owner_id", id).limit(1)) || [];
    if (exist.length) {
      await db().from("zjb_profile_private").update({ real_name: name, id_no_masked: masked, id_verified: true, updated_at: nowIso() }).eq("owner_id", id);
    } else {
      await db().from("zjb_profile_private").insert({ real_name: name, id_no_masked: masked, id_verified: true });
    }
    /* 信用分用自己的资料行算，算完写回自己那份公开资料 */
    await recalcCredit(id);
    await notify(id, "system", "实名认证已通过", "信用分已更新，可发布与交易。", "/pages/profile/profile");
    return (await me(id)).user;
  },

  async withdraw(amount) {
    const id = await requireUid();
    const value = Math.round(Number(amount));
    if (!Number.isFinite(value) || value <= 0) fail("请输入有效提现金额");
    const rows = unwrap(await db().from("zjb_profile_private").select("*").eq("owner_id", id).limit(1)) || [];
    const balance = (rows[0] && rows[0].balance) || 0;
    if (value > balance) fail(`可提现余额不足（当前 ¥${balance}）。`);
    await db().from("zjb_profile_private").update({ balance: balance - value, updated_at: nowIso() }).eq("owner_id", id);
    await notify(id, "wallet", "提现申请已提交", `¥${value} 将在 1-3 个工作日到账（演示）。`, "/pages/profile/profile");
    return (await me(id)).user;
  },

  async closeAccount() {
    const id = await requireUid();
    await db().from("zjb_products").update({ status: "已下架" }).eq("owner_id", id).in("status", ["在售", "待审核"]);
    await db().from("zjb_profiles").update({ status: "deleted", nickname: "已注销用户" }).eq("owner_id", id);
    const res = await client().auth.signOut();
    setUid("");
    if (res && res.error) throw translate(res.error);
  },

  /* 重新计算信用分：规则来自 utils/pricing.js，与本地模式同一份 */
  async recalcCredit(id) {
    return recalcCredit(id);
  }
};

async function recalcCredit(id) {
  const [reviews, orders, priv, prof] = await Promise.all([
    db().from("zjb_posts").select("score").eq("kind", "review").eq("to_user", id),
    db().from("zjb_orders").select("status").or(`owner_id.eq.${id},seller_id.eq.${id}`),
    db().from("zjb_profile_private").select("id_verified").eq("owner_id", id).limit(1),
    db().from("zjb_profiles").select("credit").eq("owner_id", id).limit(1)
  ]);
  const scores = (unwrap(reviews) || []).map((r) => r.score || 0);
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const done = (unwrap(orders) || []).filter((o) => o.status === "已完成").length;
  const verified = !!((unwrap(priv) || [])[0] || {}).id_verified;
  const credit = pricing().calcCredit({ avgScore: avg, reviewCount: scores.length, completedOrders: done, verified });
  const current = (unwrap(prof) || [])[0];
  if (current && current.credit !== credit) {
    await db().from("zjb_profiles").update({ credit }).eq("owner_id", id);
  }
  return credit;
}

/* 启动探测：能不能连上云服务，用一次公开读表来判断，不需要登录 */
async function probe() {
  const c = getCloud();
  if (!c) return { ok: false, reason: cloudError() || "云服务未启用" };
  try {
    const res = await c.database.from("zjb_products").select("id", { count: "exact", head: true });
    if (res && res.error) return { ok: false, reason: translate(res.error).message };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err && err.message) || "云服务探测失败" };
  }
}

module.exports = { handle, auth, probe, currentSession, uid, setUid, fail };
