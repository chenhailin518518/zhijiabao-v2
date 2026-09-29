/*
  智价宝 - 数据库维护工具（MySQL）
  用法：
    node tools/db.mjs init      # 建库 + 建表 + 写入初始演示数据（可重复执行，已有数据不会重复写）
    node tools/db.mjs reset     # 删库重建：清空所有数据后重新建表并写入初始数据（谨慎）
    node tools/db.mjs inspect   # 查看连接信息、各表数据量与最近的业务数据概览
    node tools/db.mjs sql "SELECT ..."   # 执行一条只读 SQL，便于排查
*/
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const action = (process.argv[2] || "inspect").toLowerCase();
const root = resolve(import.meta.dirname, "..");

const {
  initDatabase, tableStats, many, one, MYSQL_CONFIG, closePool
} = await import(join(root, "server", "db.mjs"));

function printConnection() {
  console.log(`连接：${MYSQL_CONFIG.user}@${MYSQL_CONFIG.host}:${MYSQL_CONFIG.port}/${MYSQL_CONFIG.database}`);
  const envFile = join(root, ".env");
  console.log(`配置来源：${existsSync(envFile) ? ".env" : "环境变量 / 默认值"}`);
}

try {
  if (action === "init" || action === "reset") {
    printConnection();
    const info = await initDatabase({ force: action === "reset" });
    console.log(action === "reset" ? "已删库重建。" : "已完成初始化（幂等）。");
    console.log(`数据库：${info.database}`);
    const stats = await tableStats();
    const rows = stats.filter((t) => Number(t.approx_rows) > 0);
    console.log(`包含数据的表：${rows.length ? rows.map((t) => `${t.name}(${t.approx_rows})`).join("、") : "暂无数据"}`);
  } else if (action === "inspect") {
    printConnection();
    const counts = {
      用户: await one("SELECT COUNT(*) AS c FROM `users`"),
      商品: await one("SELECT COUNT(*) AS c FROM `products`"),
      在售: await one("SELECT COUNT(*) AS c FROM `products` WHERE status = '在售'"),
      订单: await one("SELECT COUNT(*) AS c FROM `orders`"),
      已完成订单: await one("SELECT COUNT(*) AS c FROM `orders` WHERE status = '已完成'"),
      评价: await one("SELECT COUNT(*) AS c FROM `reviews`"),
      估价记录: await one("SELECT COUNT(*) AS c FROM `estimates`"),
      会话: await one("SELECT COUNT(*) AS c FROM `sessions`"),
      验证码: await one("SELECT COUNT(*) AS c FROM `sms_codes`"),
      埋点: await one("SELECT COUNT(*) AS c FROM `events`"),
      通知: await one("SELECT COUNT(*) AS c FROM `notifications`"),
      审计日志: await one("SELECT COUNT(*) AS c FROM `audit_logs`"),
      待处理举报: await one("SELECT COUNT(*) AS c FROM `reports` WHERE status = '待处理'")
    };
    console.log("\n数据概览：");
    for (const [label, row] of Object.entries(counts)) console.log(`  ${label}: ${row.c}`);
    const gmv = await one("SELECT COALESCE(SUM(price + freight), 0) AS s FROM `orders` WHERE status = '已完成'");
    console.log(`  GMV: ¥${gmv.s}`);
    console.log("\n各表结构：");
    for (const t of await tableStats()) console.log(`  ${t.name}  约 ${t.approx_rows} 行`);
    console.log("\n最近 5 笔订单：");
    const orders = await many("SELECT id, product_name, status, price, created_at FROM `orders` ORDER BY created_at DESC LIMIT 5");
    for (const o of orders) console.log(`  ${o.id}  ${o.product_name}  ${o.status}  ¥${o.price}  ${o.created_at}`);
  } else if (action === "sql") {
    const sql = process.argv.slice(3).join(" ");
    if (!sql) throw new Error('用法：node tools/db.mjs sql "SELECT ..."');
    if (/^\s*(drop|delete|truncate|update|insert|alter)\b/i.test(sql)) {
      console.log("该命令仅用于排查，拒绝执行写操作。");
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify(await many(sql), null, 2));
    }
  } else {
    console.log("可用命令：init / reset / inspect / sql \"SELECT ...\"");
  }
} catch (error) {
  console.error("\n执行失败：", error.message);
  if (error.code === "ECONNREFUSED") {
    console.error("请确认 MySQL 已启动，并且 .env 中的 MYSQL_HOST / MYSQL_PORT 正确。");
  }
  if (error.code === "ER_ACCESS_DENIED_ERROR") {
    console.error("账号或密码不正确，请检查 .env（可参考 .env.example）。");
  }
  process.exitCode = 1;
} finally {
  await closePool();
}
