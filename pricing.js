/*
  智价宝 - 纯计算模块（估价引擎 / 订单状态机 / 信用分 / 价格走势 / 表单校验）
  同时可被浏览器（<script>）与 Node（单元测试）加载，因此业务规则只有一份实现。
*/
(function (root, factory) {
  const mod = factory(root);
  if (typeof module === "object" && module.exports) module.exports = mod;
  root.ZhijiabaoPricing = mod;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  "use strict";

  const data = () => root.ZhijiabaoData || null;

  const CONDITION_FACTORS = { "全新": 0.82, "95新": 0.72, "9成新": 0.62, "8成新": 0.48 };

  /* 淡旺季系数：全年四档，按月份取值 */
  function getSeasonFactor(date = new Date()) {
    const month = (date instanceof Date ? date : new Date(date)).getMonth() + 1;
    if (month >= 7 && month <= 8) return { factor: 1.12, label: "暑假旺季" };
    if (month >= 4 && month <= 6) return { factor: 1.08, label: "春游旺季" };
    if (month >= 9 && month <= 11) return { factor: 1.05, label: "秋游旺季" };
    return { factor: 0.92, label: "淡季" };
  }

  function scenicRow(scenicId) {
    const d = data();
    const row = d ? d.matchScenic(scenicId) : null;
    return row || { id: scenicId, city: "", heat: 70, bonus: 1.0, retention: 0.65 };
  }

  /* 结构化属性加成：把“限定/证书/包装/瑕疵”从正则猜测改为明确的开关 */
  function attributeBonus({ limited, hasCertificate, hasPackage, flawed, boughtAt } = {}) {
    const rows = [];
    let bonus = 1;
    if (limited) { bonus += 0.08; rows.push({ label: "限定/联名款", delta: "+8%" }); }
    if (hasCertificate) { bonus += 0.04; rows.push({ label: "带购买凭证或证书", delta: "+4%" }); }
    if (hasPackage) { bonus += 0.03; rows.push({ label: "原包装完整", delta: "+3%" }); }
    if (flawed) { bonus -= 0.05; rows.push({ label: "存在瑕痕", delta: "-5%" }); }
    if (boughtAt) {
      const years = (Date.now() - new Date(boughtAt).getTime()) / (365 * 86400000);
      if (Number.isFinite(years) && years >= 0) {
        if (years <= 1) { bonus += 0.02; rows.push({ label: "购入 1 年内（新近商品）", delta: "+2%" }); }
        else if (years >= 5) { bonus += 0.03; rows.push({ label: "购入 5 年以上（年份溢价）", delta: "+3%" }); }
      }
    }
    return { bonus, rows };
  }

  /* 补充描述关键词修正（仅作为结构化字段之外的补充信号） */
  function keywordBonus(note = "") {
    const text = String(note);
    const rows = [];
    let bonus = 1;
    const rules = [
      { re: /限定|限量|联名|绝版/, delta: 0.05, label: "描述含限定/绝版等稀缺词" },
      { re: /未拆|全新|包装完整|吊牌/, delta: 0.02, label: "描述含包装完整类词汇" },
      { re: /瑕疵|磨损|划痕|使用痕迹|褪色/, delta: -0.04, label: "描述含瑕疵类词汇" },
      { re: /停售|下架|停产/, delta: 0.03, label: "描述含停售/停产信息" }
    ];
    for (const r of rules) {
      if (r.re.test(text)) { bonus += r.delta; rows.push({ label: r.label, delta: `${r.delta > 0 ? "+" : ""}${Math.round(r.delta * 100)}%` }); }
    }
    return { bonus, rows };
  }

  /**
   * 估价主函数
   * @returns {{result:number, low:number, high:number, retention:number, confidence:number, factors:object, breakdown:Array}}
   */
  function aiValuation(original, conditionValue, scenicId, options = {}, weather = null) {
    const originalPrice = Math.max(1, Math.round(Number(original) || 0));
    const condition = CONDITION_FACTORS[conditionValue] ?? CONDITION_FACTORS["95新"];
    const scenic = scenicRow(scenicId);
    const season = getSeasonFactor();
    const attr = attributeBonus(options);
    const keyword = keywordBonus(options.note || "");
    const weatherFactor = weather?.weatherFactor ?? 1.0;
    const conditionDesc = (data()?.CONDITIONS || []).find((c) => c.value === conditionValue)?.desc || "";
    const heatFactor = 0.85 + (scenic.heat / 100) * 0.3;
    const supply = heatFactor * weatherFactor;

    const raw = originalPrice * condition * scenic.bonus * season.factor * attr.bonus * keyword.bonus * supply;
    const result = Math.max(18, Math.round(raw));
    const low = Math.max(15, Math.round(result * 0.88));
    const high = Math.round(result * 1.15);

    /* 置信度：结构化字段越完整、天气数据越完整，置信度越高 */
    let confidence = 72;
    if (weather && !weather.isDegraded) confidence += 8;
    if (options.hasCertificate) confidence += 4;
    if (options.hasPackage) confidence += 3;
    if (options.boughtAt) confidence += 4;
    if (options.category) confidence += 3;
    if (!options.note) confidence -= 4;
    confidence = Math.max(55, Math.min(95, confidence));

    const breakdown = [
      { label: "购买原价", value: `¥${originalPrice}`, note: "用户填写的原购买价" },
      { label: `品相系数（${conditionValue || "95新"}）`, value: condition.toFixed(2), note: conditionDesc },
      { label: `景区保值系数（${scenic.id}）`, value: scenic.bonus.toFixed(2), note: `景区热度 ${scenic.heat}` },
      { label: `季节系数（${season.label}）`, value: season.factor.toFixed(2), note: "按当前月份自动取值" },
      { label: "品相与凭证加成", value: attr.bonus.toFixed(2), note: attr.rows.map((r) => r.label).join("、") || "未勾选附加属性" },
      { label: "描述关键词修正", value: keyword.bonus.toFixed(2), note: keyword.rows.map((r) => r.label).join("、") || "未识别到关键词" },
      { label: "供需指数", value: supply.toFixed(3), note: `热度因子 ${heatFactor.toFixed(2)} × 天气因子 ${weatherFactor.toFixed(3)}` }
    ];

    return {
      result, low, high,
      retention: scenic.retention,
      confidence,
      factors: {
        condition, scenic: scenic.bonus, season: season.factor, attribute: attr.bonus,
        keyword: keyword.bonus, supply, weather: weatherFactor, heat: scenic.heat,
        seasonLabel: season.label
      },
      futureValue: Math.round(result * (1 + scenic.retention * 0.22)),
      breakdown,
      extras: [...attr.rows, ...keyword.rows]
    };
  }

  /* =========================
     订单状态机（前后端共用同一份流转表）
     ========================= */
  const ORDER_FLOW = {
    "待付款": ["待发货", "已取消"],
    "待发货": ["待收货", "售后中"],
    "待收货": ["已完成", "售后中"],
    "已完成": ["售后中"],
    "售后中": ["已完成", "已退款"],
    "已取消": [],
    "已退款": []
  };

  const ORDER_STATUS_STYLE = {
    "待付款": "pending", "待发货": "shipping", "待收货": "receiving",
    "已完成": "done", "已取消": "muted", "售后中": "after", "已退款": "muted"
  };

  const canTransition = (from, to) => (ORDER_FLOW[from] || []).includes(to);

  /* 当前用户在该订单上可以执行的动作 */
  function orderActions(order, userId) {
    if (!order || !userId) return [];
    const isBuyer = order.buyer?.id === userId;
    const isSeller = order.seller?.id === userId;
    const actions = [];
    const add = (action, label, style = "ghost") => actions.push({ action, label, style });
    switch (order.status) {
      case "待付款":
        if (isBuyer) { add("pay", "立即付款", "primary"); add("cancel", "取消订单", "ghost"); }
        break;
      case "待发货":
        if (isSeller) add("ship", "填写快递并发货", "primary");
        if (isBuyer) add("refund", "申请售后", "ghost");
        break;
      case "待收货":
        if (isBuyer) { add("confirm", "确认收货", "primary"); add("refund", "申请售后", "ghost"); }
        break;
      case "已完成":
        if (!order.reviewed && isBuyer) add("review", "评价卖家", "primary");
        if (isBuyer) add("refund", "申请售后", "ghost");
        break;
      case "售后中":
        if (isSeller) add("refund-accept", "同意退款", "primary");
        break;
      default:
        break;
    }
    return actions;
  }

  /* =========================
     信用分（与后端 recalcCredit 规则一致）
     ========================= */
  function calcCredit({ avgScore = 0, reviewCount = 0, completedOrders = 0, verified = false, acceptedReports = 0 } = {}) {
    let score = 70;
    if (reviewCount > 0) score += (avgScore - 3) * 8;
    score += Math.min(completedOrders * 2, 15);
    if (verified) score += 8;
    score -= acceptedReports * 10;
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  const creditLevel = (score) => (score >= 90 ? "优秀" : score >= 80 ? "良好" : score >= 60 ? "一般" : "较低");

  /* =========================
     价格走势（确定性生成，前后端同算法，标注为演示数据）
     ========================= */
  function priceHistory(product, days = 30) {
    const base = Number(product.original) || Number(product.price) || 1;
    let seed = 7;
    for (const ch of String(product.id)) seed = (seed * 31 + ch.charCodeAt(0)) % 9973;
    const series = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const drift = ((seed % 19) - 9) / 100;
      series.push({
        date: new Date(Date.now() - i * 86400000).toISOString().slice(0, 10),
        price: Math.max(5, Math.round(product.price * (1 + drift)))
      });
    }
    series[series.length - 1].price = product.price;
    const prices = series.map((p) => p.price);
    return {
      simulated: true,
      source: "演示数据（按商品基准价确定性生成，非真实成交记录）",
      days,
      low: Math.min(...prices),
      high: Math.max(...prices),
      avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
      series,
      base
    };
  }

  /* =========================
     发布表单校验
     前端即时反馈与服务端权威校验共用这一份规则，返回
       { valid, errors: [{ field, message }], value }
       - 前端用 errors 的 field 定位输入框、message 提示用户
       - 服务端把 errors 映射为消息字符串返回，并用归一化后的 value 直接落库
     选项：
       partial        只校验传入的字段（PATCH 局部更新），value 也只含传入字段
       requireImages  是否强制至少一张实拍图，默认跟随 partial（局部更新不要求）
     ========================= */
  const SENSITIVE_WORDS = [
    "赌博", "刷单", "高仿", "假货", "违禁", "代开发票", "枪支", "管制刀具",
    "色情", "贷款套现", "私接微商", "站外交易", "加微信转账"
  ];

  function validateProduct(input = {}, { partial = false, requireImages = !partial } = {}) {
    const errors = [];
    const out = {};
    const has = (k) => input[k] !== undefined && input[k] !== null;

    /* 字典不可用时退化为“只判非空”，避免因 site-data 未加载而误报全部非法 */
    const D = data();
    const inList = (list, v) => (list.length === 0 ? Boolean(v) : list.includes(v));
    const SCENIC_IDS = (D?.SCENICS || []).map((s) => s.id);
    const CATEGORY_NAMES = D?.CATEGORIES || [];
    const CONDITION_VALUES = (D?.CONDITIONS || []).map((c) => c.value);

    if (has("name") || !partial) {
      const name = String(input.name || "").trim();
      if (name.length < 2 || name.length > 40) errors.push({ field: "name", message: "商品名称需为 2-40 个字符" });
      out.name = name;
    }
    if (has("scenic") || !partial) {
      if (!inList(SCENIC_IDS, input.scenic)) errors.push({ field: "scenic", message: "请选择有效的景区来源" });
      out.scenic = input.scenic;
    }
    if (has("category") || !partial) {
      if (!inList(CATEGORY_NAMES, input.category)) errors.push({ field: "category", message: "请选择有效的商品品类" });
      out.category = input.category;
    }
    if (has("condition") || !partial) {
      if (!inList(CONDITION_VALUES, input.condition)) errors.push({ field: "condition", message: "请选择有效的品相" });
      out.condition = input.condition;
    }
    if (has("tag")) out.tag = String(input.tag || "").slice(0, 12);
    else if (!partial) out.tag = "个人闲置";

    const price = has("price") ? Number(input.price) : NaN;
    if (has("price") || !partial) {
      if (!Number.isFinite(price) || price < 1 || price > 100000) errors.push({ field: "price", message: "期望价需在 1-100000 元之间" });
      out.price = Math.round(price);
    }
    const original = has("original") ? Number(input.original) : NaN;
    if (has("original") || !partial) {
      if (!Number.isFinite(original) || original < 1 || original > 200000) errors.push({ field: "original", message: "原价需在 1-200000 元之间" });
      out.original = Math.round(original);
    }
    if (out.price && out.original && out.price > out.original * 1.2) {
      errors.push({ field: "price", message: `期望价不应高于原价的 120%（当前上限 ¥${Math.round(out.original * 1.2)}）` });
    }

    if (has("freight")) {
      const freight = Number(input.freight === "" ? 0 : input.freight);
      if (!Number.isFinite(freight) || freight < 0 || freight > 200) errors.push({ field: "freight", message: "运费需在 0-200 元之间" });
      out.freight = Math.round(freight);
    } else if (!partial) out.freight = 0;

    const description = String(input.description || "").trim();
    if (description.length > 300) errors.push({ field: "description", message: "品相说明不能超过 300 字" });
    if (has("description") || !partial) out.description = description;

    const images = Array.isArray(input.images) ? input.images : [];
    const maxCount = D?.UPLOAD?.maxCount || 6;
    if (has("images") || !partial) {
      if (requireImages && images.length === 0) errors.push({ field: "images", message: "请至少上传一张商品实拍图" });
      if (images.length > maxCount) errors.push({ field: "images", message: `最多上传 ${maxCount} 张图片` });
      out.images = images.slice(0, maxCount);
    }

    const hit = SENSITIVE_WORDS.filter((w) => `${out.name || ""} ${out.description || ""} ${out.tag || ""}`.includes(w));
    if (hit.length) errors.push({ field: "name", message: `内容包含平台禁售或违规词：${hit.join("、")}` });

    return { valid: errors.length === 0, errors, value: out };
  }

  const money = (n) => `¥${Number(n || 0).toLocaleString("zh-CN")}`;

  return {
    CONDITION_FACTORS,
    ORDER_FLOW,
    ORDER_STATUS_STYLE,
    SENSITIVE_WORDS,
    getSeasonFactor,
    attributeBonus,
    keywordBonus,
    aiValuation,
    canTransition,
    orderActions,
    calcCredit,
    creditLevel,
    priceHistory,
    validateProduct,
    money,
    version: "2.0.0"
  };
});
