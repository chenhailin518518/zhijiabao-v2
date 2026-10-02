const { ready, Store } = require("../../utils/boot.js");
const { DEMO_ACCOUNTS } = require("../../utils/config.js");
const ui = require("../../utils/ui.js");

Page({
  data: {
    theme: "light",
    mode: "offline",
    tab: "login",
    demoAccounts: DEMO_ACCOUNTS,
    redirect: "",

    form: { phone: "", password: "", code: "", nickname: "", purpose: "login" },
    devCode: "",
    counting: 0,
    submitting: false
  },

  async onLoad(query) {
    this.setData({
      theme: getApp().getTheme(),
      redirect: query.redirect || "",
      "form.purpose": "login"
    });
    const mode = await ready();
    this.setData({ mode });
  },

  onShow() {
    this.setData({ theme: getApp().getTheme() });
  },

  onUnload() {
    if (this.timer) clearInterval(this.timer);
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.key;
    this.setData({
      tab,
      devCode: "",
      "form.purpose": tab === "login" ? "login" : tab === "register" ? "register" : "reset"
    });
  },

  onInput(e) {
    this.setData({ [`form.${e.currentTarget.dataset.key}`]: e.detail.value });
  },

  /* 演示账号一键填充，比赛现场不用手输 */
  useDemo(e) {
    const acc = DEMO_ACCOUNTS[e.currentTarget.dataset.index];
    this.setData({
      tab: "login",
      "form.phone": acc.phone,
      "form.password": acc.password,
      "form.purpose": "login"
    });
    ui.toast(`已填入${acc.label}账号 ${acc.nickname}`);
  },

  async sendCode() {
    const phone = this.data.form.phone.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      ui.toast("请输入 11 位有效手机号");
      return;
    }
    try {
      const code = await Store.sendCode(phone, this.data.form.purpose);
      /* 本地演示模式后端会把验证码直接返回，展示在页面上省去短信通道 */
      this.setData({ devCode: code || "" });
      if (code) {
        ui.toast(`演示模式验证码：${code}`);
      } else {
        ui.ok("验证码已发送");
      }
      this.startCountdown();
    } catch (err) {
      ui.fail(err, "验证码发送失败");
    }
  },

  startCountdown() {
    this.setData({ counting: 60 });
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      const next = this.data.counting - 1;
      if (next <= 0) {
        clearInterval(this.timer);
        this.setData({ counting: 0 });
      } else {
        this.setData({ counting: next });
      }
    }, 1000);
  },

  async submitPassword() {
    await this.doLogin({ phone: this.data.form.phone, password: this.data.form.password });
  },

  async submitCode() {
    await this.doLogin({ phone: this.data.form.phone, code: this.data.form.code });
  },

  async doLogin(payload) {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      const user = await Store.login(payload);
      ui.ok(`欢迎回来，${user.nickname}`);
      setTimeout(() => this.done(), 700);
    } catch (err) {
      ui.fail(err, "登录失败");
    } finally {
      this.setData({ submitting: false });
    }
  },

  async doRegister() {
    const { phone, code, password, nickname } = this.data.form;
    if (!nickname.trim()) return ui.toast("请填写昵称");
    try {
      const user = await Store.register({
        phone: phone.trim(),
        code,
        password,
        nickname: nickname.trim(),
        city: ""
      });
      ui.ok(`注册成功，${user.nickname}`);
      setTimeout(() => this.done(), 700);
    } catch (err) {
      ui.fail(err, "注册失败");
    }
  },

  async doReset() {
    const { phone, code, password } = this.data.form;
    try {
      await Store.resetPassword({ phone: phone.trim(), code, password });
      ui.ok("密码已重置，请用新密码登录");
      this.setData({ tab: "login", "form.purpose": "login", "form.code": "" });
    } catch (err) {
      ui.fail(err, "重置失败");
    }
  },

  /* 登录成功后的去向：优先回到调用方指定的页面 */
  done() {
    const { redirect } = this.data;
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack({
        fail: () => wx.switchTab({ url: "/pages/profile/profile" })
      });
      return;
    }
    if (redirect === "publish") wx.navigateTo({ url: "/pages/publish/publish" });
    else if (redirect === "orders") wx.navigateTo({ url: "/pages/orders/orders" });
    else wx.switchTab({ url: "/pages/profile/profile" });
  }
});
