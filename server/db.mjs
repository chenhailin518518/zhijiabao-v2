/*
  智价宝 - 数据层（MySQL 8 / InnoDB / utf8mb4）
  - 连接配置来自 .env 或环境变量（MYSQL_URL 或 MYSQL_HOST/PORT/USER/PASSWORD/DATABASE）
  - 首次启动自动执行 server/sql/schema.sql 与 seed.sql（可重复执行）
  - 统一时间格式 'YYYY-MM-DD HH:MM:SS' + dateStrings，避免时区换算歧义
  - 对外暴露 one / many / run / transaction 四个数据访问原语
*/
import { createPool } from "mysql2/promise";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from "node:crypto";

const here = import.meta.dirname;
const SQL_DIR = join(here, "sql");

/* =========================
   读取 .env（存在则注入环境变量，已有环境变量优先）
   ========================= */
function loadDotEnv() {
  const file = join(here, "..", ".env");
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv();

/* =========================
   连接配置
   ========================= */
function configFromEnv() {
  const url = process.env.MYSQL_URL;
  if (url) {
    try {
      const parsed = new URL(url);
      return {
        host: parsed.hostname || "127.0.0.1",
        port: Number(parsed.port || 3306),
        user: decodeURIComponent(parsed.username || "root"),
        password: decodeURIComponent(parsed.password || ""),
        database: decodeURIComponent((parsed.pathname || "/zhijiabao").slice(1)) || "zhijiabao"
      };
    } catch {
      throw new Error("MYSQL_URL 格式不正确，示例：mysql://zhijiabao:密码@127.0.0.1:3306/zhijiabao");
    }
  }
  return {
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "zhijiabao"
  };
}

export const MYSQL_CONFIG = configFromEnv();

export const pool = createPool({
  ...MYSQL_CONFIG,
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_POOL_SIZE || 10),
  charset: "utf8mb4",
  /* 时间以字符串返回，避免 Node 与 MySQL 时区不一致导致的时间偏移 */
  dateStrings: true,
  timezone: "local",
  multipleStatements: false,
  namedPlaceholders: false
});

/* =========================
   数据访问原语
   参数既支持 one(sql, a, b) 也支持 one(sql, [a, b])，两种写法等价
   ========================= */
function normalizeParams(params) {
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

export async function many(sql, ...params) {
  const [rows] = await pool.query(sql, normalizeParams(params));
  return rows;
}

export async function one(sql, ...params) {
  const rows = await many(sql, ...params);
  return rows.length ? rows[0] : null;
}

export async function run(sql, ...params) {
  const [result] = await pool.query(sql, normalizeParams(params));
  return result;
}

export const count = async (sql, ...params) => Number((await one(sql, ...params))?.c ?? 0);

/* 事务：handler 拿到与连接绑定的 one/many/run，任一异常自动回滚 */
export async function transaction(handler) {
  const conn = await pool.getConnection();
  const scoped = {
    conn,
    one: async (sql, ...params) => (await conn.query(sql, normalizeParams(params)))[0][0] ?? null,
    many: async (sql, ...params) => (await conn.query(sql, normalizeParams(params)))[0],
    run: async (sql, ...params) => (await conn.query(sql, normalizeParams(params)))[0]
  };
  try {
    await conn.beginTransaction();
    const result = await handler(scoped);
    await conn.commit();
    return result;
  } catch (error) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw error;
  } finally {
    conn.release();
  }
}

/* =========================
   时间与编号
   ========================= */
const pad = (n) => String(n).padStart(2, "0");

/** 转成 MySQL DATETIME 字符串 'YYYY-MM-DD HH:MM:SS'（本地时区） */
export function toMysqlTime(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export const now = () => toMysqlTime(new Date());
export const inMinutes = (minutes) => toMysqlTime(new Date(Date.now() + minutes * 60000));
export const inDays = (days) => toMysqlTime(new Date(Date.now() + days * 86400000));
export const uid = (prefix = "id") => `${prefix}-${randomUUID().slice(0, 8)}`;

/* =========================
   密码
   ========================= */
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

/* =========================
   内容安全
   ========================= */
export const SENSITIVE_WORDS = [
  "赌博", "刷单", "高仿", "假货", "违禁", "代开发票", "枪支", "管制刀具",
  "色情", "贷款套现", "私接微商", "站外交易", "加微信转账"
];

export function findSensitive(text) {
  const body = String(text || "");
  return SENSITIVE_WORDS.filter((w) => body.includes(w));
}

/* =========================
   信用分：评价、成交、实名、被举报处置综合计算
   ========================= */
export function creditLevel(score) {
  if (score >= 90) return "优秀";
  if (score >= 80) return "良好";
  if (score >= 60) return "一般";
  return "较低";
}

export async function recalcCredit(userId, scoped = { one, run }) {
  const user = await scoped.one("SELECT id_verified FROM `users` WHERE id = ?", [userId]);
  if (!user) return 0;
  const agg = await scoped.one(
    "SELECT AVG(score) AS avg_score, COUNT(*) AS c FROM `reviews` WHERE to_user = ? AND role = 'buyer'",
    [userId]
  );
  const done = Number((await scoped.one(
    "SELECT COUNT(*) AS c FROM `orders` WHERE status = '已完成' AND (buyer_id = ? OR seller_id = ?)",
    [userId, userId]
  )).c);
  const accepted = Number((await scoped.one(
    "SELECT COUNT(*) AS c FROM `reports` WHERE status = '已处理' AND target_type = 'user' AND target_id = ?",
    [String(userId)]
  )).c);

  let score = 70;
  const reviews = Number(agg?.c || 0);
  if (reviews > 0) score += (Number(agg.avg_score) - 3) * 8;
  score += Math.min(done * 2, 15);
  if (user.id_verified) score += 8;
  score -= accepted * 10;
  score = Math.max(0, Math.min(100, Math.round(score)));
  await scoped.run("UPDATE `users` SET credit = ? WHERE id = ?", [score, userId]);
  return score;
}

export async function notify(userId, type, title, body = "", link = "") {
  if (!userId) return;
  await run(
    "INSERT INTO `notifications` (user_id, `type`, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [userId, type, title, body, link, now()]
  );
}

export async function audit(actorId, action, target = "", detail = "") {
  await run(
    "INSERT INTO `audit_logs` (actor_id, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?)",
    [actorId ?? null, action, target, detail, now()]
  );
}

export function maskIdNo(idNo) {
  const s = String(idNo || "").trim();
  if (s.length < 6) return "";
  return `${s.slice(0, 3)}***********${s.slice(-4)}`;
}

/* =========================
   初始化：建库 + 建表 + 种子数据
   ========================= */
async function runSqlFile(file, { database = MYSQL_CONFIG.database } = {}) {
  const sql = readFileSync(join(SQL_DIR, file), "utf8");
  const conn = await pool.getConnection();
  try {
    if (database) await conn.query(`USE \`${database}\``);
    /* 一次性执行整个脚本，需要 multiStatements；此处用 changeUser 之外的方式：拆分语句 */
    const statements = sql
      .split(/;\s*(?:\r?\n|$)/)
      .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
      .filter(Boolean);
    for (const statement of statements) {
      await conn.query(statement);
    }
  } finally {
    conn.release();
  }
}

/** 确保数据库、表结构与初始数据就绪；force 为 true 时先删库重建 */
export async function initDatabase({ force = false, seed = true } = {}) {
  const dbName = MYSQL_CONFIG.database;

  /* 建库（需要建库权限；无权限时报错信息会提示改用已有库） */
  const rootConn = await pool.getConnection();
  try {
    if (force) await rootConn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    await rootConn.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
    );
  } catch (error) {
    throw new Error(
      `无法创建数据库 ${dbName}（${error.code || error.message}）。` +
      `请先用 root 执行：CREATE DATABASE ${dbName} CHARACTER SET utf8mb4; ` +
      `或把 .env 里的 MYSQL_DATABASE 改成已有数据库。`
    );
  } finally {
    rootConn.release();
  }

  await runSqlFile("schema.sql");
  const hasUsers = await count("SELECT COUNT(*) AS c FROM `users`");
  if (seed && hasUsers === 0) {
    await runSqlFile("seed.sql");
    console.log("[db] 已写入初始演示数据（3 个账号 + 8 件商品 + 评价与问答）");
  }
  return { database: dbName, seeded: hasUsers === 0 };
}

export async function tableStats() {
  const rows = await many(
    `SELECT TABLE_NAME AS name, TABLE_ROWS AS approx_rows
     FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
    [MYSQL_CONFIG.database]
  );
  return rows;
}

export async function closePool() {
  await pool.end();
}
