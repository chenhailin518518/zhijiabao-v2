const { ready, Store } = require("../../utils/boot.js");
const ui = require("../../utils/ui.js");
const report = require("../../utils/report.js");
const { REPORT_REASONS } = require("../../utils/config.js");

const QUICK_REPLIES = ["请问还在吗？", "能否再优惠一些？", "有原包装和凭证吗？"];

const TABS = [
  { key: "chat", label: "会话" },
  { key: "notice", label: "系统通知" }
];

/*
  字段兼容：本地演示模式返回驼峰（peerId / lastBody），
  在线模式的 MySQL 查询返回下划线（peer_id / last_body）。
  两种都要读得到，页面才不会因为换了数据源就空掉。
*/
function pick(obj, ...keys) {
  for (let i = 0; i < keys.length; i += 1) {
    const v = obj ? obj[keys[i]] : undefined;
    if (v !== undefined && v !== null) return v;
  }
  return "";
}

function bare(obj, ...keys) {
  for (let i = 0; i < keys.length; i += 1) {
    const v = obj ? obj[keys[i]] : undefined;
    if (v !== undefined) return v;
  }
  return null;
}

Page({
  data: {
    theme: "light",
    mode: "offline",
    isLogin: false,
    loading: true,

    tab: "chat",
    tabs: TABS,

    conversations: [],
    notices: [],
    unreadNotices: 0,

    /* 当前会话 */
    peerId: 0,
    peerName: "",
    peerCredit: "",
    chatLoading: false,
    chat: [],
    scrollInto: "",
    input: "",
    quickReplies: QUICK_REPLIES,

    ...report.blank()
  },

  async onLoad(query) {
    this.setData({ theme: getApp().getTheme() });
    if (query.peer) {
      this.pendingPeer = { id: Number(query.peer), name: query.name ? decodeURIComponent(query.name) : "" };
    }
    const mode = await ready();
    this.setData({ mode });
    await this.loadAll();
  },

  onShow() {
    this.setData({ theme: getApp().getTheme() });
  },

  onPullDownRefresh() {
    this.loadAll().finally(() => wx.stopPullDownRefresh());
  },

  /* ---------- 数据 ---------- */

  async loadAll() {
    const me = await Store.api("/api/auth/me");
    if (!me.user) {
      this.setData({ isLogin: false, loading: false });
      return;
    }
    this.setData({ isLogin: true });
    await Promise.all([this.loadConversations(), this.loadNotices()]);

    const pending = this.pendingPeer;
    this.pendingPeer = null;
    if (pending && pending.id) {
      await this.openChat(pending.id, pending.name);
    } else if (this.data.conversations.length) {
      const first = this.data.conversations[0];
      await this.openChat(first.peerId, first.name);
    }
    this.setData({ loading: false });
  },

  async loadConversations() {
    try {
      const res = await Store.api("/api/conversations");
      const list = (res.conversations || []).map((c) => ({
        peerId: Number(pick(c, "peer_id", "peerId")),
        name: pick(c, "peer_name", "peerName") || "已注销用户",
        credit: bare(c, "peer_credit", "peerCredit"),
        lastBody: pick(c, "last_body", "lastBody"),
        unread: Number(c.unread || 0),
        lastAtText: ui.fromNow(pick(c, "last_at", "lastAt")),
        initial: String(pick(c, "peer_name", "peerName") || "?").slice(0, 1)
      }));
      this.setData({ conversations: list });
    } catch (err) {
      this.setData({ conversations: [] });
    }
  },

  async loadNotices() {
    try {
      const res = await Store.api("/api/notifications");
      this.setData({
        notices: (res.notifications || []).map((n) => ({
          id: n.id,
          type: n.type || "system",
          title: n.title,
          body: n.body,
          link: n.link || "",
          read: !!bare(n, "read_at", "readAt"),
          atText: ui.fromNow(pick(n, "created_at", "createdAt"))
        })),
        unreadNotices: res.unread || 0
      });
    } catch (err) {
      this.setData({ notices: [], unreadNotices: 0 });
    }
  },

  async openChat(peerId, name) {
    if (!peerId) return;
    const known = this.data.conversations.find((c) => c.peerId === peerId);
    this.setData({
      peerId,
      peerName: name || (known && known.name) || "对方用户",
      peerCredit: known ? known.credit : "",
      chatLoading: true,
      tab: "chat"
    });
    try {
      const res = await Store.api(`/api/messages?peer=${peerId}`);
      const myId = Store.user ? Store.user.id : 0;
      this.setData({
        chatLoading: false,
        chat: (res.messages || []).map((m) => {
          const from = Number(pick(m, "from_user", "fromUser"));
          return {
            id: m.id,
            mine: from === myId,
            body: m.body,
            atText: ui.formatDateTime(pick(m, "created_at", "createdAt"))
          };
        })
      });
      await this.loadConversations();
      this.scrollToBottom();
    } catch (err) {
      this.setData({ chatLoading: false, chat: [] });
      ui.fail(err, "会话加载失败");
    }
  },

  /* 消息列表用 scroll-view，新消息进来后滚到底 */
  scrollToBottom() {
    /* 延迟到渲染完成后再设，否则 scroll-into-view 拿不到新节点 */
    setTimeout(() => {
      const last = this.data.chat[this.data.chat.length - 1];
      if (last) this.setData({ scrollInto: `msg-${last.id}` });
    }, 60);
  },

  selectConversation(e) {
    const peerId = Number(e.currentTarget.dataset.peer);
    const name = e.currentTarget.dataset.name;
    this.openChat(peerId, name);
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.key });
  },

  /* ---------- 交互 ---------- */

  onInput(e) {
    this.setData({ input: e.detail.value });
  },

  useQuick(e) {
    this.setData({ input: e.currentTarget.dataset.text });
  },

  async send() {
    const text = String(this.data.input || "").trim();
    if (!text) {
      ui.toast("请输入消息内容");
      return;
    }
    if (text.length > 300) {
      ui.toast("消息最长 300 字");
      return;
    }
    const peer = this.data.peerId;
    this.setData({ input: "" });
    try {
      await Store.api("/api/messages", { method: "POST", body: { to: peer, body: text } });
      await this.openChat(peer, this.data.peerName);
    } catch (err) {
      /* 命中敏感词或发送过频时，把原话放回输入框，免得用户重打 */
      this.setData({ input: text });
      ui.fail(err, "发送失败");
    }
  },

  async markAllRead() {
    if (!this.data.unreadNotices) {
      ui.toast("没有未读通知");
      return;
    }
    try {
      await Store.api("/api/notifications/read", { method: "POST" });
      await this.loadNotices();
      ui.ok("已全部标为已读");
    } catch (err) {
      ui.fail(err, "操作失败");
    }
  },

  /* 通知里的 link 沿用 Web 版路径，这里映射到对应的小程序页面 */
  goLink(e) {
    const link = e.currentTarget.dataset.link || "";
    if (!link) return;
    if (link.indexOf("orders") >= 0) {
      wx.navigateTo({ url: "/pages/orders/orders" });
    } else if (link.indexOf("profile") >= 0) {
      wx.switchTab({ url: "/pages/profile/profile" });
    } else if (link.indexOf("market") >= 0) {
      wx.switchTab({ url: "/pages/market/market" });
    } else if (link.indexOf("estimate") >= 0) {
      wx.switchTab({ url: "/pages/estimate/estimate" });
    } else if (link.indexOf("messages") >= 0) {
      this.setData({ tab: "chat" });
    } else {
      ui.toast("该通知对应的功能在运营后台，小程序端暂不开放");
    }
  },

  reportCurrent() {
    this.openReport({ type: "user", id: this.data.peerId, label: this.data.peerName });
  },

  goLogin() {
    wx.navigateTo({ url: "/pages/login/login" });
  },

  goProduct(e) {
    wx.navigateTo({ url: `/pages/product/product?id=${e.currentTarget.dataset.id}` });
  },

  ...report.methods(Store, REPORT_REASONS),

  onShareAppMessage() {
    return { title: "智价宝 · 站内沟通与系统通知", path: "/pages/messages/messages" };
  }
});
