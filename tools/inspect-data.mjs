/*
  智价宝 - 本地数据检查工具
  用途：在把本地数据库导出为演示快照前，先看清里面有什么（是否含会话令牌、验证码、实名等敏感数据）。
  运行：node tools/inspect-data.mjs
*/
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DATA_DIR = resolve(import.meta.dirname, "..", "server", "data");

if (!existsSync(DATA_DIR)) {
  console.log("server/data 目录不存在：说明本地还没启动过服务，没有可导出的数据。");
  process.exit(0);
}

console.log("server/data 目录内容：");
for (const name of readdirSync(DATA_DIR)) {
  const full = join(DATA_DIR, name);
  const info = statSync(full);
  console.log(`  ${name}${info.isDirectory() ? "  (目录)" : `  ${(info.size / 1024).toFixed(1)}KB`}`);
}

const dbPath = join(DATA_DIR, "zhijiabao.db");
if (!existsSync(dbPath)) {
  console.log("\nzhijiabao.db 不存在，无需导出。");
  process.exit(0);
}

const db = new DatabaseSync(dbPath);
console.log("\n各表数据量：");
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
for (const { name } of tables) {
  const count = db.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get().c;
  if (count > 0) console.log(`  ${name}: ${count}`);
}

const sessions = db.prepare("SELECT COUNT(*) AS c FROM sessions").get().c;
const codes = db.prepare("SELECT COUNT(*) AS c FROM sms_codes").get().c;
console.log(`\n敏感数据自检：`);
console.log(`  会话令牌 sessions: ${sessions} 条${sessions ? "（导出前必须清空）" : ""}`);
console.log(`  短信验证码 sms_codes: ${codes} 条${codes ? "（导出前必须清空）" : ""}`);

const verified = db.prepare(
  "SELECT id, phone, nickname, real_name, id_no_masked FROM users WHERE id_verified = 1"
).all();
console.log(`  已实名用户: ${verified.length} 条`);
for (const row of verified) {
  console.log(`    #${row.id} ${row.nickname} 真名=${row.real_name || "-"} 证件=${row.id_no_masked || "-"}`);
}

const uploads = db.prepare("SELECT id, name, images FROM products WHERE images LIKE '%/uploads/%'").all();
console.log(`  引用本地上传图的商品: ${uploads.length} 条`);
for (const row of uploads.slice(0, 8)) {
  console.log(`    ${row.id} ${row.name} -> ${row.images}`);
}

const uploadDir = join(DATA_DIR, "uploads");
if (existsSync(uploadDir)) {
  const files = readdirSync(uploadDir);
  console.log(`  上传目录文件数: ${files.length}`);
}
