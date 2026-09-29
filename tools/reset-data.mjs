/*
  智价宝 - 重置本地演示数据
  删除 server/data 下的 SQLite 数据库与上传文件，下次启动服务时会重新写入种子数据。
  运行：npm run reset:data
*/
import { rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const DATA_DIR = resolve(import.meta.dirname, "..", "server", "data");

if (!existsSync(DATA_DIR)) {
  console.log("server/data 不存在，无需重置。");
  process.exit(0);
}

const files = readdirSync(DATA_DIR);
let removed = 0;
for (const file of files) {
  if (file === "uploads") {
    rmSync(join(DATA_DIR, "uploads"), { recursive: true, force: true });
    console.log("  已清空 uploads/");
    removed += 1;
    continue;
  }
  /* 演示快照随仓库发布，必须保留 */
  if (file === "demo-seed.db") {
    console.log("  保留 demo-seed.db（仓库自带的演示快照）");
    continue;
  }
  const full = join(DATA_DIR, file);
  if (statSync(full).isFile()) {
    rmSync(full, { force: true });
    console.log(`  已删除 ${file}`);
    removed += 1;
  }
}
console.log(`重置完成，共处理 ${removed} 项。下次启动服务会从演示快照恢复数据（10 件商品、4 笔订单、演示评价与埋点）。`);
