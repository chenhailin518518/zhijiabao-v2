const { ready, Store } = require("../../utils/boot.js");
const D = require("../../utils/data.js");
const ui = require("../../utils/ui.js");
const report = require("../../utils/report.js");
const { REPORT_REASONS } = require("../../utils/config.js");

Page({
  data: {
    theme: "light",
    mode: "offline",
    loading: true,
    id: "",
    product: null,
    culture: null,
    isLogin: false,
    favorited: false,
    addresses: [],
    addressIndex: 0,
    canBuy: false,

    ...report.blank()
  },

  async onLoad(query) {
    this.setData({ theme: getApp().getTheme(), id: query.id || "" });
    const mode = await ready();
    this.setData({ mode });
    await this.load();
  },

  onShow() {
    this.setData({ theme: getApp().getTheme() });
  },

  async load() {
    const { id } = this.data;
    if (!id) {
      ui.toast("缺少商品参数");
      return;
    }
    try {
      const [res, me] = await Promise.all([
        Store.api(`/api/products/${id}`),
        Store.api("/api/auth/me")
      ]);
      const p = res.product;
      const scenic = D.scenic(p.scenic);
      const isLogin = !!me.user;
      /* 自己发布的商品不能购买，这里提前算出来，按钮直接置灰 */
      const isOwner = isLogin && p.seller && p.seller.id === me.user.id;

      this.setData({
        loading: false,
        isLogin,
        product: {
          ...p,
          images: (p.images || []).map((path) => ui.productImage(path)),
          priceText: ui.money(p.price),
          originalText: ui.money(p.original),
          freightText: p.freight > 0 ? `运费 ${ui.money(p.freight)}` : "包邮",
          totalText: ui.money(p.price + p.freight),
          discountText: p.original > 0 ? `${Math.round((p.price / p.original) * 10)} 折` : "",
          createdText: ui.formatDate(p.createdAt),
          questions: (p.questions || []).map((q) => ({
            ...q,
            createdText: ui.formatDate(q.createdAt),
            answered: !!q.answer
          })),
          reviews: (p.reviews || []).slice(0, 6).map((r) => ({
            ...r,
            createdText: ui.formatDate(r.createdAt),
            stars: "★★★★★".slice(0, r.score) + "☆☆☆☆☆".slice(0, 5 - r.score)
          })),
          similar: (p.similar || []).map((s) => ({
            ...s,
            cover: ui.productImage((s.images || [])[0]),
            priceText: ui.money(s.price)
          }))
        },
        culture: scenic
          ? { id: scenic.id, city: scenic.city, level: scenic.level, intro: scenic.intro, story: scenic.story, craft: scenic.craft, tip: scenic.tip }
          : null,
        favorited: !!p.favorited,
        canBuy: !isOwner && p.status === "在售"
      }, () => {
        /* canvas 位于 wx:elif="{{product}}" 分支内，要等这一帧渲染完才取得到节点 */
        this.drawPriceChart(p.priceHistory);
      });

      if (isLogin) await this.loadAddresses();
    } catch (err) {
      this.setData({ loading: false });
      ui.fail(err, "商品加载失败");
    }
  },

  async loadAddresses() {
    try {
      const res = await Store.api("/api/addresses");
      const list = res.addresses || [];
      this.setData({
        addresses: list.map((a) => ({ ...a, label: `${a.name} ${a.phone} ${a.region}${a.detail}` })),
        /* 本地模式返回 isDefault，在线模式下 MySQL 原样返回 is_default */
        addressIndex: Math.max(0, list.findIndex((a) => a.isDefault || a.is_default))
      });
    } catch (err) {
      this.setData({ addresses: [] });
    }
  },

  /* ---------- 价格走势图 ---------- */

  drawPriceChart(history, retry = 2) {
    const series = history && history.series;
    if (!series || series.length < 2) return;

    const again = () => this.drawPriceChart(history, retry - 1);

    const query = wx.createSelectorQuery().in(this);
    query.select("#priceChart").fields({ node: true, size: true }).exec((res) => {
      const item = res && res[0];
      if (!item || !item.node || !item.width || !item.height) {
        /* 节点或尺寸还没就绪时退一帧重试，否则会静默不画、页面无任何报错 */
        if (retry > 0) {
          if (wx.nextTick) wx.nextTick(again); else setTimeout(again, 60);
        }
        return;
      }
      const canvas = item.node;
      const ctx = canvas.getContext("2d");
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const dpr = info.pixelRatio || 2;
      const w = item.width;
      const h = item.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      const prices = series.map((s) => s.price);
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      const span = max - min || 1;
      const padL = 8;
      const padR = 8;
      const padT = 14;
      const padB = 22;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;
      const x = (i) => padL + (i / (series.length - 1)) * plotW;
      const y = (v) => padT + (1 - (v - min) / span) * plotH;

      /* 面积 */
      const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
      grad.addColorStop(0, "rgba(36, 72, 83, 0.22)");
      grad.addColorStop(1, "rgba(36, 72, 83, 0)");
      ctx.beginPath();
      ctx.moveTo(x(0), padT + plotH);
      series.forEach((s, i) => ctx.lineTo(x(i), y(s.price)));
      ctx.lineTo(x(series.length - 1), padT + plotH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      /* 折线 */
      ctx.beginPath();
      series.forEach((s, i) => (i ? ctx.lineTo(x(i), y(s.price)) : ctx.moveTo(x(i), y(s.price))));
      ctx.strokeStyle = "#244853";
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.stroke();

      /* 末点 */
      const lastX = x(series.length - 1);
      const lastY = y(prices[prices.length - 1]);
      ctx.beginPath();
      ctx.arc(lastX, lastY, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#ab845b";
      ctx.fill();

      /* 刻度文字 */
      ctx.fillStyle = "#5d6b72";
      ctx.font = "10px sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText(`最高 ¥${max}`, padL, 0);
      ctx.textBaseline = "bottom";
      ctx.fillText(`最低 ¥${min}`, padL, h);
    });
  },

  /* ---------- 操作 ---------- */

  async toggleFavorite() {
    if (!this.data.isLogin) {
      wx.navigateTo({ url: "/pages/login/login" });
      return;
    }
    try {
      const res = await Store.api(`/api/favorites/${this.data.id}`, { method: "POST" });
      this.setData({ favorited: !!res.favorited });
      ui.ok(res.favorited ? "已收藏" : "已取消收藏");
    } catch (err) {
      ui.fail(err, "操作失败");
    }
  },

  async ask() {
    if (!this.data.isLogin) {
      wx.navigateTo({ url: "/pages/login/login" });
      return;
    }
    const text = await ui.prompt("向卖家提问（2-100 字）", "我要提问", "例如：有原装包装盒吗？");
    if (!text) return;
    try {
      await Store.api(`/api/products/${this.data.id}/questions`, { method: "POST", body: { body: text } });
      ui.ok("提问已提交");
      await this.load();
    } catch (err) {
      ui.fail(err, "提问失败");
    }
  },

  async buy() {
    if (!this.data.isLogin) {
      wx.navigateTo({ url: "/pages/login/login" });
      return;
    }
    if (!this.data.canBuy) {
      ui.toast(this.data.product.status === "在售" ? "不能购买自己发布的商品" : "该商品当前不可购买");
      return;
    }
    if (!this.data.addresses.length) {
      const yes = await ui.confirm("尚未添加收货地址，是否先添加？", "缺少收货地址");
      if (yes) wx.navigateTo({ url: "/pages/account/account?tab=addresses" });
      return;
    }
    const addr = this.data.addresses[this.data.addressIndex];
    const yes = await ui.confirm(
      `收货地址：${addr.label}\n应付金额 ${this.data.product.totalText}（含运费）`,
      "确认下单"
    );
    if (!yes) return;

    try {
      const res = await Store.api("/api/orders", {
        method: "POST",
        body: { productId: this.data.id, addressId: addr.id }
      });
      ui.ok("下单成功");
      const orderId = res.order && res.order.id;
      setTimeout(() => {
        wx.navigateTo({ url: `/pages/orders/orders?focus=${orderId || ""}` });
      }, 800);
    } catch (err) {
      ui.fail(err, "下单失败");
    }
  },

  async messageSeller() {
    if (!this.data.isLogin) {
      wx.navigateTo({ url: "/pages/login/login" });
      return;
    }
    const seller = this.data.product.seller;
    if (!seller || !seller.id) {
      ui.toast("该商品由平台代管，暂不支持站内沟通，可在下方问答区留言");
      return;
    }
    wx.navigateTo({ url: `/pages/messages/messages?peer=${seller.id}&name=${encodeURIComponent(seller.name)}` });
  },

  reportProduct() {
    if (!this.data.isLogin) {
      wx.navigateTo({ url: "/pages/login/login" });
      return;
    }
    const p = this.data.product;
    this.openReport({ type: "product", id: this.data.id, label: p ? p.name : "" });
  },

  onAddressChange(e) {
    this.setData({ addressIndex: Number(e.detail.value) });
  },

  goProduct(e) {
    wx.redirectTo({ url: `/pages/product/product?id=${e.currentTarget.dataset.id}` });
  },

  previewImage(e) {
    wx.previewImage({
      current: e.currentTarget.dataset.src,
      urls: this.data.product.images
    });
  },

  ...report.methods(Store, REPORT_REASONS),

  onShareAppMessage() {
    const p = this.data.product;
    return {
      title: p ? `${p.name} · ${p.priceText}` : "智价宝",
      path: `/pages/product/product?id=${this.data.id}`
    };
  }
});
