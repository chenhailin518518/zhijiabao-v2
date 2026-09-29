/*
  智价宝 - 前端数据层
  同一套调用方式适配两种运行环境：
    online  启动 `npm start` 后连接 Node 后端（数据落 SQLite，多设备共享）
    offline 纯静态托管（GitHub Pages 等）自动降级为浏览器本地存储，功能语义保持一致
  页面代码只需要 `await Store.api(...)`，不需要关心当前模式。
*/
(function (root) {
  "use strict";

  const D = root.ZhijiabaoData;
  const P = root.ZhijiabaoPricing;
  const TOKEN_KEY = "zhijiabao-token";
  const DB_KEY = "zhijiabao-local-db-v2";

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const now = () => new Date().toISOString();
  let seq = 0;
  const nextId = (prefix) => `${prefix}${Date.now().toString(36)}${(seq += 1).toString(36)}`;

  /* =========================
     本地（离线）数据库
     ========================= */
  const Local = {
    load() {
      try {
        const raw = localStorage.getItem(DB_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.schema === 2) return parsed;
        }
      } catch (e) {
        console.warn("[store] 本地数据读取失败，将重建", e);
      }
      const fresh = Local.seed();
      Local.save(fresh);
      return fresh;
    },
    save(db) {
      try {
        localStorage.setItem(DB_KEY, JSON.stringify(db));
        return true;
      } catch (e) {
        console.warn("[store] 本地数据写入失败（可能超出存储配额）", e);
        return false;
      }
    },
    seed() {
      const t = now();
      const users = [
        { id: 1, phone: "18800000000", password: "admin888", nickname: "智价宝运营", bio: "平台运营与内容审核账号", city: "上海", credit: 96, balance: 0, realName: "", idNoMasked: "", idVerified: false, isAdmin: true, status: "active", createdAt: t },
        { id: 2, phone: "18800000001", password: "demo1234", nickname: "澄禾", bio: "故宫文创收藏爱好者", city: "北京", credit: 88, balance: 0, realName: "", idNoMasked: "", idVerified: false, isAdmin: false, status: "active", createdAt: t },
        { id: 3, phone: "18800000002", password: "demo1234", nickname: "湖畔旧物", bio: "杭州景区文创尾货卖家", city: "杭州", credit: 84, balance: 0, realName: "", idNoMasked: "", idVerified: false, isAdmin: false, status: "active", createdAt: t }
      ];
      const ownerBySeller = { "澄禾": 2, "湖畔旧物": 3 };
      const products = D.SEED_PRODUCTS.map((p) => ({
        id: p.id,
        ownerId: ownerBySeller[p.sellerName] || null,
        name: p.name,
        scenic: p.scenic,
        category: p.category,
        condition: p.condition,
        tag: p.tag,
        price: p.price,
        original: p.original,
        freight: p.freight,
        description: p.description,
        images: [p.image],
        heat: p.heat,
        retention: p.retention,
        views: p.views,
        status: "在售",
        rejectReason: "",
        sellerName: p.sellerName,
        source: "seed",
        createdAt: t
      }));
      const reviewSeed = [
        { productId: "fan", fromUser: 2, score: 5, content: "扇面完好，包装也很仔细，和景区买的一模一样。", createdAt: t },
        { productId: "fan", fromUser: 2, score: 4, content: "折扇做工不错，扇骨有点紧，整体满意。", createdAt: t },
        { productId: "cup", fromUser: 3, score: 5, content: "杯身没有磕碰，比景区便宜一半。", createdAt: t },
        { productId: "pin", fromUser: 1, score: 4, content: "徽章背面有轻微划痕，卖家提前说明了，可以接受。", createdAt: t }
      ];
      const questions = [
        { id: 1, productId: "fan", userId: 1, asker: "游客小林", body: "扇子有原来的包装盒吗？想送人。", answer: "有原装锦盒，盒子边角有一道压痕，发货时会加固。", createdAt: t, answeredAt: t },
        { id: 2, productId: "cup", userId: 1, asker: "文创爱好者", body: "杯子能装热水吗？容量多少？", answer: "陶瓷杯可装热水，容量约 350ml，建议不要微波。", createdAt: t, answeredAt: t }
      ];
      return {
        schema: 2,
        users,
        sessionUserId: null,
        smsCodes: {},
        addresses: [],
        products,
        favorites: [],
        footprints: [],
        searches: [],
        estimates: [],
        orders: [],
        reviews: reviewSeed.map((r, i) => ({ id: i + 1, orderId: null, toUser: null, role: "buyer", ...r })),
        questions,
        messages: [],
        conversations: [],
        notifications: [],
        reports: [],
        events: [],
        auditLogs: []
      };
    }
  };

  /* =========================
     在线 API 客户端
     ========================= */
  const Store = {
    mode: "checking",
    apiBase: (() => {
      /* 允许通过 <html data-api="https://api.example.com"> 指向独立后端 */
      const attr = document.documentElement?.dataset?.api;
      return attr ? attr.replace(/\/$/, "") : "";
    })(),
    token: "",
    user: null,
    counts: {},
    _listeners: [],

    async init() {
      try {
        this.token = localStorage.getItem(TOKEN_KEY) || "";
      } catch { this.token = ""; }
      this.mode = await this.probe();
      if (this.mode === "online") {
        try {
          const me = await this.api("/api/auth/me");
          this.user = me.user;
          this.counts = me.counts || {};
        } catch { /* 未登录或令牌过期 */ }
      } else {
        const db = Local.load();
        this.user = db.users.find((u) => u.id === db.sessionUserId) || null;
        this.counts = this.user ? LocalApi.localCounts(db, this.user) : {};
        console.warn("[store] 未检测到后端服务，已切换为本地演示模式：数据仅保存在当前浏览器。");
      }
      this.track("page_view", { path: location.pathname });
      return this.mode;
    },

    async probe() {
      /* 静态托管下 /api/health 会返回 404 或 HTML，超时 1.5s 内未响应即视为离线 */
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1500);
        const res = await fetch(`${this.apiBase}/api/health`, { signal: controller.signal, headers: { Accept: "application/json" } });
        clearTimeout(timer);
        if (!res.ok) return "offline";
        const data = await res.json();
        return data?.service === "zhijiabao-api" ? "online" : "offline";
      } catch {
        return "offline";
      }
    },

    onChange(fn) {
      this._listeners.push(fn);
      return () => {
        this._listeners = this._listeners.filter((f) => f !== fn);
      };
    },

    emit() {
      this._listeners.forEach((fn) => {
        try { fn(this); } catch (e) { console.warn("[store] listener error", e); }
      });
    },

    setUser(user, counts) {
      this.user = user;
      if (counts) this.counts = counts;
      this.emit();
    },

    async api(path, { method = "GET", body, headers = {} } = {}) {
      if (this.mode === "online") {
        const res = await fetch(`${this.apiBase}${path}`, {
          method,
          headers: {
            ...(body ? { "Content-Type": "application/json" } : {}),
            ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
            ...headers
          },
          body: body ? JSON.stringify(body) : undefined
        });
        const text = await res.text();
        let data = null;
        try { data = JSON.parse(text); } catch { throw new Error("服务端返回了非 JSON 响应"); }
        if (!res.ok || data?.ok === false) throw new Error(data?.message || `请求失败（${res.status}）`);
        return data;
      }
      return LocalApi.handle(path, method, body || {}, this);
    },

    /* ---------- 账号 ---------- */
    async sendCode(phone, purpose = "login") {
      const data = await this.api("/api/auth/code", { method: "POST", body: { phone, purpose } });
      return data.devCode;
    },
    async register(payload) {
      const data = await this.api("/api/auth/register", { method: "POST", body: payload });
      this.applySession(data);
      return data.user;
    },
    async login({ phone, password, code }) {
      const data = await this.api("/api/auth/login", { method: "POST", body: { phone, password, code } });
      this.applySession(data);
      return data.user;
    },
    applySession(data) {
      if (data.token) {
        this.token = data.token;
        try { localStorage.setItem(TOKEN_KEY, data.token); } catch { /* ignore */ }
      }
      if (data.user) this.setUser(data.user);
    },
    async logout() {
      try { await this.api("/api/auth/logout", { method: "POST" }); } catch { /* ignore */ }
      this.token = "";
      this.user = null;
      this.counts = {};
      try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
      this.emit();
    },
    async refresh() {
      const data = await this.api("/api/auth/me");
      this.setUser(data.user, data.counts);
      return data;
    },
    async updateProfile(payload) {
      const data = await this.api("/api/me", { method: "PATCH", body: payload });
      this.setUser(data.user);
      return data.user;
    },
    async verifyRealname(payload) {
      const data = await this.api("/api/me/realname", { method: "POST", body: payload });
      this.setUser(data.user);
      return data.user;
    },
    async withdraw(amount) {
      const data = await this.api("/api/me/withdraw", { method: "POST", body: { amount } });
      this.setUser(data.user);
      return data.user;
    },
    async resetPassword(payload) {
      return this.api("/api/auth/reset-password", { method: "POST", body: payload });
    },
    async closeAccount() {
      await this.api("/api/me", { method: "DELETE" });
      this.token = "";
      this.user = null;
      this.counts = {};
      try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
      this.emit();
    },

    /* ---------- 埋点 ---------- */
    track(name, payload = {}) {
      let visitor = "";
      try {
        visitor = localStorage.getItem("zhijiabao-visitor") || "";
        if (!/^v_[a-z0-9]{6,20}$/.test(visitor)) {
          visitor = `v_${Math.random().toString(36).slice(2, 12)}`;
          localStorage.setItem("zhijiabao-visitor", visitor);
        }
      } catch { visitor = ""; }
      return this.api("/api/events", { method: "POST", body: { name, payload, visitor } }).catch(() => null);
    },

    /* ---------- 订单动作（含 UI 文案映射） ---------- */
    offlineActions: null
  };

  /* =========================
     离线（本地）实现
     ========================= */
  const LocalApi = {
    current(db, store) {
      return db.users.find((u) => u.id === db.sessionUserId) || null;
    },
    fail(message) {
      const error = new Error(message);
      error.local = true;
      throw error;
    },
    publicUser(u) {
      if (!u) return null;
      return {
        id: u.id, phone: u.phone, nickname: u.nickname, avatar: u.avatar || "", bio: u.bio || "",
        city: u.city || "", credit: u.credit, creditLevel: P.creditLevel(u.credit), balance: u.balance || 0,
        isAdmin: !!u.isAdmin, realName: u.realName || "", idNoMasked: u.idNoMasked || "",
        idVerified: !!u.idVerified, createdAt: u.createdAt
      };
    },
    productView(db, row, { withDetail = false, viewer = null } = {}) {
      const owner = row.ownerId ? db.users.find((u) => u.id === row.ownerId) : null;
      const reviews = db.reviews.filter((r) => r.productId === row.id);
      const avg = reviews.length ? reviews.reduce((a, b) => a + b.score, 0) / reviews.length : 0;
      const favCount = db.favorites.filter((f) => f.productId === row.id).length;
      const data = {
        id: row.id, name: row.name, scenic: row.scenic, category: row.category, condition: row.condition,
        tag: row.tag, price: row.price, original: row.original, freight: row.freight,
        description: row.description, images: clone(row.images || []), heat: row.heat,
        retention: row.retention, views: row.views, status: row.status, rejectReason: row.rejectReason || "",
        seller: owner
          ? { id: owner.id, name: owner.nickname, credit: owner.credit, level: P.creditLevel(owner.credit), city: owner.city }
          : { id: null, name: row.sellerName || "平台代管", credit: 80, level: "良好", city: "" },
        reviewCount: reviews.length,
        reviewScore: avg ? Math.round(avg * 10) / 10 : null,
        favoriteCount: favCount,
        createdAt: row.createdAt,
        code: `ZJB${String(row.id).toUpperCase()}`
      };
      if (viewer) data.favorited = db.favorites.some((f) => f.userId === viewer.id && f.productId === row.id);
      if (withDetail) {
        data.priceHistory = P.priceHistory(row);
        data.reviews = reviews
          .slice()
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
          .slice(0, 20)
          .map((r) => {
            const from = db.users.find((u) => u.id === r.fromUser);
            return { id: r.id, score: r.score, content: r.content, nickname: from?.nickname || "匿名用户", credit: from?.credit, role: r.role, createdAt: r.createdAt };
          });
        data.questions = db.questions.filter((q) => q.productId === row.id).map((q) => ({
          id: q.id, asker: q.asker, body: q.body, answer: q.answer || "", createdAt: q.createdAt, answeredAt: q.answeredAt || null
        }));
        data.similar = db.products
          .filter((p) => p.category === row.category && p.id !== row.id && p.status === "在售")
          .slice(0, 3)
          .map((p) => ({ id: p.id, name: p.name, price: p.price, image: (p.images || [])[0] || "", scenic: p.scenic }));
      }
      return data;
    },
    orderView(db, row) {
      const buyer = db.users.find((u) => u.id === row.buyerId);
      const seller = row.sellerId ? db.users.find((u) => u.id === row.sellerId) : null;
      return {
        id: row.id, productId: row.productId, productName: row.productName, productImage: row.productImage,
        scenic: row.scenic, price: row.price, freight: row.freight, fee: row.fee, total: row.price + row.freight,
        status: row.status,
        buyer: buyer ? { id: buyer.id, name: buyer.nickname } : null,
        seller: seller ? { id: seller.id, name: seller.nickname } : null,
        address: clone(row.address || {}),
        timeline: clone(row.timeline || []),
        trackingNo: row.trackingNo || "", expressCompany: row.expressCompany || "",
        cancelReason: row.cancelReason || "",
        reviewed: db.reviews.some((r) => r.orderId === row.id),
        createdAt: row.createdAt, updatedAt: row.updatedAt
      };
    },
    notify(db, userId, type, title, body = "", link = "") {
      if (!userId) return;
      db.notifications.unshift({ id: nextId("n"), userId, type, title, body, link, readAt: null, createdAt: now() });
    },
    audit(db, actorId, action, target = "", detail = "") {
      db.auditLogs.unshift({ id: nextId("a"), actorId, action, target, detail, createdAt: now() });
    },
    creditFor(db, user) {
      const reviews = db.reviews.filter((r) => r.toUser === user.id);
      const avg = reviews.length ? reviews.reduce((a, b) => a + b.score, 0) / reviews.length : 0;
      const done = db.orders.filter((o) => o.status === "已完成" && (o.buyerId === user.id || o.sellerId === user.id)).length;
      const accepted = db.reports.filter((r) => r.status === "已处理" && r.targetType === "user" && String(r.targetId) === String(user.id)).length;
      return P.calcCredit({ avgScore: avg, reviewCount: reviews.length, completedOrders: done, verified: !!user.idVerified, acceptedReports: accepted });
    },
    recalc(db, user) {
      if (user) user.credit = this.creditFor(db, user);
    },
    handle(path, method, inputBody = {}, store) {
      /* 与服务端一致：无请求体时按空对象处理，避免读 undefined 的属性 */
      const body = inputBody || {};
      const db = Local.load();
      const url = new URL(path, "http://local");
      const route = `${method} ${url.pathname.replace(/\/$/, "")}`;
      const me = () => {
        const user = this.current(db, store);
        if (!user || user.status !== "active") this.fail("请先登录");
        return user;
      };
      const q = Object.fromEntries(url.searchParams.entries());
      const seg = url.pathname.split("/").filter(Boolean);
      const result = (() => {
        switch (route) {
          /* ---- 账号 ---- */
          case "POST /api/auth/code": {
            if (!/^1[3-9]\d{9}$/.test(body.phone)) this.fail("请输入 11 位有效手机号");
            const code = String(Math.floor(100000 + Math.random() * 900000));
            db.smsCodes[body.phone] = { code, expireAt: Date.now() + 300000, purpose: body.purpose || "login" };
            Local.save(db);
            return { ok: true, devCode: code, message: "本地演示模式：验证码直接显示在页面上" };
          }
          case "POST /api/auth/register": {
            const phone = String(body.phone || "").trim();
            const nickname = String(body.nickname || "").trim();
            if (!/^1[3-9]\d{9}$/.test(phone)) this.fail("请输入 11 位有效手机号");
            if (nickname.length < 2 || nickname.length > 16) this.fail("昵称需为 2-16 个字符");
            if (String(body.password || "").length < 6) this.fail("密码至少 6 位");
            if (db.users.some((u) => u.phone === phone)) this.fail("该手机号已注册，请直接登录");
            const sms = db.smsCodes[phone];
            if (!sms || sms.code !== String(body.code).trim() || sms.purpose !== "register" || sms.expireAt < Date.now()) {
              this.fail("验证码错误或已过期");
            }
            delete db.smsCodes[phone];
            const user = {
              id: Math.max(0, ...db.users.map((u) => u.id)) + 1, phone, password: body.password, nickname,
              bio: "", city: body.city || "", credit: 70, balance: 0, realName: "", idNoMasked: "",
              idVerified: false, isAdmin: false, status: "active", createdAt: now()
            };
            db.users.push(user);
            db.sessionUserId = user.id;
            this.notify(db, user.id, "system", "欢迎加入智价宝", "完成实名认证并售出首件闲置，可提升信用分。", "/profile/");
            this.audit(db, user.id, "register", phone, "本地模式注册");
            Local.save(db);
            return { ok: true, token: `local-${user.id}`, user: this.publicUser(user) };
          }
          case "POST /api/auth/login": {
            const user = db.users.find((u) => u.phone === String(body.phone || "").trim());
            if (!user) this.fail("该手机号尚未注册，请先注册");
            if (user.status !== "active") this.fail("账号已注销或被冻结");
            if (body.password) {
              if (body.password !== user.password) this.fail("手机号或密码不正确");
            } else {
              const sms = db.smsCodes[user.phone];
              if (!sms || sms.code !== String(body.code).trim() || sms.expireAt < Date.now()) this.fail("验证码错误或已过期");
              delete db.smsCodes[user.phone];
            }
            db.sessionUserId = user.id;
            Local.save(db);
            return { ok: true, token: `local-${user.id}`, user: this.publicUser(user) };
          }
          case "POST /api/auth/reset-password": {
            const user = db.users.find((u) => u.phone === String(body.phone || "").trim());
            if (!user) this.fail("该手机号尚未注册");
            if (String(body.password || "").length < 6) this.fail("新密码至少 6 位");
            const sms = db.smsCodes[user.phone];
            if (!sms || sms.code !== String(body.code).trim() || sms.purpose !== "reset" || sms.expireAt < Date.now()) {
              this.fail("验证码错误或已过期");
            }
            delete db.smsCodes[user.phone];
            user.password = body.password;
            Local.save(db);
            return { ok: true, message: "密码已重置，请使用新密码登录" };
          }
          case "POST /api/auth/logout": {
            db.sessionUserId = null;
            Local.save(db);
            return { ok: true, message: "已退出登录" };
          }
          case "GET /api/auth/me": {
            const user = this.current(db, store);
            if (!user) return { ok: true, user: null };
            return { ok: true, user: this.publicUser(user), counts: this.localCounts(db, user) };
          }
          case "PATCH /api/me": {
            const user = me();
            if (body.nickname !== undefined) {
              const nickname = String(body.nickname).trim();
              if (nickname.length < 2 || nickname.length > 16) this.fail("昵称需为 2-16 个字符");
              user.nickname = nickname;
            }
            if (body.bio !== undefined) user.bio = String(body.bio).slice(0, 60);
            if (body.city !== undefined) user.city = String(body.city).slice(0, 20);
            if (body.avatar !== undefined) user.avatar = String(body.avatar).slice(0, 300);
            Local.save(db);
            return { ok: true, user: this.publicUser(user) };
          }
          case "POST /api/me/realname": {
            const user = me();
            if (!/^\d{17}[\dXx]$/.test(String(body.idNo || ""))) this.fail("请输入 18 位有效身份证号");
            if (String(body.realName || "").trim().length < 2) this.fail("请输入真实姓名");
            user.realName = String(body.realName).trim();
            user.idNoMasked = `${user.realName ? "" : ""}${String(body.idNo).slice(0, 3)}***********${String(body.idNo).slice(-4)}`;
            user.idVerified = true;
            this.recalc(db, user);
            this.notify(db, user.id, "system", "实名认证已通过", "信用分已更新，可发布与交易。", "/profile/");
            Local.save(db);
            return { ok: true, user: this.publicUser(user) };
          }
          case "POST /api/me/withdraw": {
            const user = me();
            const amount = Math.round(Number(body.amount));
            if (!Number.isFinite(amount) || amount <= 0) this.fail("请输入有效提现金额");
            if (amount > (user.balance || 0)) this.fail(`可提现余额不足（当前 ¥${user.balance || 0}）`);
            user.balance -= amount;
            this.notify(db, user.id, "wallet", "提现申请已提交", `¥${amount} 将在 1-3 个工作日到账（演示）。`, "/profile/");
            Local.save(db);
            return { ok: true, user: this.publicUser(user) };
          }
          case "DELETE /api/me": {
            const user = me();
            user.status = "deleted";
            user.nickname = "已注销用户";
            db.sessionUserId = null;
            db.products.forEach((p) => {
              if (p.ownerId === user.id && ["在售", "待审核"].includes(p.status)) p.status = "已下架";
            });
            Local.save(db);
            return { ok: true, message: "账号已注销，相关在售商品已下架" };
          }
          /* ---- 地址 ---- */
          case "GET /api/addresses": {
            const user = me();
            return { ok: true, addresses: db.addresses.filter((a) => a.userId === user.id).sort((a, b) => b.isDefault - a.isDefault) };
          }
          case "POST /api/addresses": {
            const user = me();
            const list = db.addresses.filter((a) => a.userId === user.id);
            if (list.length >= 10) this.fail("最多保存 10 个收货地址");
            if (!/^1[3-9]\d{9}$/.test(String(body.phone || ""))) this.fail("请输入有效收件人手机号");
            if (String(body.detail || "").trim().length < 4) this.fail("请填写详细地址（至少 4 个字符）");
            const isDefault = body.isDefault || list.length === 0 ? 1 : 0;
            if (isDefault) list.forEach((a) => { a.isDefault = 0; });
            const row = {
              id: Math.max(0, ...db.addresses.map((a) => a.id)) + 1,
              userId: user.id, name: String(body.name).trim(), phone: body.phone, region: body.region,
              detail: String(body.detail).trim(), isDefault, created_at: now(), createdAt: now()
            };
            db.addresses.push(row);
            Local.save(db);
            return { ok: true, id: row.id };
          }
          /* ---- 商品 ---- */
          case "GET /api/products": {
            let list = db.products.slice();
            const status = q.status || "在售";
            if (status !== "all") list = list.filter((p) => p.status === status);
            if (q.scenic) list = list.filter((p) => p.scenic === q.scenic);
            if (q.category) list = list.filter((p) => p.category === q.category);
            if (q.tag) list = list.filter((p) => p.tag === q.tag);
            if (q.keyword) {
              const k = q.keyword.toLowerCase();
              list = list.filter((p) => `${p.name}${p.description}${p.scenic}${p.category}`.toLowerCase().includes(k));
            }
            if (q.priceMin) list = list.filter((p) => p.price >= Number(q.priceMin));
            if (q.priceMax) list = list.filter((p) => p.price <= Number(q.priceMax));
            if (q.owner === "me") {
              const user = me();
              list = list.filter((p) => p.ownerId === user.id);
            }
            const sorters = {
              heat: (a, b) => b.heat - a.heat,
              new: (a, b) => (a.createdAt < b.createdAt ? 1 : -1),
              "price-asc": (a, b) => a.price - b.price,
              "price-desc": (a, b) => b.price - a.price,
              value: (a, b) => a.price / a.original - b.price / b.original
            };
            list.sort(sorters[q.sort] || sorters.heat);
            const limit = Math.min(Number(q.limit) || 12, 48);
            const page = Math.max(Number(q.page) || 1, 1);
            const total = list.length;
            const viewer = this.current(db, store);
            return {
              ok: true, total, page, limit, hasMore: page * limit < total,
              products: list.slice((page - 1) * limit, page * limit).map((p) => this.productView(db, p, { viewer }))
            };
          }
          case "POST /api/products": {
            const user = me();
            const check = P.validateProduct(body);
            if (!check.valid) this.fail(check.errors[0].message);
            const row = {
              id: nextId("p"), ownerId: user.id, name: body.name, scenic: body.scenic, category: body.category,
              condition: body.condition, tag: body.tag || "个人闲置", price: Math.round(body.price),
              original: Math.round(body.original), freight: Math.round(body.freight || 0), description: body.description || "",
              images: body.images || [], heat: 60, retention: 0.6, views: 0, status: user.isAdmin ? "在售" : "待审核",
              rejectReason: "", sellerName: user.nickname, source: "user", createdAt: now()
            };
            db.products.unshift(row);
            this.notify(db, user.id, "product", "发布已提交审核", `「${row.name}」将在审核通过后上架集市。`, "/market/");
            db.users.filter((u) => u.isAdmin).forEach((a) => this.notify(db, a.id, "audit", "有待审核商品", `「${row.name}」等待审核`, "/admin/"));
            this.audit(db, user.id, "publish-product", `product:${row.id}`, row.name);
            Local.save(db);
            return { ok: true, id: row.id, status: row.status, message: "发布成功，等待平台审核后上架" };
          }
          /* ---- 收藏 / 足迹 / 搜索 ---- */
          case "GET /api/favorites": {
            const user = me();
            const rows = db.favorites.filter((f) => f.userId === user.id)
              .map((f) => {
                const p = db.products.find((x) => x.id === f.productId);
                return p ? { ...this.productView(db, p, { viewer: user }), priceAlert: !!f.priceAlert, alertPrice: f.alertPrice, favAt: f.createdAt } : null;
              }).filter(Boolean);
            return { ok: true, favorites: rows };
          }
          case "GET /api/footprints": {
            const user = me();
            const rows = db.footprints.filter((f) => f.userId === user.id)
              .map((f) => {
                const p = db.products.find((x) => x.id === f.productId);
                return p ? { ...this.productView(db, p, { viewer: user }), viewedAt: f.viewedAt } : null;
              }).filter(Boolean)
              .sort((a, b) => (a.viewedAt < b.viewedAt ? 1 : -1));
            return { ok: true, footprints: rows };
          }
          case "DELETE /api/footprints": {
            const user = me();
            db.footprints = db.footprints.filter((f) => f.userId !== user.id);
            Local.save(db);
            return { ok: true, message: "浏览足迹已清空" };
          }
          case "GET /api/search-history": {
            const user = this.current(db, store);
            if (!user) return { ok: true, history: [] };
            const list = db.searches.filter((s) => s.userId === user.id).slice(-12).reverse().map((s) => s.keyword);
            return { ok: true, history: [...new Set(list)] };
          }
          case "POST /api/search-history": {
            const user = this.current(db, store);
            if (!user) return { ok: true, history: [] };
            const keyword = String(body.keyword || "").trim().slice(0, 40);
            if (!keyword) this.fail("关键词不能为空");
            db.searches = db.searches.filter((s) => !(s.userId === user.id && s.keyword === keyword));
            db.searches.push({ id: nextId("s"), userId: user.id, keyword, createdAt: now() });
            Local.save(db);
            return { ok: true, message: "已记录" };
          }
          case "DELETE /api/search-history": {
            const user = me();
            db.searches = db.searches.filter((s) => s.userId !== user.id);
            Local.save(db);
            return { ok: true, message: "搜索历史已清空" };
          }
          /* ---- 估价 ---- */
          case "GET /api/estimates": {
            const user = this.current(db, store);
            if (!user) return { ok: true, estimates: [] };
            return { ok: true, estimates: db.estimates.filter((e) => e.userId === user.id).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) };
          }
          case "POST /api/estimates": {
            const user = me();
            const row = { ...body, id: body.id || nextId("e"), userId: user.id, createdAt: now() };
            db.estimates.unshift(row);
            db.estimates = db.estimates.slice(0, 50);
            Local.save(db);
            return { ok: true, id: row.id };
          }
          /* ---- 订单 ---- */
          case "GET /api/orders": {
            const user = me();
            const role = q.role || "buyer";
            let list = db.orders.filter((o) => {
              if (role === "buyer") return o.buyerId === user.id;
              if (role === "seller") return o.sellerId === user.id;
              return o.buyerId === user.id || o.sellerId === user.id;
            });
            if (q.status && q.status !== "all") list = list.filter((o) => o.status === q.status);
            list = list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
            const all = db.orders.filter((o) => o.buyerId === user.id || o.sellerId === user.id);
            return {
              ok: true,
              orders: list.map((o) => this.orderView(db, o)),
              stats: {
                all: all.length,
                pending: all.filter((o) => o.status === "待付款").length,
                shipping: all.filter((o) => o.status === "待发货").length,
                receiving: all.filter((o) => o.status === "待收货").length,
                done: all.filter((o) => o.status === "已完成").length,
                afterSale: all.filter((o) => ["售后中", "已退款"].includes(o.status)).length
              }
            };
          }
          case "POST /api/orders": {
            const user = me();
            const product = db.products.find((p) => p.id === body.productId);
            if (!product) this.fail("商品不存在");
            if (product.status !== "在售") this.fail(`该商品当前状态为「${product.status}」，无法下单`);
            if (product.ownerId === user.id) this.fail("不能购买自己发布的商品");
            let address = null;
            if (body.addressId) address = db.addresses.find((a) => a.id === Number(body.addressId) && a.userId === user.id);
            if (!address) {
              if (!/^1[3-9]\d{9}$/.test(String(body.phone || "")) || String(body.detail || "").length < 4) {
                this.fail("请填写完整的收货信息或选择已保存地址");
              }
              address = { name: body.name, phone: body.phone, region: body.region, detail: body.detail };
            }
            const t = now();
            const order = {
              id: nextId("o"), productId: product.id, productName: product.name, productImage: (product.images || [])[0] || "",
              scenic: product.scenic, buyerId: user.id, sellerId: product.ownerId, price: product.price,
              freight: product.freight, fee: Math.round(product.price * 0.02), address,
              status: "待付款", timeline: [{ at: t, label: "订单创建", extra: "等待买家付款，款项由平台担保" }],
              trackingNo: "", expressCompany: "", cancelReason: "", createdAt: t, updatedAt: t
            };
            db.orders.unshift(order);
            product.status = "交易中";
            this.notify(db, product.ownerId, "order", "有买家发起担保交易", `「${product.name}」等待买家付款`, "/orders/");
            this.audit(db, user.id, "create-order", `order:${order.id}`, product.name);
            Local.save(db);
            return { ok: true, order: this.orderView(db, order) };
          }
          /* ---- 公开概览 / 举报 / 埋点 ---- */
          case "GET /api/stats/overview": {
            const stats = this.localStats(db);
            return {
              ok: true,
              overview: {
                products: stats.onSale, scenicCount: D.SCENICS.length, categories: D.CATEGORIES.length,
                users: stats.users, estimates: stats.estimates, completedOrders: stats.completedOrders,
                reviews: stats.reviews, avgScore: stats.avgScore, gmv: stats.gmv
              }
            };
          }
          case "POST /api/reports": {
            const user = me();
            const row = {
              id: nextId("r"), targetType: body.targetType, targetId: body.targetId,
              targetLabel: String(body.targetLabel || "").slice(0, 60), reason: String(body.reason).slice(0, 40),
              detail: String(body.detail || "").slice(0, 300), reporterId: user.id, reporter: user.nickname,
              status: "待处理", handleNote: "", createdAt: now(), handledAt: null
            };
            db.reports.unshift(row);
            db.users.filter((u) => u.isAdmin).forEach((a) => this.notify(db, a.id, "audit", "收到新的举报", `${row.targetType} · ${row.reason}`, "/admin/"));
            this.audit(db, user.id, "report", `${row.targetType}:${row.targetId}`, row.reason);
            Local.save(db);
            return { ok: true, id: row.id, message: "举报已提交，平台将在 24 小时内处理（本地演示模式下由你在后台自行处理）" };
          }
          case "POST /api/events": {
            const user = this.current(db, store);
            db.events.push({ id: nextId("v"), userId: user?.id ?? null, visitor: body.visitor || "v_local", name: body.name, payload: body.payload || {}, createdAt: now() });
            db.events = db.events.slice(-2000);
            Local.save(db);
            return { ok: true, visitor: body.visitor || "v_local" };
          }
          default:
            break;
        }

        /* ---- 带路径参数的接口 ---- */
        if (seg[1] === "products" && seg[2]) {
          const id = decodeURIComponent(seg[2]);
          const row = db.products.find((p) => p.id === id);
          const viewer = this.current(db, store);
          if (route === `GET /api/products/${seg[2]}`) {
            if (!row) this.fail("商品不存在或已下架");
            if (row.status !== "在售" && row.ownerId !== viewer?.id && !viewer?.isAdmin) this.fail("该商品当前不可见");
            if (row) row.views += 1;
            if (viewer) {
              const exist = db.footprints.find((f) => f.userId === viewer.id && f.productId === id);
              if (exist) exist.viewedAt = now();
              else db.footprints.unshift({ userId: viewer.id, productId: id, viewedAt: now() });
              db.footprints = db.footprints.slice(0, 200);
            }
            Local.save(db);
            return { ok: true, product: this.productView(db, row, { withDetail: true, viewer }) };
          }
          if (route === `POST /api/products/${seg[2]}/view`) {
            if (row) row.views += 1;
            Local.save(db);
            return { ok: true };
          }
          if (route === `GET /api/products/${seg[2]}/price-history`) {
            if (!row) this.fail("商品不存在");
            return { ok: true, history: P.priceHistory(row), current: row.price, freight: row.freight };
          }
          if (route === `POST /api/products/${seg[2]}/questions`) {
            const user = me();
            if (!row) this.fail("商品不存在");
            const text = String(body.body || "").trim();
            if (text.length < 2 || text.length > 100) this.fail("问题需为 2-100 个字符");
            db.questions.unshift({ id: parseInt(nextId("9"), 36) % 1000000, productId: id, userId: user.id, asker: user.nickname, body: text, answer: "", createdAt: now(), answeredAt: null });
            this.notify(db, row.ownerId, "question", "有买家向你提问", text, `/market/?id=${id}`);
            Local.save(db);
            return { ok: true, message: "提问已提交" };
          }
          if (route === `POST /api/products/${seg[2]}/offline`) {
            const user = me();
            if (!row) this.fail("商品不存在");
            if (row.ownerId !== user.id && !user.isAdmin) this.fail("无操作权限");
            if (row.status === "交易中") this.fail("交易中的商品不能下架");
            row.status = "已下架";
            Local.save(db);
            return { ok: true, message: "商品已下架" };
          }
          if (route === `POST /api/products/${seg[2]}/relist`) {
            const user = me();
            if (!row) this.fail("商品不存在");
            if (row.ownerId !== user.id && !user.isAdmin) this.fail("无操作权限");
            row.status = "待审核";
            Local.save(db);
            return { ok: true, message: "已重新提交审核" };
          }
          if (route === `DELETE /api/products/${seg[2]}`) {
            const user = me();
            if (!row) this.fail("商品不存在");
            if (row.ownerId !== user.id && !user.isAdmin) this.fail("无操作权限");
            if (row.status === "交易中") this.fail("交易中的商品不能删除");
            db.products = db.products.filter((p) => p.id !== id);
            db.favorites = db.favorites.filter((f) => f.productId !== id);
            Local.save(db);
            return { ok: true, message: "商品已删除" };
          }
          if (route === `PATCH /api/products/${seg[2]}`) {
            const user = me();
            if (!row) this.fail("商品不存在");
            if (row.ownerId !== user.id && !user.isAdmin) this.fail("只能修改自己发布的商品");
            const check = P.validateProduct({ ...row, ...body }, { requireImages: false });
            if (!check.valid) this.fail(check.errors[0].message);
            Object.assign(row, body);
            if (row.ownerId === user.id) row.status = "待审核";
            Local.save(db);
            return { ok: true, message: "修改已保存，将重新进入审核" };
          }
        }

        if (seg[1] === "favorites" && seg[2]) {
          const user = me();
          const id = decodeURIComponent(seg[2]);
          const row = db.products.find((p) => p.id === id);
          if (!row) this.fail("商品不存在");
          if (route === `POST /api/favorites/${seg[2]}`) {
            const idx = db.favorites.findIndex((f) => f.userId === user.id && f.productId === id);
            if (idx >= 0) {
              db.favorites.splice(idx, 1);
              Local.save(db);
              return { ok: true, favorited: false, message: "已取消收藏" };
            }
            db.favorites.push({ userId: user.id, productId: id, priceAlert: 0, alertPrice: null, createdAt: now() });
            Local.save(db);
            return { ok: true, favorited: true, message: "已加入收藏" };
          }
          if (route === `POST /api/favorites/${seg[2]}/alert`) {
            const price = Math.round(Number(body.alertPrice));
            if (!Number.isFinite(price) || price <= 0) this.fail("请输入有效的提醒价格");
            if (price >= row.price) this.fail(`提醒价需低于当前售价 ¥${row.price}`);
            const exist = db.favorites.find((f) => f.userId === user.id && f.productId === id);
            if (exist) { exist.priceAlert = 1; exist.alertPrice = price; }
            else db.favorites.push({ userId: user.id, productId: id, priceAlert: 1, alertPrice: price, createdAt: now() });
            Local.save(db);
            return { ok: true, message: `已设置降价提醒：低于 ¥${price} 时通知你` };
          }
        }

        if (seg[1] === "questions" && seg[3] === "answer") {
          const user = me();
          const row = db.questions.find((qq) => String(qq.id) === String(seg[2]));
          if (!row) this.fail("问题不存在");
          const product = db.products.find((p) => p.id === row.productId);
          if (product && product.ownerId !== user.id && !user.isAdmin) this.fail("只有卖家可以回答");
          row.answer = String(body.answer || "").trim().slice(0, 200);
          row.answeredAt = now();
          this.notify(db, row.userId, "question", "卖家已回答你的提问", row.answer, `/market/?id=${row.productId}`);
          Local.save(db);
          return { ok: true, message: "回答已提交" };
        }

        if (seg[1] === "orders" && seg[2]) {
          const user = me();
          const order = db.orders.find((o) => o.id === decodeURIComponent(seg[2]));
          if (!order) this.fail("订单不存在");
          const isBuyer = order.buyerId === user.id;
          const isSeller = order.sellerId === user.id;
          if (!isBuyer && !isSeller && !user.isAdmin) this.fail("无权操作该订单");

          if (route === `GET /api/orders/${seg[2]}`) return { ok: true, order: this.orderView(db, order) };

          if (route === `POST /api/orders/${seg[2]}/review`) {
            if (order.status !== "已完成") this.fail("订单完成后才能评价");
            if (db.reviews.some((r) => r.orderId === order.id && r.fromUser === user.id)) this.fail("你已经评价过该订单");
            const score = Math.round(Number(body.score));
            if (!(score >= 1 && score <= 5)) this.fail("评分需为 1-5 星");
            const toUser = isBuyer ? order.sellerId : order.buyerId;
            db.reviews.unshift({
              id: db.reviews.length + 1, orderId: order.id, productId: order.productId, fromUser: user.id,
              toUser, role: isBuyer ? "buyer" : "seller", score, content: String(body.content || "").slice(0, 200),
              images: [], createdAt: now()
            });
            const target = db.users.find((u) => u.id === toUser);
            this.recalc(db, target);
            this.notify(db, toUser, "review", "收到一条新评价", `${score} 星：${body.content || "对方未填写评价内容"}`, "/profile/");
            Local.save(db);
            return { ok: true, message: "评价已提交，感谢你的反馈" };
          }

          const transitions = {
            pay: { to: "待发货", label: "买家付款", extra: "款项进入平台担保账户", actor: "buyer", fields: {} },
            confirm: { to: "已完成", label: "买家确认收货", extra: "担保款项已放款给卖家", actor: "buyer", fields: {} },
            cancel: { to: "已取消", label: "订单取消", extra: String(body.reason || "买家取消"), actor: "buyer", fields: { cancelReason: String(body.reason || "买家取消") } },
            refund: { to: "售后中", label: "买家发起售后", extra: String(body.reason || ""), actor: "buyer", fields: {} },
            "refund-accept": { to: "已退款", label: "卖家同意退款", extra: "款项原路退回买家", actor: "seller", fields: {} },
            ship: { to: "待收货", label: "卖家发货", extra: `${body.expressCompany || "顺丰速运"} ${body.trackingNo || ""}`, actor: "seller", fields: { expressCompany: body.expressCompany || "顺丰速运", trackingNo: String(body.trackingNo || "") } }
          };
          const key = seg[3];
          if (transitions[key]) {
            const t = transitions[key];
            if (t.actor === "buyer" && !isBuyer && !user.isAdmin) this.fail("只有买家可以执行该操作");
            if (t.actor === "seller" && !isSeller && !user.isAdmin) this.fail("只有卖家可以执行该操作");
            if (!P.canTransition(order.status, t.to)) this.fail(`订单当前状态为「${order.status}」，不能变更为「${t.to}」`);
            if (key === "refund" && String(body.reason || "").trim().length < 4) this.fail("请填写至少 4 个字的售后原因");
            if (key === "ship" && t.fields.trackingNo && !/^[A-Za-z0-9-]{6,24}$/.test(t.fields.trackingNo)) this.fail("快递单号格式不正确");
            Object.assign(order, t.fields, { status: t.to, updatedAt: now() });
            order.timeline.push({ at: now(), label: t.label, extra: t.extra });
            if (order.status === "已完成") {
              const seller = db.users.find((u) => u.id === order.sellerId);
              if (seller) seller.balance = (seller.balance || 0) + order.price + order.freight - order.fee;
              const product = db.products.find((p) => p.id === order.productId);
              if (product) product.status = "已售出";
              this.notify(db, order.sellerId, "wallet", "货款已入账", `「${order.productName}」到账 ¥${order.price + order.freight - order.fee}（已扣 2% 服务费）`, "/profile/");
            }
            if (order.status === "已取消" || order.status === "已退款") {
              const product = db.products.find((p) => p.id === order.productId);
              if (product) product.status = "在售";
            }
            this.audit(db, user.id, `order-${order.status}`, `order:${order.id}`, t.extra);
            Local.save(db);
            return { ok: true, order: this.orderView(db, order), message: t.label };
          }
        }

        if (seg[1] === "reviews" && method === "GET") {
          let list = db.reviews.slice();
          if (q.productId) list = list.filter((r) => r.productId === q.productId);
          if (q.userId) list = list.filter((r) => r.toUser === Number(q.userId));
          return {
            ok: true,
            reviews: list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 50).map((r) => {
              const from = db.users.find((u) => u.id === r.fromUser);
              return { id: r.id, productId: r.productId, score: r.score, content: r.content, nickname: from?.nickname || "匿名用户", credit: from?.credit, role: r.role, createdAt: r.createdAt };
            })
          };
        }

        if (route === "GET /api/conversations") {
          const user = me();
          return {
            ok: true,
            conversations: db.conversations.filter((c) => c.userId === user.id).sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1))
              .map((c) => {
                const peer = db.users.find((u) => u.id === c.peerId);
                return { ...c, peer_name: peer?.nickname || "已注销用户", peer_credit: peer?.credit };
              })
          };
        }
        if (route === "GET /api/messages") {
          const user = me();
          const peerId = Number(q.peer);
          const list = db.messages.filter((m) => (m.fromUser === user.id && m.toUser === peerId) || (m.fromUser === peerId && m.toUser === user.id));
          list.forEach((m) => { if (m.toUser === user.id) m.readAt = now(); });
          const conv = db.conversations.find((c) => c.userId === user.id && c.peerId === peerId);
          if (conv) conv.unread = 0;
          Local.save(db);
          return { ok: true, messages: list };
        }
        if (route === "POST /api/messages") {
          const user = me();
          const to = Number(body.to);
          const text = String(body.body || "").trim();
          if (!to || to === user.id) this.fail("请选择有效的接收方");
          if (text.length < 1 || text.length > 300) this.fail("消息长度需为 1-300 个字符");
          const hit = P.SENSITIVE_WORDS.filter((w) => text.includes(w));
          if (hit.length) this.fail(`消息包含违规词：${hit.join("、")}（平台禁止站外交易）`);
          const t = now();
          db.messages.push({ id: nextId("m"), fromUser: user.id, toUser: to, productId: body.productId || "", body: text, createdAt: t, readAt: null });
          const upsert = (ownerId, peerId, unread) => {
            const exist = db.conversations.find((c) => c.userId === ownerId && c.peerId === peerId);
            if (exist) { exist.lastBody = text; exist.lastAt = t; exist.unread = unread; exist.productId = body.productId || ""; }
            else db.conversations.push({ userId: ownerId, peerId, productId: body.productId || "", lastBody: text, lastAt: t, unread });
          };
          upsert(user.id, to, 0);
          upsert(to, user.id, (db.conversations.find((c) => c.userId === to && c.peerId === user.id)?.unread || 0) + 1);
          this.notify(db, to, "message", `来自 ${user.nickname} 的消息`, text.slice(0, 40), "/messages/");
          Local.save(db);
          return { ok: true, message: "已发送" };
        }

        if (route === "GET /api/notifications") {
          const user = this.current(db, store);
          if (!user) return { ok: true, notifications: [], unread: 0 };
          const list = db.notifications.filter((n) => n.userId === user.id);
          return { ok: true, notifications: list, unread: list.filter((n) => !n.readAt).length };
        }
        if (route === "POST /api/notifications/read") {
          const user = me();
          db.notifications.filter((n) => n.userId === user.id).forEach((n) => { n.readAt = now(); });
          Local.save(db);
          return { ok: true, message: "已标记为已读" };
        }

        /* ---- 本地模式下的运营后台 ---- */
        if (route.startsWith("GET /api/admin/") || route.startsWith("POST /api/admin/")) {
          const user = me();
          if (!user.isAdmin) this.fail("需要管理员权限（本地演示模式请用 18800000000 / admin888 登录）");
          if (route === "GET /api/admin/stats") return { ok: true, stats: this.localStats(db) };
          if (route === "GET /api/admin/products") {
            const status = q.status || "待审核";
            const list = status === "all" ? db.products : db.products.filter((p) => p.status === status);
            return { ok: true, products: list.map((p) => this.productView(db, p, { viewer: user })) };
          }
          if (route === "GET /api/admin/reports") {
            return {
              ok: true,
              reports: db.reports.slice().sort((a, b) => (a.status === "待处理" ? -1 : 1)).map((r) => ({ ...r, reporter: db.users.find((u) => u.id === r.reporterId)?.nickname || "用户" }))
            };
          }
          if (route === "GET /api/admin/users") {
            return {
              ok: true,
              users: db.users.map((u) => ({
                ...this.publicUser(u), status: u.status,
                productCount: db.products.filter((p) => p.ownerId === u.id).length,
                orderCount: db.orders.filter((o) => o.buyerId === u.id || o.sellerId === u.id).length
              }))
            };
          }
          if (route === "GET /api/admin/audit") {
            return { ok: true, logs: db.auditLogs.slice(0, 80).map((l) => ({ ...l, nickname: db.users.find((u) => u.id === l.actorId)?.nickname || "系统" })) };
          }
          if (seg[2] === "products" && seg[4] === "review") {
            const row = db.products.find((p) => p.id === decodeURIComponent(seg[3]));
            if (!row) this.fail("商品不存在");
            if (!body.approve && !String(body.reason || "").trim()) this.fail("驳回时必须填写原因");
            row.status = body.approve ? "在售" : "已下架";
            row.rejectReason = body.approve ? "" : String(body.reason);
            this.notify(db, row.ownerId, "audit", body.approve ? "商品审核通过" : "商品未通过审核",
              body.approve ? `「${row.name}」已在集市上架` : `「${row.name}」驳回原因：${body.reason}`, "/market/");
            Local.save(db);
            return { ok: true, message: body.approve ? "已通过审核并上架" : "已驳回并通知发布者" };
          }
          if (seg[2] === "reports" && seg[3]) {
            const row = db.reports.find((r) => String(r.id) === String(seg[3]));
            if (!row) this.fail("举报不存在");
            row.status = body.accept ? "已处理" : "已驳回";
            row.handleNote = String(body.note || "").slice(0, 200);
            row.handledAt = now();
            if (body.accept) {
              if (row.targetType === "product") {
                const p = db.products.find((x) => x.id === row.targetId);
                if (p) { p.status = "已下架"; this.notify(db, p.ownerId, "audit", "商品因违规被下架", row.handleNote || "违反平台规则", "/market/"); }
              }
              if (row.targetType === "user") this.recalc(db, db.users.find((u) => String(u.id) === String(row.targetId)));
              if (row.targetType === "review") db.reviews = db.reviews.filter((r) => String(r.id) !== String(row.targetId));
              if (row.targetType === "question") db.questions = db.questions.filter((qq) => String(qq.id) !== String(row.targetId));
            }
            this.notify(db, row.reporterId, "audit", "举报处理完成", body.accept ? `已处理：${row.handleNote || "违规内容已下架"}` : "经核实未违规", "/market/");
            Local.save(db);
            return { ok: true, message: "处理完成" };
          }
          if (seg[2] === "users" && seg[4] === "status") {
            const target = db.users.find((u) => String(u.id) === String(seg[3]));
            if (!target) this.fail("用户不存在");
            if (target.id === user.id) this.fail("不能冻结自己的账号");
            target.status = body.status === "frozen" ? "frozen" : "active";
            if (target.status === "frozen" && db.sessionUserId === target.id) db.sessionUserId = null;
            Local.save(db);
            return { ok: true, message: target.status === "frozen" ? "账号已冻结" : "账号已恢复" };
          }
        }

        if (route === "POST /api/uploads") {
          me();
          if (!/^data:image\/(png|jpe?g|webp);base64,/.test(String(body.dataUrl || ""))) this.fail("仅支持 PNG / JPEG / WebP 格式的图片");
          const size = Math.round(String(body.dataUrl).length * 0.75);
          if (size > 3 * 1024 * 1024) this.fail("单张图片不能超过 3MB（已自动压缩，请重试）");
          /* 本地模式直接把 dataURL 存进商品记录 */
          return { ok: true, url: String(body.dataUrl) };
        }

        this.fail(`本地演示模式暂不支持该接口：${route}`);
        return null;
      })();
      return Promise.resolve(result);
    },

    localCounts(db, user) {
      return {
        estimates: db.estimates.filter((e) => e.userId === user.id).length,
        products: db.products.filter((p) => p.ownerId === user.id).length,
        favorites: db.favorites.filter((f) => f.userId === user.id).length,
        orders: db.orders.filter((o) => o.buyerId === user.id || o.sellerId === user.id).length,
        unreadMsg: db.conversations.filter((c) => c.userId === user.id).reduce((a, c) => a + (c.unread || 0), 0),
        unreadNotice: db.notifications.filter((n) => n.userId === user.id && !n.readAt).length
      };
    },

    localStats(db) {
      const dayAgo = Date.now() - 86400000;
      const weekAgo = Date.now() - 7 * 86400000;
      const within = (iso, ms) => new Date(iso).getTime() > ms;
      const pv = db.events.length;
      const uv = new Set(db.events.map((e) => e.visitor)).size;
      const gmv = db.orders.filter((o) => o.status === "已完成").reduce((a, o) => a + o.price + o.freight, 0);
      const daily = (list) => {
        const map = new Map();
        list.forEach((row) => {
          const day = String(row.createdAt).slice(0, 10);
          map.set(day, (map.get(day) || 0) + 1);
        });
        return [...map.entries()].sort().slice(-14).map(([day, c]) => ({ day, c }));
      };
      const scenicMap = new Map();
      db.products.forEach((p) => {
        const row = scenicMap.get(p.scenic) || { scenic: p.scenic, c: 0, views: 0 };
        row.c += 1;
        row.views += p.views || 0;
        scenicMap.set(p.scenic, row);
      });
      const categoryMap = new Map();
      db.products.forEach((p) => {
        const row = categoryMap.get(p.category) || { category: p.category, c: 0, sum: 0 };
        row.c += 1;
        row.sum += p.price;
        categoryMap.set(p.category, row);
      });
      const reviews = db.reviews;
      return {
        users: db.users.filter((u) => u.status === "active").length,
        newUsers7d: db.users.filter((u) => within(u.createdAt, weekAgo)).length,
        verifiedUsers: db.users.filter((u) => u.idVerified).length,
        products: db.products.length,
        onSale: db.products.filter((p) => p.status === "在售").length,
        pendingAudit: db.products.filter((p) => p.status === "待审核").length,
        orders: db.orders.length,
        completedOrders: db.orders.filter((o) => o.status === "已完成").length,
        gmv,
        estimates: db.estimates.length,
        reports: db.reports.length,
        pendingReports: db.reports.filter((r) => r.status === "待处理").length,
        reviews: reviews.length,
        avgScore: reviews.length ? Math.round((reviews.reduce((a, r) => a + r.score, 0) / reviews.length) * 10) / 10 : 0,
        messages: db.messages.length,
        pv, uv,
        dau: new Set(db.events.filter((e) => within(e.createdAt, dayAgo)).map((e) => e.visitor)).size,
        conversion: pv ? Math.round((db.orders.length / pv) * 1000) / 10 : 0,
        events7d: (() => {
          const map = new Map();
          db.events.filter((e) => within(e.createdAt, weekAgo)).forEach((e) => map.set(e.name, (map.get(e.name) || 0) + 1));
          return [...map.entries()].map(([name, c]) => ({ name, c })).sort((a, b) => b.c - a.c).slice(0, 12);
        })(),
        scenicRank: [...scenicMap.values()].sort((a, b) => b.views - a.views),
        categoryRank: [...categoryMap.values()].map((r) => ({ category: r.category, c: r.c, avgPrice: Math.round(r.sum / r.c) })).sort((a, b) => b.c - a.c),
        dailyPv: daily(db.events),
        dailyOrders: daily(db.orders),
        local: true
      };
    }
  };

  Store.LocalApi = LocalApi;
  Store.resetLocal = () => {
    try { localStorage.removeItem(DB_KEY); } catch { /* ignore */ }
    return Local.seed();
  };

  root.Store = Store;
})(typeof window !== "undefined" ? window : globalThis);
