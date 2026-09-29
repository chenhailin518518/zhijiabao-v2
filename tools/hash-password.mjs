/*
  智价宝 - 密码哈希工具
  与服务端 server/db.mjs 的 hashPassword/verifyPassword 完全一致（scrypt + 随机盐，格式 salt:hash）。
  用途：手动往数据库插入账号时生成 password_hash，或为 server/sql/seed.sql 生成固定盐的演示账号密码。
  用法：
    node tools/hash-password.mjs 你的密码                  # 随机盐
    node tools/hash-password.mjs 你的密码 --salt=固定盐     # 固定盐（便于种子文件可复现）
*/
import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];
if (!password) {
  console.error("用法：node tools/hash-password.mjs <密码> [--salt=固定盐]");
  process.exit(1);
}
const saltArg = process.argv.find((arg) => arg.startsWith("--salt="));
const salt = saltArg ? saltArg.slice("--salt=".length) : randomBytes(16).toString("hex");
const hash = scryptSync(password, salt, 64).toString("hex");
console.log(`${salt}:${hash}`);
