const { ready, Store } = require("../../utils/boot.js");
const ui = require("../../utils/ui.js");

const TABS = [
  { key: "favorites", label: "我的收藏" },
  { key: "footprints", label: "浏览足迹" },
  { key: "addresses", label: "收货地址" }
];

Page({
  data: {
    theme: "light",
    tab: "favorites",
    tabs: TABS,
    loading: true,
    favorites: [],
    footprints: [],
    addresses: [],
    /* 新增地址表单 */
    adding: false,
    form: { name: "", phone: "", region: "", detail: "", isDefault: false }
  },

  async onLoad(query) {
    this.setData({ theme: getApp().getTheme(), tab: query.tab || "favorites" });
    await ready();
    await this.refresh();
  },

  onShow() {
    this.setData({ theme: getApp().getTheme() });
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh());
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.key });
    this.refresh();
  },

  async refresh() {
    this.setData({ loading: true });
    const tab = this.data.tab;
    try {
      if (tab === "favorites") {
        const res = await Store.api("/api/favorites");
        this.setData({
          favorites: (res.favorites || []).map((p) => this.decorate(p, "favAt"))
        });
      } else if (tab === "footprints") {
        const res = await Store.api("/api/footprints");
        this.setData({
          footprints: (res.footprints || []).map((p) => this.decorate(p, "viewedAt"))
        });
      } else {
        const res = await Store.api("/api/addresses");
        /* 本地模式返回 isDefault，在线模式下 MySQL 原样返回 is_default，这里统一成前端字段 */
        this.setData({
          addresses: (res.addresses || []).map((a) => ({ ...a, isDefault: a.isDefault || a.is_default || 0 }))
        });
      }
      this.setData({ loading: false });
    } catch (err) {
      this.setData({ loading: false });
      if (/请先登录/.test(err.message || "")) {
        wx.redirectTo({ url: "/pages/login/login" });
        return;
      }
      ui.fail(err, "加载失败");
    }
  },

  decorate(p, timeKey) {
    const alert = p.priceAlert
      ? `降价提醒 ¥${p.alertPrice}`
      : "";
    return {
      ...p,
      cover: ui.productImage((p.images || [])[0]),
      priceText: ui.money(p.price),
      originalText: ui.money(p.original),
      timeText: ui.fromNow(p[timeKey]),
      alertText: alert
    };
  },

  goProduct(e) {
    wx.navigateTo({ url: `/pages/product/product?id=${e.currentTarget.dataset.id}` });
  },

  /* ---------- 收藏 ---------- */

  async removeFavorite(e) {
    const { id, name } = e.currentTarget.dataset;
    const yes = await ui.confirm(`取消收藏「${name}」？`, "取消收藏");
    if (!yes) return;
    try {
      await Store.api(`/api/favorites/${id}`, { method: "POST" });
      ui.ok("已取消收藏");
      await this.refresh();
    } catch (err) {
      ui.fail(err, "操作失败");
    }
  },

  async setAlert(e) {
    const { id, price } = e.currentTarget.dataset;
    const input = await ui.prompt(`当前售价 ¥${price}，提醒价需低于当前售价`, "设置降价提醒", "例如 120");
    if (!input) return;
    try {
      const res = await Store.api(`/api/favorites/${id}/alert`, {
        method: "POST",
        body: { alertPrice: Math.round(Number(input)) }
      });
      ui.toast(res.message || "已设置提醒");
      await this.refresh();
    } catch (err) {
      ui.fail(err, "设置失败");
    }
  },

  /* ---------- 足迹 ---------- */

  async clearFootprints() {
    const yes = await ui.confirm("确认清空全部浏览足迹？", "清空足迹");
    if (!yes) return;
    try {
      await Store.api("/api/footprints", { method: "DELETE" });
      ui.ok("已清空");
      await this.refresh();
    } catch (err) {
      ui.fail(err, "清空失败");
    }
  },

  /* ---------- 地址 ---------- */

  toggleAdd() {
    this.setData({ adding: !this.data.adding, form: { name: "", phone: "", region: "", detail: "", isDefault: !this.data.addresses.length } });
  },

  onFormInput(e) {
    this.setData({ [`form.${e.currentTarget.dataset.key}`]: e.detail.value });
  },

  onDefaultChange(e) {
    this.setData({ "form.isDefault": e.detail.value });
  },

  async saveAddress() {
    const { name, phone, region, detail, isDefault } = this.data.form;
    if (!name.trim()) return ui.toast("请填写收货人姓名");
    if (!/^1[3-9]\d{9}$/.test(phone.trim())) return ui.toast("请输入 11 位有效手机号");
    if (!region.trim()) return ui.toast("请填写所在地区");
    if (!detail.trim()) return ui.toast("请填写详细地址");
    try {
      await Store.api("/api/addresses", {
        method: "POST",
        body: { name: name.trim(), phone: phone.trim(), region: region.trim(), detail: detail.trim(), isDefault: !!isDefault }
      });
      this.setData({ adding: false });
      ui.ok("地址已保存");
      await this.refresh();
    } catch (err) {
      ui.fail(err, "保存失败");
    }
  },

  async setDefaultAddress(e) {
    try {
      await Store.api(`/api/addresses/${e.currentTarget.dataset.id}/default`, { method: "POST" });
      ui.ok("已设为默认");
      await this.refresh();
    } catch (err) {
      ui.fail(err, "设置失败");
    }
  },

  async deleteAddress(e) {
    const yes = await ui.confirm("确认删除该收货地址？", "删除地址");
    if (!yes) return;
    try {
      await Store.api(`/api/addresses/${e.currentTarget.dataset.id}`, { method: "DELETE" });
      ui.ok("已删除");
      await this.refresh();
    } catch (err) {
      ui.fail(err, "删除失败");
    }
  }
});
