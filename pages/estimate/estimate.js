const { ready, Store } = require("../../utils/boot.js");
const D = require("../../utils/data.js");
const P = require("../../utils/pricing.js");
const ui = require("../../utils/ui.js");
const Weather = require("../../utils/weather.js");
const Upload = require("../../utils/upload.js");

/* 估价时的分步展示，描述的是真实发生的计算环节 */
const STEP_DURATION = 240;

Page({
  data: {
    theme: "light",
    mode: "offline",
    isLogin: false,

    /* 表单 */
    scenicRange: [],
    categoryRange: [],
    conditionRange: [],
    scenicIndex: 0,
    categoryIndex: 0,
    conditionIndex: 1,
    originalPrice: "268",
    boughtAt: "",
    note: "",
    options: { limited: false, hasCertificate: false, hasPackage: false, flawed: false },

    /* 上传的实拍图（仅留档，不参与计算） */
    photo: "",
    uploadHint: D.uploadHint(),

    weatherText: "",
    weatherIsDegraded: true,

    /* 估价过程与结果 */
    running: false,
    stepLabel: "",
    stepDesc: "",
    stepProgress: 0,
    result: null,

    history: []
  },

  async onLoad() {
    this.setData({
      theme: getApp().getTheme(),
      scenicRange: D.SCENICS.map((s) => s.id),
      categoryRange: D.CATEGORIES,
      conditionRange: D.CONDITIONS.map((c) => `${c.value} · ${c.desc}`)
      /*
        boughtAt 保持为空。
        填成当天会让每次估价都自带「购入 1 年内 +2%」并多加 4 点置信度，
        用户没填却按填了算；原版 Web 的 date 输入框也是空的。
      */
    });
    const mode = await ready();
    this.setData({ mode });
    await this.loadWeather();
    await this.loadHistory();
  },

  onShow() {
    this.setData({ theme: getApp().getTheme() });
  },

  /* ---------- 数据 ---------- */

  async loadWeather() {
    const scenic = this.data.scenicRange[this.data.scenicIndex];
    try {
      const weather = await Weather.getCurrent(scenic);
      this.weather = weather;
      this.setData({
        weatherText: Weather.describe(weather),
        weatherIsDegraded: !!(weather && weather.isDegraded)
      });
    } catch (e) {
      this.weather = null;
      this.setData({ weatherText: "天气数据不可用，按中性因子 1.000 计算", weatherIsDegraded: true });
    }
  },

  async loadHistory() {
    try {
      const me = await Store.api("/api/auth/me");
      if (!me.user) {
        this.setData({ isLogin: false, history: [] });
        return;
      }
      this.setData({ isLogin: true });
      const res = await Store.api("/api/estimates");
      this.setData({
        history: (res.estimates || []).map((e) => ({
          ...e,
          createdText: ui.formatDateTime(e.createdAt),
          resultText: ui.money(e.result),
          rangeText: `${ui.money(e.rangeLow)} – ${ui.money(e.rangeHigh)}`
        }))
      });
    } catch (err) {
      this.setData({ isLogin: false, history: [] });
    }
  },

  /* ---------- 表单 ---------- */

  onScenicChange(e) {
    this.setData({ scenicIndex: Number(e.detail.value) });
    this.loadWeather();
  },

  onCategoryChange(e) {
    this.setData({ categoryIndex: Number(e.detail.value) });
  },

  onConditionChange(e) {
    this.setData({ conditionIndex: Number(e.detail.value) });
  },

  onPriceInput(e) {
    this.setData({ originalPrice: e.detail.value });
  },

  onDateChange(e) {
    this.setData({ boughtAt: e.detail.value });
  },

  onNoteInput(e) {
    this.setData({ note: e.detail.value });
  },

  onOptionChange(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`options.${key}`]: e.detail.value });
  },

  async choosePhoto() {
    try {
      ui.loading("处理图片");
      const path = await Upload.pickOne();
      ui.hideLoading();
      if (!path) return;
      this.setData({ photo: path });
      ui.toast("图片已添加，仅作留档，不参与价格计算");
    } catch (e) {
      ui.hideLoading();
      /* 用户主动取消不提示，其余失败才报 */
      if (e && !e.cancelled) ui.fail(e, "图片添加失败");
    }
  },

  clearPhoto() {
    this.setData({ photo: "" });
  },

  /* ---------- 估价 ---------- */

  async startEstimate() {
    if (this.data.running) return;

    const original = Math.round(Number(this.data.originalPrice) || 0);
    if (original < 1 || original > 200000) {
      ui.toast("请填写 1 至 200000 之间的购买原价");
      return;
    }

    const payload = {
      scenic: this.data.scenicRange[this.data.scenicIndex],
      category: this.data.categoryRange[this.data.categoryIndex],
      condition: D.CONDITIONS[this.data.conditionIndex].value,
      original,
      note: this.data.note.slice(0, 200),
      boughtAt: this.data.boughtAt,
      ...this.data.options
    };

    /* 发布时的字段校验与集市发布共用同一份实现 */
    const check = P.validateProduct(
      { name: "估价商品", scenic: payload.scenic, category: payload.category, condition: payload.condition, price: original, original },
      { requireImages: false }
    );
    if (!check.valid) {
      const first = check.errors.find((e) => ["scenic", "category", "condition", "original"].includes(e.field));
      ui.toast((first || check.errors[0]).message);
      return;
    }

    this.setData({ running: true, result: null });

    const weather = this.weather;
    const steps = [
      ["读取结构化特征", `${payload.condition} / ${payload.category} / 购入 ${payload.boughtAt || "未填写"}`],
      ["匹配景区保值系数", payload.scenic],
      ["采集实时天气", weather && !weather.isDegraded ? `${weather.weatherLabel} ${weather.temperature}°C` : "使用中性因子"],
      ["计算季节与供需", P.getSeasonFactor().label],
      ["加权得出建议价", "多因子乘法模型"],
      ["评估置信度", "字段完整度决定"]
    ];

    for (let i = 0; i < steps.length; i += 1) {
      this.setData({
        stepLabel: steps[i][0],
        stepDesc: steps[i][1],
        stepProgress: Math.round(((i + 1) / steps.length) * 100)
      });
      await new Promise((r) => setTimeout(r, STEP_DURATION));
    }

    const valuation = P.aiValuation(original, payload.condition, payload.scenic, {
      limited: payload.limited,
      hasCertificate: payload.hasCertificate,
      hasPackage: payload.hasPackage,
      flawed: payload.flawed,
      /* 这两项参与「购入时间」加成与置信度，漏传就等于界面填了不算数 */
      boughtAt: payload.boughtAt,
      category: payload.category,
      note: payload.note
    }, weather);

    this.valuation = valuation;
    this.payload = payload;

    this.setData({
      running: false,
      result: {
        resultText: ui.money(valuation.result),
        rangeText: `${ui.money(valuation.low)} – ${ui.money(valuation.high)}`,
        confidence: valuation.confidence,
        retentionText: `${Math.round(valuation.retention * 100)}%`,
        futureText: ui.money(valuation.futureValue),
        scenic: payload.scenic,
        condition: payload.condition,
        originalText: ui.money(original),
        seasonLabel: valuation.factors.seasonLabel,
        weatherNote: weather && !weather.isDegraded
          ? `${weather.weatherLabel} ${weather.temperature}°C`
          : "中性因子 1.000",
        breakdown: valuation.breakdown.map((b) => ({ label: b.label, value: b.value, note: b.note }))
      }
    });

    /* 登录后把这次估价存进记录 */
    if (this.data.isLogin) {
      try {
        await Store.api("/api/estimates", {
          method: "POST",
          body: {
            ...payload,
            result: valuation.result,
            rangeLow: valuation.low,
            rangeHigh: valuation.high,
            confidence: valuation.confidence,
            weather: weather && !weather.isDegraded ? weather : {},
            breakdown: valuation.breakdown
          }
        });
        await this.loadHistory();
      } catch (err) {
        /* 保存失败不影响估价结果展示 */
        console.warn("[estimate] 估价记录保存失败", err);
      }
    }
  },

  resetForm() {
    this.setData({
      result: null,
      photo: "",
      note: "",
      originalPrice: "268",
      options: { limited: false, hasCertificate: false, hasPackage: false, flawed: false }
    });
  },

  async deleteHistory(e) {
    const id = e.currentTarget.dataset.id;
    const yes = await ui.confirm("确认删除这条估价记录？", "删除记录");
    if (!yes) return;
    try {
      await Store.api(`/api/estimates/${id}`, { method: "DELETE" });
      await this.loadHistory();
      ui.ok("已删除");
    } catch (err) {
      ui.fail(err, "删除失败");
    }
  },

  /* 按建议价去发布 */
  goPublish() {
    const v = this.valuation;
    const p = this.payload;
    if (!v || !p) return;
    if (!this.data.isLogin) {
      wx.navigateTo({ url: "/pages/login/login?redirect=publish" });
      return;
    }
    getApp().globalData.publishPrefill = {
      name: `${p.scenic}${p.category}`,
      scenic: p.scenic,
      category: p.category,
      condition: p.condition,
      price: v.result,
      original: p.original,
      description: p.note,
      photo: this.data.photo
    };
    wx.navigateTo({ url: "/pages/publish/publish?from=estimate" });
  },

  goLogin() {
    wx.navigateTo({ url: "/pages/login/login" });
  },

  /* 用户在首页点了「AI 估价」进来，这里做一次浅滚动提示 */
  tipFormula() {
    wx.showModal({
      title: "估价模型",
      content: "建议价 = 购买原价 × 品相系数 × 景区保值系数 × 季节系数 ×（1 + 属性加成）× 关键词修正 × 供需指数。供需指数由景区热度与天气因子共同决定。",
      showCancel: false,
      confirmColor: "#244853"
    });
  },

  onShareAppMessage() {
    return { title: "智价宝 AI 估价 · 景区文创价格参考", path: "/pages/estimate/estimate" };
  }
});
