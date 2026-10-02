const { ready, Store } = require("../../utils/boot.js");
const P = require("../../utils/pricing.js");
const ui = require("../../utils/ui.js");

/* 状态页签与接口 status 取值一一对应 */
const TABS = [
  { key: "all", label: "全部", statKey: "all" },
  { key: "待付款", label: "待付款", statKey: "pending" },
  { key: "待发货", label: "待发货", statKey: "shipping" },
  { key: "待收货", label: "待收货", statKey: "receiving" },
  { key: "已完成", label: "已完成", statKey: "done" },
  { key: "售后中", label: "售后", statKey: "afterSale" }
];

const ROLES = [
  { key: "all", label: "全部" },
  { key: "buyer", label: "我买到的" },
  { key: "seller", label: "我卖出的" }
];

const STATUS_CLASS = {
  "待付款": "tag-cinnabar",
  "待发货": "tag-tea",
  "待收货": "tag-tea",
  "已完成": "tag-jade",
  "售后中": "tag-cinnabar",
  "已退款": "tag",
  "已取消": "tag"
};

Page({
  data: {
    theme: "light",
    tabs: TABS,
    roles: ROLES,
    status: "all",
    role: "buyer",
    loading: true,
    orders: [],
    stats: {},
    expanded: "",
    userId: 0
  },

  async onLoad(query) {
    this.setData({ theme: getApp().getTheme() });
    await ready();
    const me = await Store.api("/api/auth/me");
    if (!me.user) {
      wx.redirectTo({ url: "/pages/login/login?redirect=orders" });
      return;
    }
    this.setData({ userId: me.user.id });
    await this.refresh();
    /* 从商品详情下单后跳过来，自动展开那一单 */
    if (query.focus) this.setData({ expanded: query.focus });
  },

  onShow() {
    this.setData({ theme: getApp().getTheme() });
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh());
  },

  switchStatus(e) {
    this.setData({ status: e.currentTarget.dataset.key });
    this.refresh();
  },

  switchRole(e) {
    this.setData({ role: e.currentTarget.dataset.key });
    this.refresh();
  },

  async refresh() {
    this.setData({ loading: true });
    const { status, role } = this.data;
    try {
      const query = `?status=${encodeURIComponent(status)}&role=${role}`;
      const res = await Store.api(`/api/orders${query}`);
      this.setData({
        loading: false,
        stats: res.stats || {},
        orders: (res.orders || []).map((o) => this.decorate(o))
      });
    } catch (err) {
      this.setData({ loading: false });
      if (/请先登录/.test(err.message || "")) {
        wx.redirectTo({ url: "/pages/login/login?redirect=orders" });
        return;
      }
      ui.fail(err, "订单加载失败");
    }
  },

  decorate(o) {
    const me = this.data.userId;
    const isBuyer = o.buyer && o.buyer.id === me;
    return {
      ...o,
      cover: ui.productImage(o.productImage),
      priceText: ui.money(o.price),
      freightText: ui.money(o.freight),
      feeText: ui.money(o.fee),
      totalText: ui.money(o.total),
      createdText: ui.formatDateTime(o.createdAt),
      statusClass: STATUS_CLASS[o.status] || "tag",
      roleLabel: isBuyer ? "我买到的" : "我卖出的",
      peerLabel: isBuyer ? `卖家 ${o.seller ? o.seller.name : ""}` : `买家 ${o.buyer ? o.buyer.name : ""}`,
      /* 可执行操作直接复用定价引擎里的状态机，与 Web 版保持同一套规则 */
      actions: P.orderActions(o, me).map((a) => ({
        ...a,
        css: a.style === "primary" ? "btn" : "btn btn-ghost"
      })),
      timeline: (o.timeline || []).slice().reverse().map((t) => ({
        ...t,
        atText: ui.formatDateTime(t.at)
      }))
    };
  },

  toggleExpand(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ expanded: this.data.expanded === id ? "" : id });
  },

  async act(e) {
    const { id, action } = e.currentTarget.dataset;
    const order = this.data.orders.find((o) => o.id === id);
    if (!order) return;

    let body = null;
    try {
      if (action === "pay") {
        const yes = await ui.confirm(
          `应付 ${order.totalText}（商品 ${order.priceText} + 运费 ${order.freightText}）。\n当前为演示流程，不产生真实扣款。`,
          "确认付款"
        );
        if (!yes) return;
        body = {};
      } else if (action === "cancel") {
        const reason = await ui.prompt("请填写取消原因", "取消订单", "例如：买家临时不再需要");
        if (reason === null) return;
        body = { reason: reason || "买家取消" };
      } else if (action === "refund") {
        const reason = await ui.prompt("请填写售后原因（不少于 4 个字）", "申请售后", "例如：收到时有破损");
        if (!reason) return;
        if (reason.length < 4) return ui.toast("售后原因至少 4 个字");
        body = { reason };
      } else if (action === "ship") {
        const company = await ui.prompt("快递公司", "填写发货信息", "顺丰速运");
        if (!company) return;
        const trackingNo = await ui.prompt("运单号（6-24 位字母或数字）", "填写发货信息", "SF1234567890");
        if (!trackingNo) return;
        body = { expressCompany: company, trackingNo };
      } else if (action === "review") {
        const score = await new Promise((resolve) => {
          wx.showActionSheet({
            itemList: ["5 分 非常满意", "4 分 满意", "3 分 一般", "2 分 不满意", "1 分 很差"],
            success: (res) => resolve(5 - res.tapIndex),
            fail: () => resolve(0)
          });
        });
        if (!score) return;
        const content = await ui.prompt("说说这次的交易体验", "评价卖家", "例如：发货很快，包装仔细");
        if (!content) return;
        body = { score, content };
      } else {
        const yes = await ui.confirm(`确认执行「${order.actions.find((a) => a.action === action)?.label || action}」？`, "请确认");
        if (!yes) return;
        body = {};
      }

      await Store.api(`/api/orders/${id}/${action}`, { method: "POST", body });
      ui.ok("操作成功");
      await this.refresh();
    } catch (err) {
      ui.fail(err, "操作失败");
    }
  },

  goProduct(e) {
    wx.navigateTo({ url: `/pages/product/product?id=${e.currentTarget.dataset.id}` });
  },

  goMarket() {
    wx.switchTab({ url: "/pages/market/market" });
  }
});
