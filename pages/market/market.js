const { ready, Store } = require("../../utils/boot.js");
const D = require("../../utils/data.js");
const ui = require("../../utils/ui.js");

/* 排序取值必须与数据层支持的 sorters 键一致 */
const SORTS = [
  { label: "热度优先", value: "heat" },
  { label: "最新发布", value: "new" },
  { label: "价格从低到高", value: "price-asc" },
  { label: "价格从高到低", value: "price-desc" },
  { label: "性价比优先", value: "value" }
];

/* 分区沿用 Web 版语义：商户尾货是「标签=商户尾货」的快捷入口 */
const SEGMENTS = [
  { key: "all", label: "全部" },
  { key: "personal", label: "个人闲置" },
  { key: "merchant", label: "商户尾货" }
];

const PAGE_SIZE = 12;

Page({
  data: {
    theme: "light",
    mode: "offline",
    isLogin: false,
    loading: true,

    keyword: "",
    segment: "all",
    segments: SEGMENTS,

    scenicRange: ["全部景区"],
    categoryRange: ["全部品类"],
    tagRange: ["全部标签"],
    sortRange: SORTS.map((s) => s.label),

    scenicIndex: 0,
    categoryIndex: 0,
    tagIndex: 0,
    sortIndex: 0,

    list: [],
    page: 1,
    hasMore: false,
    total: 0,

    myProducts: []
  },

  async onLoad() {
    this.setData({
      theme: getApp().getTheme(),
      scenicRange: ["全部景区", ...D.SCENICS.map((s) => s.id)],
      categoryRange: ["全部品类", ...D.CATEGORIES],
      tagRange: ["全部标签", ...D.TAGS]
    });
    const mode = await ready();
    this.setData({ mode });
    await this.reload();
    await this.loadMine();
  },

  onShow() {
    this.setData({ theme: getApp().getTheme() });
    /* 首页点品类或景区跳过来时，把筛选条件带进集市 */
    const filter = getApp().globalData.marketFilter;
    if (filter) {
      getApp().globalData.marketFilter = null;
      const patch = {};
      if (filter.category) {
        const idx = this.data.categoryRange.indexOf(filter.category);
        if (idx > 0) patch.categoryIndex = idx;
      }
      if (filter.scenic) {
        const idx = this.data.scenicRange.indexOf(filter.scenic);
        if (idx > 0) patch.scenicIndex = idx;
      }
      if (Object.keys(patch).length) {
        this.setData(patch);
        this.reload();
        return;
      }
    }
    /* 从详情页返回时收藏状态可能变了，静默刷新 */
    if (this.data.list.length) this.reload(true);
  },

  onPullDownRefresh() {
    this.reload().finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasMore) this.loadMore();
  },

  /* ---------- 查询条件 ---------- */

  currentQuery(extra = {}) {
    const { keyword, segment, scenicIndex, categoryIndex, tagIndex, sortIndex } = this.data;
    const query = { status: "在售", limit: PAGE_SIZE, ...extra };
    if (keyword.trim()) query.keyword = keyword.trim();
    if (scenicIndex > 0) query.scenic = D.SCENICS[scenicIndex - 1].id;
    if (categoryIndex > 0) query.category = D.CATEGORIES[categoryIndex - 1];
    const pickedTag = tagIndex > 0 ? D.TAGS[tagIndex - 1] : "";
    /* 商户尾货分区在未单独选标签时，默认按「商户尾货」这个标签过滤 */
    if (segment === "merchant") query.tag = pickedTag || "商户尾货";
    else if (pickedTag) query.tag = pickedTag;
    query.sort = SORTS[sortIndex].value;
    return query;
  },

  toQueryString(query) {
    return Object.entries(query)
      .filter(([, v]) => v !== "" && v !== undefined && v !== null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
  },

  decorate(list) {
    return list.map((p) => ({
      ...p,
      cover: ui.productImage((p.images || [])[0]),
      priceText: ui.money(p.price),
      originalText: ui.money(p.original),
      freightText: p.freight > 0 ? `运费 ${ui.money(p.freight)}` : "包邮",
      statusClass: p.status === "在售" ? "tag-jade" : p.status === "待审核" ? "tag-tea" : "tag-cinnabar"
    }));
  },

  async reload(silent = false) {
    if (!silent) this.setData({ loading: true });
    this.loadingMore = false;
    try {
      const res = await Store.api(`/api/products?${this.toQueryString(this.currentQuery({ page: 1 }))}`);
      this.setData({
        loading: false,
        list: this.decorate(res.products || []),
        page: 1,
        hasMore: !!res.hasMore,
        total: res.total || 0
      });
    } catch (err) {
      this.setData({ loading: false });
      if (!silent) ui.fail(err, "商品列表加载失败");
    }
  },

  async loadMore() {
    /* 触底和「加载更多」按钮都会调这里，不加锁会并发请求同一页并重复追加 */
    if (this.loadingMore || !this.data.hasMore) return;
    this.loadingMore = true;
    const next = this.data.page + 1;
    try {
      const res = await Store.api(`/api/products?${this.toQueryString(this.currentQuery({ page: next }))}`);
      this.setData({
        list: this.data.list.concat(this.decorate(res.products || [])),
        page: next,
        hasMore: !!res.hasMore
      });
    } catch (err) {
      ui.fail(err, "加载更多失败");
    } finally {
      this.loadingMore = false;
    }
  },

  async loadMine() {
    try {
      const me = await Store.api("/api/auth/me");
      if (!me.user) {
        this.setData({ isLogin: false, myProducts: [] });
        return;
      }
      this.setData({ isLogin: true });
      const res = await Store.api("/api/products?owner=me&status=all&limit=48");
      this.setData({
        myProducts: (res.products || []).map((p) => ({
          ...this.decorate([p])[0],
          myActions: this.mineActions(p)
        }))
      });
    } catch (err) {
      this.setData({ isLogin: false, myProducts: [] });
    }
  },

  /* 我的发布可用的操作，按当前状态给出，避免点了才报错 */
  mineActions(p) {
    const actions = [];
    if (p.status === "待审核") return [];
    if (p.status === "在售") actions.push({ key: "offline", label: "下架" });
    if (p.status === "已下架" || p.status === "审核未通过") actions.push({ key: "relist", label: "重新上架" });
    if (p.status !== "交易中") actions.push({ key: "delete", label: "删除", danger: true });
    return actions;
  },

  /* ---------- 交互 ---------- */

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onSearch() {
    this.reload();
  },

  clearKeyword() {
    this.setData({ keyword: "" });
    this.reload();
  },

  switchSegment(e) {
    const segment = e.currentTarget.dataset.key;
    if (segment === this.data.segment) return;
    this.setData({ segment });
    this.reload();
  },

  onScenicChange(e) {
    this.setData({ scenicIndex: Number(e.detail.value) });
    this.reload();
  },

  onCategoryChange(e) {
    this.setData({ categoryIndex: Number(e.detail.value) });
    this.reload();
  },

  onTagChange(e) {
    this.setData({ tagIndex: Number(e.detail.value) });
    this.reload();
  },

  onSortChange(e) {
    this.setData({ sortIndex: Number(e.detail.value) });
    this.reload();
  },

  resetFilter() {
    this.setData({ keyword: "", segment: "all", scenicIndex: 0, categoryIndex: 0, tagIndex: 0, sortIndex: 0 });
    this.reload();
  },

  goProduct(e) {
    wx.navigateTo({ url: `/pages/product/product?id=${e.currentTarget.dataset.id}` });
  },

  goDetailMine(e) {
    this.goProduct(e);
  },

  async mineAction(e) {
    const { id, action, name } = e.currentTarget.dataset;
    if (action === "delete") {
      const yes = await ui.confirm(`删除后不可恢复，确认删除「${name}」？`, "删除商品");
      if (!yes) return;
      try {
        await Store.api(`/api/products/${id}`, { method: "DELETE" });
        ui.ok("已删除");
      } catch (err) {
        ui.fail(err, "删除失败");
      }
    } else {
      try {
        await Store.api(`/api/products/${id}/${action}`, { method: "POST" });
        ui.ok(action === "offline" ? "已下架" : "已重新上架");
      } catch (err) {
        ui.fail(err, "操作失败");
      }
    }
    await this.loadMine();
    await this.reload(true);
  },

  goPublish() {
    if (!this.data.isLogin) {
      wx.navigateTo({ url: "/pages/login/login?redirect=publish" });
      return;
    }
    wx.navigateTo({ url: "/pages/publish/publish" });
  },

  goLogin() {
    wx.navigateTo({ url: "/pages/login/login" });
  },

  onShareAppMessage() {
    return { title: "智价宝集市 · 景区文创闲置流转", path: "/pages/market/market" };
  }
});
