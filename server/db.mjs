/*
  智价宝 - 数据层
  零依赖：使用 Node 内置 node:sqlite，无需 npm install。
  表结构覆盖账号、商品、订单、评价、举报、消息、地址、收藏、足迹、估价、埋点、审计。
*/
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from "node:crypto";

const here = import.meta.dirname;
/* 随仓库发布的演示数据库快照（由 tools/export-demo-data.mjs 生成） */
const SEED_SNAPSHOT = join(here, "data", "demo-seed.db");

/* 测试或自定义部署可通过 ZHJ_DATA_DIR 指定数据目录 */
const customDataDir = process.env.ZHJ_DATA_DIR || "";
export const DATA_DIR = customDataDir || join(here, "data");
export const UPLOAD_DIR = join(DATA_DIR, "uploads");
mkdirSync(UPLOAD_DIR, { recursive: true });

export const DB_FILE = join(DATA_DIR, "zhijiabao.db");

/*
  首次启动时优先采用演示快照（含 10 件商品、4 笔订单、评价、埋点等），
  这样克隆仓库后直接 npm start 就有完整可演示的数据；
  指定了 ZHJ_DATA_DIR（测试环境）或设置 ZHJ_USE_SNAPSHOT=0 时改为按代码写入种子数据。
*/
const useSnapshot = !customDataDir && process.env.ZHJ_USE_SNAPSHOT !== "0" && existsSync(SEED_SNAPSHOT);
if (!existsSync(DB_FILE) && useSnapshot) {
  copyFileSync(SEED_SNAPSHOT, DB_FILE);
  console.log("[db] 已从演示快照初始化数据库：server/data/demo-seed.db");
}

export const db = new DatabaseSync(DB_FILE);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA busy_timeout = 4000;");

/* =========================
   建表
   ========================= */
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  nickname TEXT NOT NULL DEFAULT '',
  avatar TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  city TEXT DEFAULT '',
  real_name TEXT DEFAULT '',
  id_no_masked TEXT DEFAULT '',
  id_verified INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  credit INTEGER NOT NULL DEFAULT 70,
  balance INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sms_codes (
  phone TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expire_at TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'login'
);

CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  region TEXT NOT NULL,
  detail TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  owner_id INTEGER,
  name TEXT NOT NULL,
  scenic TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '纪念徽章',
  condition TEXT NOT NULL DEFAULT '95新',
  tag TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL,
  original INTEGER NOT NULL,
  freight INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  images TEXT NOT NULL DEFAULT '[]',
  heat INTEGER NOT NULL DEFAULT 60,
  retention REAL NOT NULL DEFAULT 0.62,
  views INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '在售',
  reject_reason TEXT DEFAULT '',
  seller_name TEXT NOT NULL DEFAULT '平台代管',
  source TEXT NOT NULL DEFAULT 'seed',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_scenic ON products(scenic);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  price_alert INTEGER NOT NULL DEFAULT 0,
  alert_price INTEGER,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS footprints (
  user_id INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  viewed_at TEXT NOT NULL,
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS search_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  keyword TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS estimates (
  id TEXT PRIMARY KEY,
  user_id INTEGER,
  scenic TEXT NOT NULL,
  original INTEGER NOT NULL,
  condition TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  bought_at TEXT DEFAULT '',
  has_certificate INTEGER NOT NULL DEFAULT 0,
  has_package INTEGER NOT NULL DEFAULT 0,
  limited INTEGER NOT NULL DEFAULT 0,
  flawed INTEGER NOT NULL DEFAULT 0,
  result INTEGER NOT NULL,
  range_low INTEGER NOT NULL,
  range_high INTEGER NOT NULL,
  confidence INTEGER NOT NULL DEFAULT 80,
  weather_json TEXT NOT NULL DEFAULT '{}',
  breakdown_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  product_image TEXT NOT NULL DEFAULT '',
  scenic TEXT NOT NULL DEFAULT '',
  buyer_id INTEGER NOT NULL,
  seller_id INTEGER,
  price INTEGER NOT NULL,
  freight INTEGER NOT NULL DEFAULT 0,
  fee INTEGER NOT NULL DEFAULT 0,
  address_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT '待付款',
  timeline TEXT NOT NULL DEFAULT '[]',
  tracking_no TEXT DEFAULT '',
  express_company TEXT DEFAULT '',
  cancel_reason TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_id);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT,
  product_id TEXT NOT NULL,
  from_user INTEGER NOT NULL,
  to_user INTEGER,
  role TEXT NOT NULL DEFAULT 'buyer',
  score INTEGER NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  images TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,
  user_id INTEGER,
  asker TEXT NOT NULL DEFAULT '游客',
  body TEXT NOT NULL,
  answer TEXT DEFAULT '',
  answered_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  user_id INTEGER NOT NULL,
  peer_id INTEGER NOT NULL,
  product_id TEXT NOT NULL DEFAULT '',
  last_body TEXT NOT NULL DEFAULT '',
  last_at TEXT NOT NULL,
  unread INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, peer_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_user INTEGER NOT NULL,
  to_user INTEGER NOT NULL,
  product_id TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'system',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT DEFAULT '',
  read_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_label TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  reporter_id INTEGER,
  status TEXT NOT NULL DEFAULT '待处理',
  handle_note TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  handled_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  visitor TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_name ON events(name);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
`);

/* =========================
   工具
   ========================= */
export const now = () => new Date().toISOString();
export const uid = (prefix = "id") => `${prefix}-${randomUUID().slice(0, 8)}`;

export function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const candidate = scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/* 敏感词过滤：命中即拒绝发布，避免违规内容进入集市 */
export const SENSITIVE_WORDS = [
  "赌博", "刷单", "高仿", "假货", "违禁", "代开发票", "枪支", "管制刀具",
  "色情", "贷款套现", "私接微商", "站外交易", "加微信转账"
];

export function findSensitive(text) {
  const body = String(text || "");
  return SENSITIVE_WORDS.filter((w) => body.includes(w));
}

/* 信用分：80% 起步，叠加评价、成交量、实名、被举报扣分 */
export function recalcCredit(userId) {
  const user = db.prepare("SELECT id_verified FROM users WHERE id = ?").get(userId);
  if (!user) return 0;
  const agg = db.prepare("SELECT AVG(score) AS avg, COUNT(*) AS c FROM reviews WHERE to_user = ? AND role = 'buyer'").get(userId);
  const done = db.prepare(
    "SELECT COUNT(*) AS c FROM orders WHERE status = '已完成' AND (buyer_id = ? OR seller_id = ?)"
  ).get(userId, userId).c;
  const accepted = db.prepare(
    "SELECT COUNT(*) AS c FROM reports WHERE status = '已处理' AND target_type = 'user' AND target_id = ?"
  ).get(String(userId)).c;
  let score = 70;
  if (agg.c > 0) score += (Number(agg.avg) - 3) * 8;
  score += Math.min(done * 2, 15);
  if (user.id_verified) score += 8;
  score -= accepted * 10;
  score = Math.max(0, Math.min(100, Math.round(score)));
  db.prepare("UPDATE users SET credit = ? WHERE id = ?").run(score, userId);
  return score;
}

export function creditLevel(score) {
  if (score >= 90) return "优秀";
  if (score >= 80) return "良好";
  if (score >= 60) return "一般";
  return "较低";
}

export function notify(userId, type, title, body = "", link = "") {
  if (!userId) return;
  db.prepare(
    "INSERT INTO notifications (user_id, type, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(userId, type, title, body, link, now());
}

export function audit(actorId, action, target = "", detail = "") {
  db.prepare(
    "INSERT INTO audit_logs (actor_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(actorId ?? null, action, target, detail, now());
}

export function maskIdNo(idNo) {
  const s = String(idNo || "").trim();
  if (s.length < 6) return "";
  return `${s.slice(0, 3)}***********${s.slice(-4)}`;
}

/* =========================
   种子数据（首次启动写入）
   ========================= */
const SEED_PRODUCTS = [
  { id: "fan", name: "故宫云纹折扇", scenic: "故宫博物院", category: "扇子", condition: "95新", tag: "限定联名", price: 135, original: 168, freight: 0, desc: "宫廷云纹扇面，适合收藏和夏季旅拍，近三日热度上升 18%。", heat: 92, retention: 0.72, seller: "澄禾" },
  { id: "cup", name: "西湖荷影陶瓷杯", scenic: "杭州西湖", category: "杯子茶具", condition: "9成新", tag: "实用文创", price: 76, original: 128, freight: 8, desc: "青釉杯身与荷影纹样，适合作为伴手礼，二手成交速度较快。", heat: 78, retention: 0.58, seller: "湖畔旧物" },
  { id: "bookmark", name: "敦煌飞天金属书签", scenic: "敦煌莫高窟", category: "书签", condition: "全新", tag: "商户尾货", price: 44, original: 69, freight: 6, desc: "轻薄金属材质，适合批量清仓，平台建议活动价 39-45 元。", heat: 65, retention: 0.62, seller: "鸣沙商铺" },
  { id: "pin", name: "黄山迎客松徽章", scenic: "黄山风景区", category: "纪念徽章", condition: "95新", tag: "轻收藏", price: 29, original: 45, freight: 5, desc: "小件高频交易商品，适合作为游客离园后的二次流转入口。", heat: 71, retention: 0.64, seller: "山行者" },
  { id: "tea", name: "武夷山岩茶纪念罐", scenic: "武夷山", category: "茶叶食品", condition: "8成新", tag: "礼盒周边", price: 119, original: 198, freight: 12, desc: "茶罐包装完整但有轻微磨痕，适合展示收藏和低价捡漏。", heat: 58, retention: 0.60, seller: "岩骨花香" },
  { id: "sachet", name: "平遥古城香囊", scenic: "平遥古城", category: "非遗手作", condition: "全新", tag: "非遗手作", price: 38, original: 59, freight: 6, desc: "刺绣纹样保存良好，适合节庆活动和校园文创交换场。", heat: 69, retention: 0.66, seller: "古城手作" },
  { id: "bell", name: "大雁塔祈福铜铃", scenic: "大雁塔", category: "摆件", condition: "9成新", tag: "祈福纪念", price: 72, original: 108, freight: 8, desc: "铜色光泽自然，平台相似商品近期成交价集中在 68-79 元。", heat: 74, retention: 0.67, seller: "长安慢递" },
  { id: "postcard", name: "丽江古城手绘明信片", scenic: "丽江古城", category: "明信片", condition: "全新", tag: "清仓组合", price: 24, original: 35, freight: 4, desc: "套装余量较多，适合商户清仓和游客拼单购买。", heat: 62, retention: 0.55, seller: "木府文创" }
];

const SEED_IMAGES = {
  fan: "assets/img/product-fan.webp",
  cup: "assets/img/product-cup.webp",
  bookmark: "assets/img/product-bookmark.webp",
  pin: "assets/img/product-pin.webp",
  tea: "assets/img/product-tea.webp",
  sachet: "assets/img/product-sachet.webp",
  bell: "assets/img/product-bell.webp",
  postcard: "assets/img/product-postcard.webp"
};

function seed() {
  const hasUser = db.prepare("SELECT COUNT(*) AS c FROM users").get().c > 0;
  if (!hasUser) {
    const t = now();
    db.prepare(
      `INSERT INTO users (phone, password_hash, nickname, bio, city, is_admin, credit, created_at)
       VALUES (?, ?, ?, ?, ?, 1, 96, ?)`
    ).run("18800000000", hashPassword("admin888"), "智价宝运营", "平台运营与内容审核账号", "上海", t);
    db.prepare(
      `INSERT INTO users (phone, password_hash, nickname, bio, city, credit, created_at)
       VALUES (?, ?, ?, ?, ?, 88, ?)`
    ).run("18800000001", hashPassword("demo1234"), "澄禾", "故宫文创收藏爱好者", "北京", t);
    db.prepare(
      `INSERT INTO users (phone, password_hash, nickname, bio, city, credit, created_at)
       VALUES (?, ?, ?, ?, ?, 84, ?)`
    ).run("18800000002", hashPassword("demo1234"), "湖畔旧物", "杭州景区文创尾货卖家", "杭州", t);
  }

  const hasProduct = db.prepare("SELECT COUNT(*) AS c FROM products").get().c > 0;
  if (!hasProduct) {
    const t = now();
    const insert = db.prepare(
      `INSERT INTO products (id, owner_id, name, scenic, category, condition, tag, price, original, freight,
        description, images, heat, retention, views, status, seller_name, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '在售', ?, 'seed', ?)`
    );
    const ownerBySeller = { "澄禾": 2, "湖畔旧物": 3 };
    for (const p of SEED_PRODUCTS) {
      insert.run(
        p.id, ownerBySeller[p.seller] ?? null, p.name, p.scenic, p.category, p.condition, p.tag,
        p.price, p.original, p.freight, p.desc, JSON.stringify([SEED_IMAGES[p.id]]),
        p.heat, p.retention, 120 + p.heat * 3, p.seller, t
      );
    }
  }

  const hasReview = db.prepare("SELECT COUNT(*) AS c FROM reviews").get().c > 0;
  if (!hasReview) {
    const t = now();
    const rows = [
      ["fan", 2, "故宫云纹折扇", 5, "扇面完好，包装也很仔细，和景区买的一模一样。", "描述相符,发货快"],
      ["fan", 2, "故宫云纹折扇", 4, "折扇做工不错，扇骨有点紧，整体满意。", "包装仔细"],
      ["cup", 3, "西湖荷影陶瓷杯", 5, "杯身没有磕碰，比景区便宜一半。", "价格实惠,描述相符"],
      ["pin", 1, "黄山迎客松徽章", 4, "徽章背面有轻微划痕，卖家提前说明了，可以接受。", "如实描述"],
      ["bookmark", 1, "敦煌飞天金属书签", 5, "书签很精致，适合送人。", "发货快"]
    ];
    const insert = db.prepare(
      `INSERT INTO reviews (order_id, product_id, from_user, to_user, role, score, content, images, created_at)
       VALUES (NULL, ?, ?, ?, 'buyer', ?, ?, '[]', ?)`
    );
    for (const [pid, from, , score, content] of rows) {
      const product = db.prepare("SELECT owner_id FROM products WHERE id = ?").get(pid);
      insert.run(pid, from, product?.owner_id ?? null, score, content, t);
    }
  }

  const hasQuestion = db.prepare("SELECT COUNT(*) AS c FROM questions").get().c > 0;
  if (!hasQuestion) {
    const t = now();
    const insert = db.prepare(
      `INSERT INTO questions (product_id, user_id, asker, body, answer, answered_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const rows = [
      ["fan", 1, "游客小林", "扇子有原来的包装盒吗？想送人。", "有原装锦盒，盒子边角有一道压痕，发货时会加固。", t, t],
      ["cup", 1, "文创爱好者", "杯子能装热水吗？容量多少？", "陶瓷杯可装热水，容量约 350ml，建议不要微波。", t, t],
      ["tea", 1, "茶友阿成", "茶罐里还有茶吗？", "罐内茶叶已用完，售卖的是纪念罐本身。", t, t]
    ];
    for (const r of rows) insert.run(...r);
  }
}

seed();
