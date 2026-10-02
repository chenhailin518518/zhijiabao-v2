const { ready, Store } = require("../../utils/boot.js");
const D = require("../../utils/data.js");
const ui = require("../../utils/ui.js");

/* 排序取值与数据层一致；比价页不提供「性价比优先」，与 Web 版保持一致 */
const SORTS = [
  { label: "热度优先", value: "heat" },
  { label: "最新发布", value: "new" },
  { label: "价格从低到高", value: "price-asc" },
  { label: "价格从高到低", value: "price-desc" },
  { label: "折扣力度", value: "value" }
];

/* 价格上限滑块的边界，与 Web 版 range 输入保持一致 */
const PRICE_MIN = 30;
const PRICE_MAX = 220;

Page({
  data: {
    theme: "light",
    mode: "offline",
    isLogin: false,
    loading: true,

    keyword: "",
    searchHistory: [],

    scenicRange: ["全部景区"],
    categoryRange: ["全部品类"],
    sortRange: SORTS.map((s) => s.label),
    scenicIndex: 0,
    categoryIndex: 0,
    sortIndex: 0,

    priceMin: PRICE_MIN,
    priceMax: PRICE_MAX,
    priceLimit: PRICE_MAX,

    platforms: D.PLATFORMS,

    list: [],
    total: 0
  },

  async onLoad() {
    this.setData({
      theme: getApp().getTheme(),
      scenicRange: ["全部景区", ...D.SCENICS.map((s) => s.id)],
      categoryRange: ["全部品类", ...D.CATEGORIES]
    });
    const mode = await ready();
    this.setData({ mode });
    await this.loadHistory();
    await this.reload();
  },

  onShow() {
    this.setData({ theme: getApp().getTheme() });
  },

  onUnload() {
    if (this.timer) clearTimeout(this.timer);
  },

  onPullDownRefresh() {
    this.reload().finally(() => wx.stopPullDownRefresh());
  },

  /* ---------- 数据 ---------- */

  currentQuery() {
    const { keyword, scenicIndex, categoryIndex, sortIndex, priceLimit } = this.data;
    const query = { status: "在售", limit: 24, sort: SORTS[sortIndex].value };
    if (keyword.trim()) query.keyword = keyword.trim();
    if (scenicIndex > 0) query.scenic = D.SCENICS[scenicIndex - 1].id;
    if (categoryIndex > 0) query.category = D.CATEGORIES[categoryIndex - 1];
    query.priceMax = priceLimit;
    return query;
  },

  toQueryString(query) {
    return Object.entries(query)
      .filter(([, v]) => v !== "" && v !== undefined && v !== null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
  },

  /*
    三价对照与 Web 版一致：
      官方指导价 —— 商品登记的原价（景区官方售价）
      二手成交参考 —— 当前售价的 94%，用于说明二手普遍让价幅度
      本平台建议价 —— 商品当前售价
    并挂上两个第三方平台的同款检索入口。
  */
  decorate(list) {
    return list.map((p) => {
      const original = Math.round(p.original || 0);
      const secondhand = Math.round((p.price || 0) * 0.94);
      const price = Math.round(p.price || 0);
      const spread = original > 0 ? Math.round(((original - price) / original) * 100) : 0;
      return {
        ...p,
        cover: ui.productImage((p.images || [])[0]),
        priceText: ui.money(price),
        originalText: ui.money(original),
        official: original,
        secondhand,
        price,
        spreadText: spread > 0 ? `低于官方价 ${spread}%` : "与官方价持平",
        mallUrl: D.platformSearchUrl("mall", p.name),
        secondhandUrl: D.platformSearchUrl("secondhand", p.name)
      };
    });
  },

  async reload() {
    this.setData({ loading: true });
    try {
      const res = await Store.api(`/api/products?${this.toQueryString(this.currentQuery())}`);
      this.setData({ loading: false, list: this.decorate(res.products || []), total: res.total || 0 });
      await this.recordKeyword();
    } catch (err) {
      this.setData({ loading: false });
      ui.fail(err, "比价数据加载失败");
    }
  },

  /* 有关键词才记录搜索历史，和 Web 版行为一致 */
  async recordKeyword() {
    const kw = this.data.keyword.trim();
    if (!kw) return;
    await Store.api("/api/search-history", { method: "POST", body: { keyword: kw } }).catch(() => null);
    await this.loadHistory();
  },

  async loadHistory() {
    try {
      const res = await Store.api("/api/search-history");
      this.setData({ searchHistory: res.history || [] });
    } catch (err) {
      this.setData({ searchHistory: [] });
    }
  },

  /* ---------- 交互 ---------- */

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
    /* 输入防抖 350ms，避免每个字符都打一次接口 */
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.reload(), 350);
  },

  onSearch() {
    if (this.timer) clearTimeout(this.timer);
    this.reload();
  },

  clearKeyword() {
    this.setData({ keyword: "" });
    this.reload();
  },

  useHistory(e) {
    this.setData({ keyword: e.currentTarget.dataset.kw });
    this.reload();
  },

  async clearHistory() {
    const yes = await ui.confirm("清除后不可恢复，是否继续？", "清空搜索历史");
    if (!yes) return;
    try {
      await Store.api("/api/search-history", { method: "DELETE" });
      this.setData({ searchHistory: [] });
      ui.ok("已清空");
    } catch (err) {
      ui.fail(err, "清空失败");
    }
  },

  onScenicChange(e) {
    this.setData({ scenicIndex: Number(e.detail.value) });
    this.reload();
  },

  onCategoryChange(e) {
    this.setData({ categoryIndex: Number(e.detail.value) });
    this.reload();
  },

  onSortChange(e) {
    this.setData({ sortIndex: Number(e.detail.value) });
    this.reload();
  },

  /* 滑块拖动中只更新文案，松手才打接口 */
  onPriceChanging(e) {
    this.setData({ priceLimit: Number(e.detail.value) });
  },

  onPriceEnd(e) {
    this.setData({ priceLimit: Number(e.detail.value) });
    this.reload();
  },

  resetFilter() {
    this.setData({
      keyword: "",
      scenicIndex: 0,
      categoryIndex: 0,
      sortIndex: 0,
      priceLimit: PRICE_MAX
    });
    this.reload();
  },

  /*
    第三方平台只做关键词检索跳转，不抓取对方页面。
    小程序无法直接打开任意外部网址（web-view 需要已备案的业务域名），
    因此这里复制链接并提示用户到浏览器打开；「本平台建议价」不涉及跳转。
  */
  onPlatform(e) {
    const id = e.currentTarget.dataset.id;
    if (id === "platform") {
      ui.toast("本平台建议价由系统直接给出，无需跳转查看");
      return;
    }
    const p = D.PLATFORMS.find((x) => x.id === id);
    const url = D.platformSearchUrl(id, this.data.keyword.trim() || "景区文创");
    if (!url) {
      ui.toast("该平台暂未提供可跳转的检索入口");
      return;
    }
    wx.setClipboardData({
      data: url,
      success: () => {
        wx.showModal({
          title: p ? p.label : "同款检索",
          content: "检索链接已复制。小程序无法直接打开外部网站，请在浏览器中粘贴访问。",
          showCancel: false,
          confirmText: "知道了"
        });
      }
    });
  },

  openLink(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    /* 卡片上的两个入口是按钮，事件会冒泡到卡片，这里要挡一下跳详情 */
    wx.setClipboardData({ data: url });
    ui.toast("检索链接已复制，请在浏览器中粘贴访问");
  },

  goProduct(e) {
    wx.navigateTo({ url: `/pages/product/product?id=${e.currentTarget.dataset.id}` });
  },

  goEstimate() {
    wx.switchTab({ url: "/pages/estimate/estimate" });
  },

  onShareAppMessage() {
    return { title: "智价宝全网比价 · 官方价 / 二手成交价 / 建议价对照", path: "/pages/compare/compare" };
  }
});
