/*
  智价宝 - 单元测试
  覆盖纯计算模块（pricing.js）与前后端共用的业务规则：
  估价模型、订单状态机、信用分、价格走势生成、发布表单校验。
  运行：node tests/unit.mjs
*/
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const ROOT = resolve(import.meta.dirname, "..");
require(join(ROOT, "site-data.js"));
const P = require(join(ROOT, "pricing.js"));
const D = globalThis.ZhijiabaoData;

let passed = 0;
function test(label, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${label}`);
  } catch (error) {
    console.error(`  ✗ ${label}\n    ${error.message}`);
    throw error;
  }
}

console.log("\n单元测试");

test("景区字典覆盖 8 个景区且文化资料完整", () => {
  assert.equal(D.SCENICS.length, 8);
  for (const s of D.SCENICS) {
    assert.ok(s.id && s.city && s.craft && s.tip && s.intro && s.story, `景区 ${s.id} 缺少文化字段`);
    assert.ok(s.heat > 0 && s.retention > 0);
  }
  assert.equal(D.CATEGORIES.length, 10);
  assert.equal(D.CONDITIONS.length, 4);
  assert.equal(D.SEED_PRODUCTS.length, 8);
});

test("历史别名可归一到正式景区名（修复“莫高窟”错配）", () => {
  assert.equal(D.matchScenic("莫高窟").id, "敦煌莫高窟");
  assert.equal(D.matchScenic("敦煌莫高窟").id, "敦煌莫高窟");
  assert.equal(D.matchScenic("杭州西湖").city, "杭州");
  assert.equal(D.matchScenic("不存在的景区"), null);
});

test("季节系数按月份四档取值", () => {
  assert.equal(P.getSeasonFactor(new Date("2026-07-15")).factor, 1.12);
  assert.equal(P.getSeasonFactor(new Date("2026-05-01")).factor, 1.08);
  assert.equal(P.getSeasonFactor(new Date("2026-10-01")).factor, 1.05);
  assert.equal(P.getSeasonFactor(new Date("2026-01-10")).factor, 0.92);
});

test("估价模型：系数可复核且结果落在合理区间", () => {
  const v = P.aiValuation(168, "95新", "故宫博物院", { hasPackage: true, note: "限定款" }, null);
  assert.equal(v.breakdown.length, 7, "应输出 7 项系数明细");
  assert.ok(v.result >= 18, "成交价下限为 18 元");
  assert.ok(v.low < v.result && v.result < v.high, "区间应覆盖建议价");
  assert.ok(v.confidence >= 55 && v.confidence <= 95);
  assert.equal(v.factors.condition, 0.72);
  assert.equal(v.factors.season, P.getSeasonFactor().factor);
});

test("估价模型：品相越低价格越低，好品相必须严格高于差品相", () => {
  const base = 200;
  const fresh = P.aiValuation(base, "全新", "大雁塔", {}, null).result;
  const used = P.aiValuation(base, "95新", "大雁塔", {}, null).result;
  const worn = P.aiValuation(base, "9成新", "大雁塔", {}, null).result;
  const bad = P.aiValuation(base, "8成新", "大雁塔", {}, null).result;
  assert.ok(fresh > used && used > worn && worn > bad, `品相单调性异常：${fresh}/${used}/${worn}/${bad}`);
});

test("估价模型：景区保值系数参与计算且头部景区更高", () => {
  const gugong = P.aiValuation(100, "95新", "故宫博物院", {}, null).result;
  const wuyi = P.aiValuation(100, "95新", "武夷山", {}, null).result;
  assert.ok(gugong > wuyi, "故宫保值系数应高于武夷山");
});

test("估价模型：天气数据可用时提升置信度并影响结果", () => {
  const dry = P.aiValuation(100, "95新", "杭州西湖", {}, null);
  const goodWeather = P.aiValuation(100, "95新", "杭州西湖", {}, { weatherFactor: 1.03, isDegraded: false });
  const badWeather = P.aiValuation(100, "95新", "杭州西湖", {}, { weatherFactor: 0.84, isDegraded: false });
  assert.ok(goodWeather.confidence > dry.confidence, "有真实天气数据时置信度应更高");
  assert.ok(goodWeather.result > badWeather.result, "天气好的估价应更高");
});

test("估价模型：结构化凭证与瑕疵开关生效", () => {
  const plain = P.aiValuation(100, "95新", "平遥古城", {}, null).result;
  const withCert = P.aiValuation(100, "95新", "平遥古城", { hasCertificate: true, hasPackage: true }, null).result;
  const flawed = P.aiValuation(100, "95新", "平遥古城", { flawed: true }, null).result;
  assert.ok(withCert > plain && plain > flawed);
});

test("估价模型：补充描述关键词做有限修正", () => {
  const clean = P.aiValuation(100, "95新", "大雁塔", { note: "正常使用" }, null).result;
  const scarce = P.aiValuation(100, "95新", "大雁塔", { note: "绝版停售" }, null).result;
  const damaged = P.aiValuation(100, "95新", "大雁塔", { note: "有明显划痕" }, null).result;
  assert.ok(scarce > clean && clean > damaged);
});

test("订单状态机：合法流转与非法跳转", () => {
  assert.equal(P.canTransition("待付款", "待发货"), true);
  assert.equal(P.canTransition("待付款", "已完成"), false);
  assert.equal(P.canTransition("待发货", "待收货"), true);
  assert.equal(P.canTransition("待收货", "已完成"), true);
  assert.equal(P.canTransition("已完成", "已退款"), false);
  assert.equal(P.canTransition("售后中", "已退款"), true);
  assert.deepEqual(P.ORDER_FLOW["已退款"], [], "终态不可再流转");
});

test("订单动作：买卖双方看到不同按钮", () => {
  const order = {
    status: "待付款",
    buyer: { id: 3 },
    seller: { id: 2 },
    reviewed: false
  };
  const buyerActions = P.orderActions(order, 3).map((a) => a.action);
  const sellerActions = P.orderActions(order, 2).map((a) => a.action);
  assert.deepEqual(buyerActions, ["pay", "cancel"]);
  assert.deepEqual(sellerActions, [], "待付款阶段卖家无需操作");

  const toShip = { status: "待发货", buyer: { id: 3 }, seller: { id: 2 }, reviewed: false };
  assert.deepEqual(P.orderActions(toShip, 2).map((a) => a.action), ["ship"]);
  assert.deepEqual(P.orderActions(toShip, 3).map((a) => a.action), ["refund"]);

  const done = { status: "已完成", buyer: { id: 3 }, seller: { id: 2 }, reviewed: false };
  assert.deepEqual(P.orderActions(done, 3).map((a) => a.action), ["review", "refund"]);
  assert.deepEqual(P.orderActions({ ...done, reviewed: true }, 3).map((a) => a.action), ["refund"]);
});

test("信用分：好评、成交量、实名加分，被举报扣分", () => {
  assert.equal(P.calcCredit({}), 70, "无记录时基础分 70");
  assert.equal(P.calcCredit({ avgScore: 5, reviewCount: 3 }), 86);
  assert.equal(P.calcCredit({ avgScore: 1, reviewCount: 2 }), 54);
  assert.equal(P.calcCredit({ avgScore: 5, reviewCount: 3, completedOrders: 10, verified: true }), 100, "上限 100");
  assert.equal(P.calcCredit({ acceptedReports: 20 }), 0, "下限 0");
  assert.equal(P.creditLevel(92), "优秀");
  assert.equal(P.creditLevel(55), "较低");
});

test("价格走势：确定性生成、末位等于当前价、标注为演示数据", () => {
  const product = { id: "fan", price: 135, original: 168 };
  const a = P.priceHistory(product, 30);
  const b = P.priceHistory(product, 30);
  assert.deepEqual(a.series, b.series, "同商品多次生成结果必须一致");
  assert.equal(a.series.length, 30);
  assert.equal(a.series.at(-1).price, 135);
  assert.equal(a.simulated, true);
  assert.ok(a.low <= a.avg && a.avg <= a.high);
  const other = P.priceHistory({ id: "cup", price: 76, original: 128 }, 30);
  assert.notDeepEqual(a.series, other.series, "不同商品走势不应相同");
});

test("发布校验：必填、长度、价格与图片规则", () => {
  const base = {
    name: "故宫纪念书签", scenic: "故宫博物院", category: "书签",
    condition: "全新", price: 20, original: 30, description: "全新未拆", images: ["/uploads/a.png"]
  };
  assert.equal(P.validateProduct(base).valid, true);

  const shortName = P.validateProduct({ ...base, name: "书" });
  assert.equal(shortName.valid, false);
  assert.equal(shortName.errors[0].field, "name");

  const badScenic = P.validateProduct({ ...base, scenic: "" });
  assert.equal(badScenic.errors[0].field, "scenic");

  const overPrice = P.validateProduct({ ...base, price: 100 });
  assert.match(overPrice.errors[0].message, /120%/);

  const noImage = P.validateProduct({ ...base, images: [] });
  assert.equal(noImage.errors[0].field, "images");

  const sensitive = P.validateProduct({ ...base, description: "支持刷单冲量" });
  assert.match(sensitive.errors.at(-1).message, /违规词/);

  const tooMany = P.validateProduct({ ...base, images: ["1", "2", "3", "4", "5", "6", "7"] });
  assert.match(tooMany.errors.map((e) => e.message).join("|"), /最多上传 6 张/);

  assert.equal(P.validateProduct({ ...base, images: [] }, { requireImages: false }).valid, true, "非发布场景可不要求图片");
});

test("发布校验：归一化后的 value 与服务端 partial 语义", () => {
  const base = {
    name: "故宫纪念书签", scenic: "故宫博物院", category: "书签",
    condition: "全新", price: 20, original: 30, description: "全新未拆", images: ["/uploads/a.png"]
  };

  /* 非 partial：补齐默认值、trim、图片截断，服务端直接拿 value 落库 */
  const full = P.validateProduct({ ...base, name: "  故宫纪念书签  ", images: ["1", "2", "3", "4", "5", "6", "7"] });
  assert.equal(full.value.name, "故宫纪念书签", "名称应去掉首尾空白");
  assert.equal(full.value.tag, "个人闲置", "未传标签应补默认值");
  assert.equal(full.value.freight, 0, "未传运费应补 0");
  assert.equal(full.value.images.length, 6, "超过 6 张应截断到 6 张");
  assert.deepEqual(Object.keys(full.value).sort(), [
    "category", "condition", "description", "freight", "images", "name", "original", "price", "scenic", "tag"
  ]);

  /* partial：只校验并返回传入字段（PATCH 局部更新） */
  const patch = P.validateProduct({ price: 30 }, { partial: true });
  assert.equal(patch.valid, true);
  assert.deepEqual(Object.keys(patch.value), ["price"]);
  assert.equal(P.validateProduct({ price: 0 }, { partial: true }).valid, false, "局部更新仍要校验取值范围");
  assert.equal(P.validateProduct({}, { partial: true }).valid, true, "局部更新不强制必填");

  /* 字典外取值应被拒绝，而不是只判非空 */
  assert.equal(P.validateProduct({ ...base, scenic: "西湖" }).valid, false, "景区必须是 8 个景区之一");
  assert.equal(P.validateProduct({ ...base, category: "零食" }).valid, false, "品类必须在字典内");
  assert.equal(P.validateProduct({ ...base, condition: "7成新" }).valid, false, "品相必须在字典内");
});

test("敏感词表覆盖站外交易与违禁内容", () => {
  assert.ok(P.SENSITIVE_WORDS.includes("加微信转账"));
  assert.ok(P.SENSITIVE_WORDS.includes("刷单"));
  assert.ok(P.SENSITIVE_WORDS.length >= 10);
});

console.log(`\n单元测试通过：${passed} 项\n`);
