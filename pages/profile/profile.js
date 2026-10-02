const { ready, Store } = require("../../utils/boot.js");
const ui = require("../../utils/ui.js");

Page({
  data: {
    theme: "light",
    mode: "offline",
    loading: true,
    isLogin: false,
    user: null,
    counts: {},
    creditPercent: 0,

    /* 编辑资料 */
    editing: false,
    form: { nickname: "", bio: "", city: "" }
  },

  async onLoad() {
    this.setData({ theme: getApp().getTheme() });
    const mode = await ready();
    this.setData({ mode });
    await this.refresh();
  },

  onShow() {
    this.setData({ theme: getApp().getTheme() });
    if (!this.data.loading) this.refresh();
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh());
  },

  async refresh() {
    try {
      const me = await Store.api("/api/auth/me");
      if (!me.user) {
        this.setData({ loading: false, isLogin: false, user: null, counts: {} });
        return;
      }
      const counts = me.counts || {};
      this.setData({
        loading: false,
        isLogin: true,
        user: {
          ...me.user,
          createdAtText: ui.formatDate(me.user.createdAt),
          balanceText: ui.money(me.user.balance)
        },
        counts: {
          products: counts.products || 0,
          favorites: counts.favorites || 0,
          orders: counts.orders || 0,
          estimates: counts.estimates || 0,
          footprints: counts.footprints || 0,
          unreadNotice: counts.unreadNotice || 0,
          unreadMsg: counts.unreadMsg || 0
        },
        creditPercent: Math.max(0, Math.min(100, Number(me.user.credit) || 0)),
        form: {
          nickname: me.user.nickname || "",
          bio: me.user.bio || "",
          city: me.user.city || ""
        }
      });
    } catch (err) {
      this.setData({ loading: false });
      ui.fail(err, "账号信息加载失败");
    }
  },

  /* ---------- 导航 ---------- */

  goLogin() {
    wx.navigateTo({ url: "/pages/login/login" });
  },

  goOrders() {
    if (!this.guard()) return;
    wx.navigateTo({ url: "/pages/orders/orders" });
  },

  goMessages() {
    if (!this.guard()) return;
    wx.navigateTo({ url: "/pages/messages/messages" });
  },

  goAccount(e) {
    if (!this.guard()) return;
    const tab = e.currentTarget.dataset.tab;
    wx.navigateTo({ url: `/pages/account/account?tab=${tab}` });
  },

  goMarket() {
    wx.switchTab({ url: "/pages/market/market" });
  },

  goEstimate() {
    wx.switchTab({ url: "/pages/estimate/estimate" });
  },

  goLegal() {
    wx.navigateTo({ url: "/pages/legal/legal" });
  },

  /* 需要登录的操作统一走这里 */
  guard() {
    if (this.data.isLogin) return true;
    wx.navigateTo({ url: "/pages/login/login" });
    return false;
  },

  /* ---------- 资料 ---------- */

  toggleEdit() {
    this.setData({ editing: !this.data.editing });
  },

  onFormInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`form.${key}`]: e.detail.value });
  },

  async saveProfile() {
    const { nickname, bio, city } = this.data.form;
    if (nickname.trim().length < 2 || nickname.trim().length > 16) {
      ui.toast("昵称需为 2-16 个字符");
      return;
    }
    try {
      await Store.updateProfile({ nickname: nickname.trim(), bio: bio.trim(), city: city.trim() });
      this.setData({ editing: false });
      await this.refresh();
      ui.ok("资料已保存");
    } catch (err) {
      ui.fail(err, "保存失败");
    }
  },

  async verifyRealname() {
    const name = await ui.prompt("请输入真实姓名", "实名认证", "与证件一致");
    if (!name) return;
    const idNo = await ui.prompt("请输入身份证号", "实名认证", "18 位");
    if (!idNo) return;
    try {
      await Store.verifyRealname({ realName: name, idNo });
      await this.refresh();
      ui.ok("已提交实名认证");
    } catch (err) {
      ui.fail(err, "认证失败");
    }
  },

  async withdraw() {
    const amount = await ui.prompt(`当前可提现余额 ${this.data.user.balanceText}`, "提现", "输入提现金额");
    if (!amount) return;
    try {
      await Store.withdraw(Math.round(Number(amount)));
      await this.refresh();
      ui.ok("提现申请已提交");
    } catch (err) {
      ui.fail(err, "提现失败");
    }
  },

  async logout() {
    const yes = await ui.confirm("退出后需重新登录才能查看订单与收藏。", "退出登录");
    if (!yes) return;
    await Store.logout();
    await this.refresh();
    ui.ok("已退出");
  },

  async closeAccount() {
    const yes = await ui.confirm("注销后该账号将无法登录，且操作不可恢复。", "注销账号");
    if (!yes) return;
    try {
      await Store.closeAccount();
      await this.refresh();
      ui.ok("账号已注销");
    } catch (err) {
      ui.fail(err, "注销失败");
    }
  },

  toggleTheme() {
    const theme = ui.toggleTheme(this.data.theme);
    getApp().setTheme(theme);
    this.setData({ theme });
  },

  async resetDemo() {
    const yes = await ui.confirm("将清空本机新增数据并恢复内置演示数据，登录状态一并清除。", "重置演示数据");
    if (!yes) return;
    Store.resetLocal();
    await this.refresh();
    ui.ok("已重置");
  }
});
