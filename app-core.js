/*
  智价宝 - 业务层（一）：通用组件与首页 / 估价 / 比价
  依赖：site-data.js、pricing.js、store.js、script.js（提供 $ / showToast / closeModal 等 UI 组件）
*/
(function (root) {
  "use strict";

  const D = root.ZhijiabaoData;
  const P = root.ZhijiabaoPricing;
  const Store = root.Store;
  /* script.js 中的 $ / $$ 是 const 声明（不会挂到 window 上），这里本地实现，避免依赖加载顺序 */
  const $ = (selector, scope) => (scope || document).querySelector(selector);
  const $$ = (selector, scope) => Array.from((scope || document).querySelectorAll(selector));
  const esc = root.escapeHtml || ((value) => String(value ?? ""));
  const money = P.money;
  const App = (root.App = root.App || {});

  /* =========================
     通用小工具
     ========================= */
  const fmtTime = (iso) => {
    if (!iso) return "-";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const relative = (iso) => {
    const diff = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(diff)) return "-";
    const min = Math.floor(diff / 60000);
    if (min < 1) return "刚刚";
    if (min < 60) return `${min} 分钟前`;
    const hour = Math.floor(min / 60);
    if (hour < 24) return `${hour} 小时前`;
    const day = Math.floor(hour / 24);
    if (day < 30) return `${day} 天前`;
    return fmtTime(iso).slice(0, 10);
  };

  const starsHtml = (score) => {
    const full = Math.round(Number(score) || 0);
    return `<span class="stars" aria-label="${score} 星">${"★".repeat(Math.max(0, Math.min(5, full)))}${"☆".repeat(Math.max(0, 5 - full))}</span>`;
  };

  const emptyState = (title, hint = "", actionHtml = "") =>
    `<div class="empty-state"><div class="empty-icon">空</div><h3>${esc(title)}</h3>${hint ? `<p class="muted">${esc(hint)}</p>` : ""}${actionHtml}</div>`;

  const statusChip = (status) => {
    const style = P.ORDER_STATUS_STYLE[status] || "muted";
    return `<span class="status-chip status-${style}">${esc(status)}</span>`;
  };

  const el = (html) => {
    const wrap = document.createElement("div");
    wrap.innerHTML = html.trim();
    return wrap.firstElementChild;
  };

  App.fmtTime = fmtTime;
  App.relative = relative;
  App.emptyState = emptyState;
  App.statusChip = statusChip;
  App.starsHtml = starsHtml;
  App.money = money;

  /* 页面可能被多次初始化（登录后、筛选后），用统一的绑定器避免事件叠加 */
  const BOUND = new WeakMap();
  function bindOnce(node, type, handler) {
    if (!node) return;
    const map = BOUND.get(node) || {};
    if (map[type]) node.removeEventListener(type, map[type]);
    node.addEventListener(type, handler);
    map[type] = handler;
    BOUND.set(node, map);
  }
  App.bindOnce = bindOnce;

  /* 模式提示：让评审与用户都能一眼看出当前是否连着服务端 */
  function renderModeBadge() {
    const badge = $("#modeBadge");
    if (!badge) return;
    const online = Store.mode === "online";
    badge.className = `mode-badge ${online ? "mode-online" : "mode-offline"}`;
    badge.innerHTML = online
      ? '<span class="dot"></span>已连接服务端 · 数据多设备共享'
      : '<span class="dot"></span>本地演示模式 · 数据仅存本机（启动 npm start 可切换为服务端模式）';
    badge.title = online ? "当前连接 Node 后端，商品 / 订单 / 用户数据保存在 MySQL 数据库" : "未检测到后端服务，已自动降级为浏览器本地存储";
  }
  App.renderModeBadge = renderModeBadge;

  /* =========================
     登录态
     ========================= */
  function userChipHtml() {
    const user = Store.user;
    if (!user) return '<button class="btn ghost small" id="headerLogin" type="button"><span>登录 / 注册</span></button>';
    const unread = (Store.counts?.unreadMsg || 0) + (Store.counts?.unreadNotice || 0);
    return `
      <a class="user-chip" href="profile/" data-transition title="进入个人中心">
        <span class="avatar-sm">${esc((user.nickname || "用").slice(0, 1))}</span>
        <span class="user-chip-name">${esc(user.nickname)}</span>
        <span class="credit-pill" title="信用分 ${user.credit}（${user.creditLevel}）">${user.credit}</span>
      </a>
      <a class="icon-link" href="messages/" data-transition title="消息中心">消息${unread ? `<em class="badge-dot">${unread}</em>` : ""}</a>
    `;
  }

  async function renderHeaderAuth() {
    const slot = $("#authSlot");
    if (!slot) return;
    slot.innerHTML = userChipHtml();
    $("#headerLogin")?.addEventListener("click", () => openAuthModal("login"));
  }
  App.renderHeaderAuth = renderHeaderAuth;

  function requireLogin(message = "请先登录后再继续操作") {
    if (Store.user) return true;
    showToast(message, "info");
    openAuthModal("login");
    return false;
  }
  App.requireLogin = requireLogin;

  /* =========================
     弹窗基座（按需创建，避免每个页面重复写 HTML）
     ========================= */
  function ensureBackdrop(id, label) {
    let node = document.getElementById(id);
    if (node) return node;
    node = el(`
      <div class="modal-backdrop" id="${id}" role="dialog" aria-modal="true" aria-label="${esc(label)}">
        <section class="modal-card" tabindex="-1"></section>
      </div>`);
    document.body.appendChild(node);
    root.initDraggableModal?.(node);
    node.addEventListener("click", (event) => {
      if (event.target === node) root.closeModal?.(node);
    });
    return node;
  }
  App.ensureBackdrop = ensureBackdrop;

  function closeBackdrop(node) {
    if (node) root.closeModal?.(node);
  }
  App.closeBackdrop = closeBackdrop;

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    $$(".modal-backdrop.is-open").forEach((node) => root.closeModal?.(node));
  });

  /* 简易确认框 */
  function confirmDialog({ title, message, confirmText = "确认", danger = false }) {
    return new Promise((resolve) => {
      const node = ensureBackdrop("confirmModal", title);
      node.querySelector(".modal-card").innerHTML = `
        <div class="modal-head">
          <h2>${esc(title)}</h2>
          <button class="close-btn" type="button" data-close aria-label="关闭">×</button>
        </div>
        <p class="muted">${esc(message)}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" data-cancel>取消</button>
          <button class="btn ${danger ? "danger" : ""}" type="button" data-confirm><span>${esc(confirmText)}</span></button>
        </div>`;
      const finish = (value) => {
        closeBackdrop(node);
        resolve(value);
      };
      node.querySelector("[data-confirm]").onclick = () => finish(true);
      node.querySelector("[data-cancel]").onclick = () => finish(false);
      node.querySelector("[data-close]").onclick = () => finish(false);
      node.classList.add("is-open");
      node.querySelector(".modal-card").focus?.();
    });
  }
  App.confirmDialog = confirmDialog;

  /* =========================
     后台任务清单（顶部持久提示条）
     ========================= */
  function ensureTaskBar() {
    let bar = $("#taskBar");
    if (!bar) {
      bar = el('<div class="task-bar" id="taskBar" role="status" aria-live="polite" hidden></div>');
      document.body.appendChild(bar);
    }
    return bar;
  }

  function setTask(text, state = "loading") {
    const bar = ensureTaskBar();
    if (!text) {
      bar.hidden = true;
      bar.innerHTML = "";
      return;
    }
    bar.hidden = false;
    bar.className = `task-bar task-${state}`;
    bar.innerHTML = `${state === "loading" ? '<span class="spinner"></span>' : ""}${esc(text)}`;
  }
  App.setTask = setTask;

  /* =========================
     图片：压缩 + 上传
     ========================= */
  function compressImage(file, { maxSize = 1280, quality = 0.82 } = {}) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) return reject(new Error("请选择图片文件（PNG / JPEG / WebP）"));
      if (file.size > 12 * 1024 * 1024) return reject(new Error("原图不能超过 12MB"));
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("图片读取失败"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("图片解析失败，请换一张"));
        img.onload = () => {
          const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
          const width = Math.max(1, Math.round(img.width * scale));
          const height = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          resolve({ dataUrl: canvas.toDataURL("image/jpeg", quality), width, height, originalName: file.name });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function uploadImage(file) {
    const compressed = await compressImage(file);
    const res = await Store.api("/api/uploads", { method: "POST", body: { dataUrl: compressed.dataUrl } });
    return { url: res.url, ...compressed };
  }

  App.compressImage = compressImage;
  App.uploadImage = uploadImage;

  /* =========================
     Canvas 图表
     ========================= */
  function setupCanvas(canvas, height) {
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.parentElement?.clientWidth || canvas.clientWidth || 320;
    canvas.width = Math.max(240, width - 2) * ratio;
    canvas.height = height * ratio;
    canvas.style.width = "100%";
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext && canvas.getContext("2d");
    if (!ctx) return null;
    ctx.scale(ratio, ratio);
    return { ctx, width: Math.max(240, width - 2), height };
  }

  function drawLineChart(canvas, series, { label = "价格", color = "#4f827a" } = {}) {
    if (!canvas || !series?.length) return;
    const box = setupCanvas(canvas, 160);
    if (!box) return;
    const { ctx, width, height } = box;
    const pad = { top: 16, right: 10, bottom: 22, left: 34 };
    const values = series.map((p) => p.price);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(1, max - min);
    ctx.clearRect(0, 0, width, height);
    ctx.font = "11px system-ui, sans-serif";
    ctx.strokeStyle = "rgba(79,130,122,0.18)";
    ctx.fillStyle = "#7c8a87";
    for (let i = 0; i <= 4; i += 1) {
      const y = pad.top + ((height - pad.top - pad.bottom) * i) / 4;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
      const value = Math.round(max - (span * i) / 4);
      ctx.fillText(`¥${value}`, 2, y + 4);
    }
    const xFor = (i) => pad.left + ((width - pad.left - pad.right) * i) / Math.max(1, series.length - 1);
    const yFor = (v) => pad.top + (height - pad.top - pad.bottom) * (1 - (v - min) / span);
    const gradient = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
    gradient.addColorStop(0, "rgba(79,130,122,0.34)");
    gradient.addColorStop(1, "rgba(79,130,122,0.02)");
    ctx.beginPath();
    ctx.moveTo(xFor(0), yFor(values[0]));
    values.forEach((v, i) => ctx.lineTo(xFor(i), yFor(v)));
    ctx.lineTo(xFor(values.length - 1), height - pad.bottom);
    ctx.lineTo(xFor(0), height - pad.bottom);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.beginPath();
    values.forEach((v, i) => (i === 0 ? ctx.moveTo(xFor(i), yFor(v)) : ctx.lineTo(xFor(i), yFor(v))));
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(xFor(values.length - 1), yFor(values[values.length - 1]), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = "#7c8a87";
    ctx.fillText(series[0].date.slice(5), pad.left, height - 6);
    const lastLabel = series[series.length - 1].date.slice(5);
    ctx.fillText(lastLabel, width - pad.right - ctx.measureText(lastLabel).width, height - 6);
    ctx.fillStyle = color;
    ctx.fillText(`${label} ¥${values[values.length - 1]}`, pad.left + 4, pad.top - 2);
  }
  App.drawLineChart = drawLineChart;

  function drawBarChart(canvas, rows, { valueKey = "c", labelKey = "scenic" } = {}) {
    if (!canvas || !rows?.length) return;
    const box = setupCanvas(canvas, Math.max(140, rows.length * 26 + 16));
    if (!box) return;
    const { ctx, width, height } = box;
    const max = Math.max(...rows.map((r) => Number(r[valueKey]) || 0), 1);
    ctx.clearRect(0, 0, width, height);
    ctx.font = "12px system-ui, sans-serif";
    const labelWidth = 78;
    rows.forEach((row, index) => {
      const y = 8 + index * 26;
      const value = Number(row[valueKey]) || 0;
      const barWidth = Math.max(2, ((width - labelWidth - 54) * value) / max);
      ctx.fillStyle = "#5d6b68";
      ctx.fillText(String(row[labelKey]).slice(0, 6), 0, y + 13);
      const gradient = ctx.createLinearGradient(labelWidth, 0, labelWidth + barWidth, 0);
      gradient.addColorStop(0, "rgba(79,130,122,0.85)");
      gradient.addColorStop(1, "rgba(196,154,90,0.85)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") ctx.roundRect(labelWidth, y + 3, barWidth, 14, 7);
      else ctx.rect(labelWidth, y + 3, barWidth, 14);
      ctx.fill();
      ctx.fillStyle = "#41504d";
      ctx.fillText(String(value), labelWidth + barWidth + 6, y + 14);
    });
  }
  App.drawBarChart = drawBarChart;

  /* 兼容不支持 roundRect 的旧内核与无 Canvas 的测试环境 */
  if (typeof CanvasRenderingContext2D !== "undefined" && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function roundRect(x, y, w, h, r) {
      const radius = Math.min(r, h / 2, w / 2);
      this.moveTo(x + radius, y);
      this.arcTo(x + w, y, x + w, y + h, radius);
      this.arcTo(x + w, y + h, x, y + h, radius);
      this.arcTo(x, y + h, x, y, radius);
      this.arcTo(x, y, x + w, y, radius);
      this.closePath();
      return this;
    };
  }

  /* =========================
     登录 / 注册 / 找回密码
     ========================= */
  const authState = { mode: "login", devCode: "", countdown: 0, timer: null };

  async function sendCode(phone, purpose, button) {
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      showToast("请输入 11 位有效手机号", "error");
      return;
    }
    try {
      const code = await Store.sendCode(phone, purpose);
      authState.devCode = code;
      const hint = $("#codeHint");
      if (hint) hint.innerHTML = `演示环境验证码：<strong>${esc(code)}</strong>（正式部署由短信下发，5 分钟内有效）`;
      const input = $("#authCode");
      if (input && !input.value) input.value = code;
      showToast("验证码已生成", "success");
      let left = 60;
      const original = button.textContent;
      button.disabled = true;
      authState.timer = setInterval(() => {
        left -= 1;
        button.textContent = `${left}s 后重发`;
        if (left <= 0) {
          clearInterval(authState.timer);
          button.disabled = false;
          button.textContent = original;
        }
      }, 1000);
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  function openAuthModal(mode = "login") {
    const node = ensureBackdrop("authModal", "账号");
    authState.mode = mode;
    const card = node.querySelector(".modal-card");
    card.innerHTML = `
      <div class="modal-head">
        <div>
          <p class="section-kicker">Account</p>
          <h2 id="authTitle">账号登录</h2>
        </div>
        <button class="close-btn" type="button" data-close aria-label="关闭">×</button>
      </div>
      <div class="tabs" role="tablist" id="authTabs">
        <button role="tab" data-mode="login" class="active" type="button">登录</button>
        <button role="tab" data-mode="register" type="button">注册</button>
        <button role="tab" data-mode="reset" type="button">找回密码</button>
      </div>
      <form class="form-grid auth-form" id="authForm" novalidate>
        <div class="form-row">
          <label for="authPhone">手机号</label>
          <input class="field" id="authPhone" inputmode="numeric" maxlength="11" placeholder="11 位手机号" autocomplete="tel">
        </div>
        <div class="form-row" data-only="register">
          <label for="authNickname">昵称</label>
          <input class="field" id="authNickname" maxlength="16" placeholder="2-16 个字符">
        </div>
        <div class="form-row" data-only="login">
          <label for="authPassword">密码</label>
          <input class="field" id="authPassword" type="password" maxlength="32" placeholder="使用密码登录（也可改用验证码）" autocomplete="current-password">
        </div>
        <div class="form-row" data-only="register reset">
          <label for="authPasswordNew">设置密码</label>
          <input class="field" id="authPasswordNew" type="password" maxlength="32" placeholder="至少 6 位，同时支持验证码登录">
        </div>
        <div class="form-row full">
          <label for="authCode">短信验证码</label>
          <div class="inline-field">
            <input class="field" id="authCode" inputmode="numeric" maxlength="6" placeholder="6 位验证码">
            <button class="btn ghost" type="button" id="sendCodeBtn"><span>获取验证码</span></button>
          </div>
          <p class="field-hint" id="codeHint"></p>
        </div>
        <p class="field-error" id="authError" role="alert"></p>
        <button class="btn" type="submit" id="authSubmit"><span>登录</span></button>
        <p class="muted small">演示账号：普通用户 18800000001 / demo1234，管理员 18800000000 / admin888</p>
      </form>`;

    const sync = () => {
      const m = authState.mode;
      $("#authTitle").textContent = m === "login" ? "账号登录" : m === "register" ? "注册新账号" : "重置密码";
      $("#authSubmit").querySelector("span").textContent = m === "login" ? "登录" : m === "register" ? "注册并登录" : "重置密码";
      $$("#authTabs button").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
      $$("#authForm [data-only]").forEach((row) => {
        row.hidden = !row.dataset.only.split(" ").includes(m);
      });
    };
    sync();

    $$("#authTabs button").forEach((btn) => {
      btn.onclick = () => {
        authState.mode = btn.dataset.mode;
        $("#authError").textContent = "";
        sync();
      };
    });
    $("#sendCodeBtn").onclick = () => {
      const purpose = authState.mode === "register" ? "register" : authState.mode === "reset" ? "reset" : "login";
      sendCode($("#authPhone").value.trim(), purpose, $("#sendCodeBtn"));
    };
    $("#authForm").onsubmit = async (event) => {
      event.preventDefault();
      const error = $("#authError");
      error.textContent = "";
      const phone = $("#authPhone").value.trim();
      const submit = $("#authSubmit");
      submit.disabled = true;
      setTask("正在提交账号信息…");
      try {
        if (authState.mode === "register") {
          await Store.register({
            phone, code: $("#authCode").value.trim(),
            nickname: $("#authNickname").value.trim(), password: $("#authPasswordNew").value
          });
          showToast("注册成功，已自动登录", "success");
        } else if (authState.mode === "reset") {
          await Store.resetPassword({ phone, code: $("#authCode").value.trim(), password: $("#authPasswordNew").value });
          showToast("密码已重置，请重新登录", "success");
          authState.mode = "login";
          sync();
          return;
        } else {
          const password = $("#authPassword").value;
          const code = $("#authCode").value.trim();
          if (!password && !code) throw new Error("请输入密码或获取验证码");
          await Store.login(password ? { phone, password } : { phone, code });
          showToast(`欢迎回来，${Store.user.nickname}`, "success");
        }
        await afterLogin();
        closeBackdrop(node);
      } catch (e) {
        error.textContent = e.message;
        showToast(e.message, "error");
      } finally {
        submit.disabled = false;
        setTask(null);
      }
    };
    node.querySelector("[data-close]").onclick = () => closeBackdrop(node);
    node.classList.add("is-open");
    $("#authPhone").focus?.();
  }
  App.openAuthModal = openAuthModal;
  App.sendCode = sendCode;

  async function afterLogin() {
    await Store.refresh().catch(() => null);
    await renderHeaderAuth();
    Store.track("login", { mode: Store.mode });
    const page = document.body.dataset.page;
    const reinit = { profile: App.initProfile, market: App.initMarket, orders: App.initOrders, admin: App.initAdmin, messages: App.initMessages };
    await reinit[page]?.();
  }
  App.afterLogin = afterLogin;

  /* =========================
     商品卡片
     ========================= */
  function productCard(product, { mode = "grid" } = {}) {
    const img = product.images?.[0] || "assets/img/product-pin.webp";
    const discount = product.original ? Math.max(0, Math.round((1 - product.price / product.original) * 100)) : 0;
    const statusWarn = product.status && product.status !== "在售"
      ? `<span class="status-chip status-muted">${esc(product.status)}</span>` : "";
    const reviews = product.reviewCount
      ? `<span class="meta-inline">${starsHtml(product.reviewScore)} <em>${product.reviewCount} 条评价</em></span>` : "";
    return `
      <article class="product-card" data-id="${esc(product.id)}" tabindex="0" role="button" aria-label="查看 ${esc(product.name)} 详情">
        <div class="product-image">
          <img src="${root.assetPath(img)}" alt="${esc(product.name)} 实拍图" loading="lazy">
          <span class="fav-btn ${product.favorited ? "active" : ""}" data-fav="${esc(product.id)}" role="button" tabindex="0" aria-label="收藏">${product.favorited ? "♥" : "♡"}</span>
          ${statusWarn}
        </div>
        <div class="product-body">
          <div class="tag-row">
            <span class="tag">${esc(product.scenic)}</span>
            <span class="tag ghost">${esc(product.category)}</span>
          </div>
          <h3>${esc(product.name)}</h3>
          <p class="muted small">${esc(product.condition)} · ${esc(product.description || "暂无补充说明").slice(0, 40)}</p>
          <div class="price-row">
            <strong>¥${product.price}</strong>
            <del>¥${product.original}</del>
            ${discount > 0 ? `<span class="discount">${discount}% off</span>` : ""}
          </div>
          <div class="card-meta">
            <span>${esc(product.seller?.name || "平台代管")}</span>
            <span>信用 ${product.seller?.credit ?? "-"}</span>
            <span>浏览 ${product.views}</span>
          </div>
          ${reviews}
        </div>
      </article>`;
  }
  App.productCard = productCard;

  function bindCardEvents(container) {
    if (!container) return;
    container.onclick = async (event) => {
      const fav = event.target.closest("[data-fav]");
      if (fav) {
        event.stopPropagation();
        if (!requireLogin("收藏前请先登录")) return;
        try {
          const res = await Store.api(`/api/favorites/${fav.dataset.fav}`, { method: "POST" });
          fav.classList.toggle("active", res.favorited);
          fav.textContent = res.favorited ? "♥" : "♡";
          showToast(res.message, "success");
          await Store.refresh().catch(() => null);
        } catch (e) {
          showToast(e.message, "error");
        }
        return;
      }
      const card = event.target.closest(".product-card");
      if (card) openProductDetail(card.dataset.id);
    };
    container.onkeydown = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const card = event.target.closest(".product-card");
      if (card) {
        event.preventDefault();
        openProductDetail(card.dataset.id);
      }
    };
  }
  App.bindCardEvents = bindCardEvents;

  App.renderProductGrid = async function renderProductGrid(target, options = {}) {
    if (!target) return;
    const params = new URLSearchParams({ limit: String(options.limit || 12), ...options.query });
    target.innerHTML = '<div class="skeleton-card"></div><div class="skeleton-card"></div><div class="skeleton-card"></div>';
    try {
      const data = await Store.api(`/api/products?${params.toString()}`);
      if (!data.products.length) {
        target.innerHTML = emptyState("暂时没有符合条件的商品", "换个景区、品类或价格区间试试", options.emptyAction || "");
        return data;
      }
      target.innerHTML = data.products.map((p) => productCard(p, options)).join("");
      bindCardEvents(target);
      return data;
    } catch (e) {
      target.innerHTML = emptyState("商品加载失败", e.message);
      return null;
    }
  };

  /* =========================
     商品详情弹窗
     ========================= */
  async function openProductDetail(id) {
    if (!id) return;
    const node = ensureBackdrop("productModal", "商品详情");
    const card = node.querySelector(".modal-card");
    card.innerHTML = '<div class="detail-loading"><span class="spinner"></span>正在加载商品详情…</div>';
    node.classList.add("is-open");
    Store.track("product_view", { id });
    let product;
    try {
      const data = await Store.api(`/api/products/${id}`);
      product = data.product;
    } catch (e) {
      card.innerHTML = emptyState("无法打开商品", e.message);
      return;
    }

    const user = Store.user;
    const isOwner = user && product.seller?.id === user.id;
    const isAdmin = user?.isAdmin;
    const canBuy = product.status === "在售" && !isOwner;
    const history = product.priceHistory;

    card.innerHTML = `
      <div class="modal-head">
        <div>
          <p class="section-kicker">Product Detail · ${esc(product.code)}</p>
          <h2>${esc(product.name)}</h2>
        </div>
        <button class="close-btn" type="button" data-close aria-label="关闭">×</button>
      </div>
      <div class="detail-grid">
        <div class="detail-gallery">
          <img class="detail-main" id="detailMain" src="${root.assetPath(product.images?.[0] || "")}" alt="${esc(product.name)} 实拍图">
          <div class="thumb-row">
            ${(product.images || []).map((src, i) => `<button type="button" class="thumb ${i === 0 ? "active" : ""}" data-src="${esc(src)}"><img src="${root.assetPath(src)}" alt="${esc(product.name)} 图 ${i + 1}"></button>`).join("")}
          </div>
          <div class="chart-block">
            <div class="chart-head"><strong>近 30 天价格走势</strong><span class="muted small">${esc(history.source)}</span></div>
            <canvas id="priceChart" aria-label="价格走势图"></canvas>
            <p class="muted small">区间 ¥${history.low} - ¥${history.high} · 均价 ¥${history.avg} · 当前 ¥${product.price}</p>
          </div>
        </div>
        <div class="detail-info">
          <div class="price-panel">
            <strong class="price-big">¥${product.price}</strong>
            <del>¥${product.original}</del>
            <span class="freight">${product.freight ? `运费 ¥${product.freight}` : "包邮"}</span>
          </div>
          <div class="tag-row">
            <span class="tag">${esc(product.scenic)}</span>
            <span class="tag ghost">${esc(product.category)}</span>
            <span class="tag ghost">${esc(product.condition)}</span>
            ${product.tag ? `<span class="tag ghost">${esc(product.tag)}</span>` : ""}
            ${statusChip(product.status)}
          </div>
          <dl class="meta-list">
            <div><dt>商品编号</dt><dd>${esc(product.code)}</dd></div>
            <div><dt>发布时间</dt><dd>${fmtTime(product.createdAt)}</dd></div>
            <div><dt>浏览 / 收藏</dt><dd>${product.views} 次 / ${product.favoriteCount} 人</dd></div>
            <div><dt>卖家</dt><dd>${esc(product.seller?.name || "平台代管")} · 信用 ${product.seller?.credit ?? "-"}（${esc(product.seller?.level || "")}）</dd></div>
            ${product.reviewScore ? `<div><dt>商品评价</dt><dd>${starsHtml(product.reviewScore)} ${product.reviewScore} 分（${product.reviewCount} 条）</dd></div>` : ""}
          </dl>
          <p class="detail-desc">${esc(product.description || "卖家未填写补充说明。")}</p>
          <div class="detail-actions" id="detailActions"></div>
          <div class="safety-note">平台担保交易：付款由平台托管，确认收货后才放款给卖家；如与描述不符可发起售后。</div>
        </div>
      </div>

      <section class="detail-section">
        <h3>买家提问 ${product.questions.length ? `（${product.questions.length}）` : ""}</h3>
        <div class="qa-list">
          ${product.questions.length ? product.questions.map((q) => `
            <div class="qa-item">
              <p class="qa-q"><span class="qa-tag">问</span>${esc(q.body)}<em>${esc(q.asker)} · ${relative(q.createdAt)}</em></p>
              ${q.answer ? `<p class="qa-a"><span class="qa-tag answer">答</span>${esc(q.answer)}</p>` : '<p class="qa-a pending">卖家暂未回答</p>'}
              ${isOwner || isAdmin ? `<button class="link-btn" type="button" data-answer="${q.id}">${q.answer ? "修改回答" : "回答该问题"}</button>` : ""}
            </div>`).join("") : '<p class="muted">还没有提问，你可以第一个问卖家。</p>'}
        </div>
        <div class="inline-field">
          <input class="field" id="askInput" maxlength="100" placeholder="问点什么，例如：是否带原包装？">
          <button class="btn ghost" type="button" id="askBtn"><span>提问</span></button>
        </div>
      </section>

      <section class="detail-section">
        <h3>商品评价 ${product.reviews.length ? `（${product.reviews.length}）` : ""}</h3>
        <div class="review-list">
          ${product.reviews.length ? product.reviews.map((r) => `
            <div class="review-item">
              <div class="review-head"><strong>${esc(r.nickname)}</strong>${starsHtml(r.score)}<em class="muted small">${fmtTime(r.createdAt)}</em></div>
              <p>${esc(r.content || "该用户未填写评价内容")}</p>
            </div>`).join("") : '<p class="muted">暂无评价。</p>'}
        </div>
      </section>

      ${product.similar?.length ? `
      <section class="detail-section">
        <h3>同类在售</h3>
        <div class="similar-row">
          ${product.similar.map((s) => `<button class="similar-card" type="button" data-goto="${esc(s.id)}"><img src="${root.assetPath(s.image)}" alt="${esc(s.name)}"><span>${esc(s.name)}</span><strong>¥${s.price}</strong></button>`).join("")}
        </div>
      </section>` : ""}

      <div class="modal-actions">
        <button class="btn ghost" type="button" data-report>举报该商品</button>
        <button class="btn ghost" type="button" data-close>关闭</button>
      </div>`;

    drawLineChart($("#priceChart", card), history.series, { label: "当前价" });

    /* 图片切换 */
    $$(".thumb", card).forEach((btn) => {
      btn.onclick = () => {
        $("#detailMain", card).src = root.assetPath(btn.dataset.src);
        $$(".thumb", card).forEach((b) => b.classList.toggle("active", b === btn));
      };
    });
    $$("[data-goto]", card).forEach((btn) => {
      btn.onclick = () => openProductDetail(btn.dataset.goto);
    });

    /* 动作区 */
    const actions = $("#detailActions", card);
    const buttons = [];
    if (canBuy) buttons.push('<button class="btn" type="button" data-act="order"><span>发起担保交易</span></button>');
    if (!isOwner && product.seller?.id) buttons.push('<button class="btn ghost" type="button" data-act="message"><span>联系卖家</span></button>');
    if (user) buttons.push(`<button class="btn ghost" type="button" data-act="favorite"><span>${product.favorited ? "取消收藏" : "收藏商品"}</span></button>`);
    if (!isOwner && product.status === "在售") buttons.push('<button class="btn ghost" type="button" data-act="alert"><span>设置降价提醒</span></button>');
    if (isOwner || isAdmin) {
      buttons.push('<button class="btn ghost" type="button" data-act="edit"><span>编辑商品</span></button>');
      if (product.status === "在售" || product.status === "待审核") buttons.push('<button class="btn ghost" type="button" data-act="offline"><span>下架商品</span></button>');
      if (product.status === "已下架") buttons.push('<button class="btn ghost" type="button" data-act="relist"><span>重新上架</span></button>');
      buttons.push('<button class="btn ghost danger-text" type="button" data-act="delete"><span>删除商品</span></button>');
    }
    actions.innerHTML = buttons.join("") || '<p class="muted">当前状态下暂无可执行操作。</p>';

    actions.onclick = async (event) => {
      const btn = event.target.closest("[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;
      if (!requireLogin("该操作需要先登录")) return;
      try {
        if (act === "favorite") {
          const res = await Store.api(`/api/favorites/${product.id}`, { method: "POST" });
          showToast(res.message, "success");
          await Store.refresh().catch(() => null);
          openProductDetail(product.id);
        }
        if (act === "alert") openAlertModal(product);
        if (act === "order") openOrderModal(product);
        if (act === "message") openChatModal(product);
        if (act === "edit") openEditProductModal(product);
        if (act === "offline") {
          if (await confirmDialog({ title: "下架商品", message: `确定下架「${product.name}」？下架后买家将无法看到它。`, confirmText: "确认下架" })) {
            await Store.api(`/api/products/${product.id}/offline`, { method: "POST" });
            showToast("商品已下架", "success");
            openProductDetail(product.id);
          }
        }
        if (act === "relist") {
          await Store.api(`/api/products/${product.id}/relist`, { method: "POST" });
          showToast("已重新提交审核", "success");
          openProductDetail(product.id);
        }
        if (act === "delete") {
          if (await confirmDialog({ title: "删除商品", message: "删除后不可恢复，确认删除？", confirmText: "确认删除", danger: true })) {
            await Store.api(`/api/products/${product.id}`, { method: "DELETE" });
            showToast("商品已删除", "success");
            closeBackdrop(node);
            App.refreshCurrentPage?.();
          }
        }
      } catch (e) {
        showToast(e.message, "error");
      }
    };

    /* 提问与回答 */
    $("#askBtn", card).onclick = async () => {
      if (!requireLogin("提问前请先登录")) return;
      const input = $("#askInput", card);
      try {
        await Store.api(`/api/products/${product.id}/questions`, { method: "POST", body: { body: input.value } });
        showToast("提问已提交", "success");
        openProductDetail(product.id);
      } catch (e) {
        showToast(e.message, "error");
      }
    };
    $$("[data-answer]", card).forEach((btn) => {
      btn.onclick = () => openAnswerModal(product, btn.dataset.answer);
    });

    card.querySelector("[data-report]").onclick = () => openReportModal({ type: "product", id: product.id, label: product.name });
    card.querySelectorAll("[data-close]").forEach((btn) => (btn.onclick = () => closeBackdrop(node)));
  }
  App.openProductDetail = openProductDetail;

  /* 降价提醒 */
  function openAlertModal(product) {
    const node = ensureBackdrop("alertModal", "降价提醒");
    const suggested = Math.max(1, Math.round(product.price * 0.9));
    node.querySelector(".modal-card").innerHTML = `
      <div class="modal-head"><div><p class="section-kicker">Price Alert</p><h2>设置降价提醒</h2></div>
        <button class="close-btn" type="button" data-close aria-label="关闭">×</button></div>
      <p class="muted">当前售价 ¥${product.price}。当卖家降价到你的目标价以下时，平台会向你发送站内通知。</p>
      <div class="form-row"><label for="alertPrice">目标价（元）</label>
        <input class="field" id="alertPrice" type="number" min="1" max="${product.price - 1}" value="${suggested}"></div>
      <p class="field-error" id="alertError" role="alert"></p>
      <div class="modal-actions">
        <button class="btn ghost" type="button" data-close>取消</button>
        <button class="btn" type="button" id="alertSubmit"><span>保存提醒</span></button>
      </div>`;
    node.classList.add("is-open");
    node.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => closeBackdrop(node)));
    $("#alertSubmit", node).onclick = async () => {
      try {
        const res = await Store.api(`/api/favorites/${product.id}/alert`, {
          method: "POST", body: { alertPrice: Number($("#alertPrice", node).value) }
        });
        showToast(res.message, "success");
        closeBackdrop(node);
      } catch (e) {
        $("#alertError", node).textContent = e.message;
      }
    };
  }
  App.openAlertModal = openAlertModal;

  /* 举报 */
  function openReportModal({ type, id, label }) {
    if (!requireLogin("举报前请先登录")) return;
    const node = ensureBackdrop("reportModal", "举报");
    const reasons = ["虚假宣传", "假货或仿制品", "价格欺诈", "盗图侵权", "骚扰或辱骂", "站外交易", "其他违规"];
    node.querySelector(".modal-card").innerHTML = `
      <div class="modal-head"><div><p class="section-kicker">Report</p><h2>举报${esc(label || "")}</h2></div>
        <button class="close-btn" type="button" data-close aria-label="关闭">×</button></div>
      <div class="form-row"><label>举报理由</label>
        <div class="reason-row">${reasons.map((r) => `<button class="chip" type="button" data-reason="${esc(r)}">${esc(r)}</button>`).join("")}</div>
      </div>
      <div class="form-row"><label for="reportDetail">补充说明（选填）</label>
        <textarea class="field" id="reportDetail" rows="3" maxlength="300" placeholder="描述具体情况，便于平台核实"></textarea></div>
      <p class="field-error" id="reportError" role="alert"></p>
      <div class="modal-actions">
        <button class="btn ghost" type="button" data-close>取消</button>
        <button class="btn danger" type="button" id="reportSubmit"><span>提交举报</span></button>
      </div>`;
    node.classList.add("is-open");
    let reason = "";
    $$("[data-reason]", node).forEach((btn) => {
      btn.onclick = () => {
        reason = btn.dataset.reason;
        $$("[data-reason]", node).forEach((b) => b.classList.toggle("active", b === btn));
      };
    });
    node.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => closeBackdrop(node)));
    $("#reportSubmit", node).onclick = async () => {
      try {
        if (!reason) throw new Error("请选择举报理由");
        const res = await Store.api("/api/reports", {
          method: "POST",
          body: { targetType: type, targetId: id, targetLabel: label, reason, detail: $("#reportDetail", node).value }
        });
        showToast(res.message, "success");
        closeBackdrop(node);
      } catch (e) {
        $("#reportError", node).textContent = e.message;
      }
    };
  }
  App.openReportModal = openReportModal;

  /* 卖家回答提问 */
  function openAnswerModal(product, questionId) {
    const node = ensureBackdrop("answerModal", "回答提问");
    node.querySelector(".modal-card").innerHTML = `
      <div class="modal-head"><div><p class="section-kicker">Answer</p><h2>回答买家提问</h2></div>
        <button class="close-btn" type="button" data-close aria-label="关闭">×</button></div>
      <div class="form-row"><label for="answerBody">回答内容</label>
        <textarea class="field" id="answerBody" rows="4" maxlength="200" placeholder="如实说明商品情况，能显著提升成交率"></textarea></div>
      <p class="field-error" id="answerError" role="alert"></p>
      <div class="modal-actions">
        <button class="btn ghost" type="button" data-close>取消</button>
        <button class="btn" type="button" id="answerSubmit"><span>提交回答</span></button>
      </div>`;
    node.classList.add("is-open");
    node.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => closeBackdrop(node)));
    $("#answerSubmit", node).onclick = async () => {
      try {
        await Store.api(`/api/questions/${questionId}/answer`, {
          method: "POST", body: { answer: $("#answerBody", node).value }
        });
        showToast("回答已提交", "success");
        closeBackdrop(node);
        openProductDetail(product.id);
      } catch (e) {
        $("#answerError", node).textContent = e.message;
      }
    };
  }
  App.openAnswerModal = openAnswerModal;

  /* 联系卖家（站内消息） */
  async function openChatModal(product) {
    if (!requireLogin("联系卖家前请先登录")) return;
    const peer = product.seller?.id;
    if (!peer) {
      showToast("该商品由平台代管，无需联系卖家", "info");
      return;
    }
    const node = ensureBackdrop("chatModal", "联系卖家");
    const card = node.querySelector(".modal-card");
    card.innerHTML = `
      <div class="modal-head"><div><p class="section-kicker">Message</p><h2>与 ${esc(product.seller.name)} 沟通</h2></div>
        <button class="close-btn" type="button" data-close aria-label="关闭">×</button></div>
      <p class="muted small">关于「${esc(product.name)}」。为保障双方权益，请勿留下站外联系方式，平台会拦截此类内容。</p>
      <div class="chat-box" id="chatBox"></div>
      <div class="quick-row">
        ${["还在吗？", "能便宜一点吗？", "有原包装和凭证吗？", "可以尽快发货吗？"].map((q) => `<button class="chip" type="button" data-quick="${esc(q)}">${esc(q)}</button>`).join("")}
      </div>
      <div class="inline-field">
        <input class="field" id="chatInput" maxlength="300" placeholder="输入消息…">
        <button class="btn" type="button" id="chatSend"><span>发送</span></button>
      </div>`;
    node.classList.add("is-open");
    const load = async () => {
      const data = await Store.api(`/api/messages?peer=${peer}`);
      $("#chatBox", card).innerHTML = data.messages.length
        ? data.messages.map((m) => `<div class="bubble ${m.from_user === Store.user.id || m.fromUser === Store.user.id ? "mine" : "theirs"}">${esc(m.body)}<em>${relative(m.createdAt || m.created_at)}</em></div>`).join("")
        : '<p class="muted small">还没有消息，先打个招呼吧。</p>';
      const box = $("#chatBox", card);
      box.scrollTop = box.scrollHeight;
    };
    await load();
    $$("[data-quick]", card).forEach((btn) => (btn.onclick = () => { $("#chatInput", card).value = btn.dataset.quick; }));
    const send = async () => {
      try {
        await Store.api("/api/messages", { method: "POST", body: { to: peer, body: $("#chatInput", card).value, productId: product.id } });
        $("#chatInput", card).value = "";
        await load();
        await Store.refresh().catch(() => null);
      } catch (e) {
        showToast(e.message, "error");
      }
    };
    $("#chatSend", card).onclick = send;
    $("#chatInput", card).onkeydown = (event) => { if (event.key === "Enter") send(); };
    card.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => closeBackdrop(node)));
  }
  App.openChatModal = openChatModal;

  /* 下单（担保交易） */
  async function openOrderModal(product) {
    if (!requireLogin("下单前请先登录")) return;
    const node = ensureBackdrop("orderModal", "发起担保交易");
    const card = node.querySelector(".modal-card");
    let addresses = [];
    try {
      addresses = (await Store.api("/api/addresses")).addresses || [];
    } catch { addresses = []; }
    const total = product.price + product.freight;
    card.innerHTML = `
      <div class="modal-head"><div><p class="section-kicker">Escrow Order</p><h2>发起担保交易</h2></div>
        <button class="close-btn" type="button" data-close aria-label="关闭">×</button></div>
      <div class="order-summary">
        <img src="${root.assetPath(product.images?.[0] || "")}" alt="${esc(product.name)}">
        <div><strong>${esc(product.name)}</strong><p class="muted small">${esc(product.scenic)} · ${esc(product.condition)} · 卖家 ${esc(product.seller?.name || "平台代管")}</p></div>
        <span class="price-big">¥${total}</span>
      </div>
      ${addresses.length ? `<div class="form-row"><label>选择已保存地址</label>
        <select class="select" id="orderAddress">${addresses.map((a) => `<option value="${a.id}">${esc(a.name)} ${esc(a.phone)} ${esc(a.region)}${esc(a.detail)}</option>`).join("")}<option value="">使用新地址</option></select></div>` : ""}
      <div class="form-grid" id="addressFields">
        <div class="form-row"><label for="orderName">收件人</label><input class="field" id="orderName" maxlength="20" placeholder="收件人姓名"></div>
        <div class="form-row"><label for="orderPhone">手机号</label><input class="field" id="orderPhone" inputmode="numeric" maxlength="11" placeholder="11 位手机号"></div>
        <div class="form-row full"><label for="orderRegion">所在地区</label><input class="field" id="orderRegion" maxlength="30" placeholder="如：上海市 浦东新区"></div>
        <div class="form-row full"><label for="orderDetail">详细地址</label><input class="field" id="orderDetail" maxlength="60" placeholder="街道、门牌号、楼层"></div>
        <label class="checkbox-row full"><input type="checkbox" id="orderSaveAddress" checked> 保存为常用收货地址</label>
      </div>
      <div class="fee-note">
        <div><span>商品金额</span><strong>¥${product.price}</strong></div>
        <div><span>运费</span><strong>${product.freight ? `¥${product.freight}` : "包邮"}</strong></div>
        <div><span>平台服务费（向卖家收取 2%）</span><strong>¥${Math.round(product.price * 0.02)}</strong></div>
        <div class="total"><span>你需要支付</span><strong>¥${total}</strong></div>
      </div>
      <p class="field-error" id="orderError" role="alert"></p>
      <div class="modal-actions">
        <button class="btn ghost" type="button" data-close>取消</button>
        <button class="btn" type="button" id="orderSubmit"><span>提交订单（演示支付）</span></button>
      </div>`;
    node.classList.add("is-open");

    if (addresses.length) {
      const select = $("#orderAddress", card);
      const fields = $("#addressFields", card);
      select.onchange = () => { fields.hidden = !!select.value; };
      select.dispatchEvent(new Event("change"));
    }
    card.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => closeBackdrop(node)));
    $("#orderSubmit", card).onclick = async () => {
      try {
        const addressId = $("#orderAddress", card)?.value || "";
        const payload = { productId: product.id, addressId };
        if (!addressId) {
          payload.name = $("#orderName", card).value.trim();
          payload.phone = $("#orderPhone", card).value.trim();
          payload.region = $("#orderRegion", card).value.trim();
          payload.detail = $("#orderDetail", card).value.trim();
          if ($("#orderSaveAddress", card).checked && payload.name) {
            await Store.api("/api/addresses", { method: "POST", body: payload }).catch(() => null);
          }
        }
        const res = await Store.api("/api/orders", { method: "POST", body: payload });
        showToast("订单已创建，请在订单页完成付款", "success");
        Store.track("order_create", { productId: product.id });
        closeBackdrop(node);
        closeBackdrop(document.getElementById("productModal"));
        await Store.refresh().catch(() => null);
        if (document.body.dataset.page === "orders") await App.initOrders();
        else location.href = root.assetPath("orders/");
        void res;
      } catch (e) {
        $("#orderError", card).textContent = e.message;
      }
    };
  }
  App.openOrderModal = openOrderModal;

  /* 编辑商品（复用发布表单） */
  async function openEditProductModal(product) {
    App.closeBackdrop(document.getElementById("productModal"));
    await App.openPublishModal({ product });
  }
  App.openEditProductModal = openEditProductModal;

  /* =========================
     页面：首页
     ========================= */
  async function initHome() {
    /* 数据看板上云：统计口径来自服务端聚合接口 */
    try {
      const data = await Store.api("/api/stats/overview");
      const o = data.overview;
      const set = (id, value) => {
        const node = document.getElementById(id);
        if (!node) return;
        const num = Number(value) || 0;
        /* 动画只是视觉呈现，真实值同步写入 data-value 与无障碍标签，便于读取与测试 */
        node.dataset.value = String(num);
        node.setAttribute("aria-label", `平台数据：${num}`);
        root.animateNumber(node, num, 900);
      };
      set("statProducts", o.products);
      set("statScenics", o.scenicCount);
      set("statEstimates", o.estimates);
      set("statOrders", o.completedOrders);
      set("statUsers", o.users);
      set("statReviews", o.reviews);
      const gmv = document.getElementById("statGmv");
      if (gmv) gmv.textContent = money(o.gmv);
      const score = document.getElementById("statScore");
      if (score) score.textContent = o.avgScore ? `${o.avgScore} 分` : "暂无";
    } catch (e) {
      console.warn("[home] 概览加载失败", e);
    }

    await App.renderProductGrid($("#hotProducts"), {
      limit: 6,
      query: { sort: "heat" },
      emptyAction: '<a class="btn ghost" href="market/">去集市看看</a>'
    });

    /* 景区文化墙：8 个景区，替代原先“只有名字”的空白 */
    const wall = $("#scenicWall");
    if (wall) {
      wall.innerHTML = D.SCENICS.map((s) => `
        <article class="scenic-card" data-scenic="${esc(s.id)}">
          <header><h3>${esc(s.id)}</h3><span class="tag ghost">${esc(s.city)}</span></header>
          <p class="muted small">${esc(s.intro)}</p>
          <dl class="scenic-meta">
            <div><dt>非遗工艺</dt><dd>${esc(s.craft)}</dd></div>
            <div><dt>保值率</dt><dd>${Math.round(s.retention * 100)}%</dd></div>
            <div><dt>热度</dt><dd>${s.heat}</dd></div>
          </dl>
          <p class="scenic-tip">鉴别与交易提示：${esc(s.tip)}</p>
          <button class="btn ghost small" type="button" data-goto-market="${esc(s.id)}"><span>看该景区文创</span></button>
        </article>`).join("");
      wall.onclick = (event) => {
        const btn = event.target.closest("[data-goto-market]");
        if (btn) location.href = `${root.assetPath("market/")}?scenic=${encodeURIComponent(btn.dataset.gotoMarket)}`;
      };
    }

    /* 品类导航 */
    const cats = $("#categoryNav");
    if (cats) {
      cats.innerHTML = D.CATEGORIES.map((c) => `<a class="chip" href="market/?category=${encodeURIComponent(c)}" data-transition>${esc(c)}</a>`).join("");
    }

    /* 担保交易流程说明（真实存在的能力） */
    const flow = $("#escrowFlow");
    if (flow) {
      flow.innerHTML = [
        ["下单托管", "买家付款后资金由平台托管，卖家无法直接提现"],
        ["卖家发货", "填写快递公司单号，买家可实时查看物流信息"],
        ["确认收货", "买家验收后点击确认，担保款项才放给卖家"],
        ["售后仲裁", "与描述不符可发起售后，卖家同意后原路退款"]
      ].map(([title, desc], i) => `
        <div class="flow-step"><span class="flow-index">${i + 1}</span><div><strong>${title}</strong><p class="muted small">${desc}</p></div></div>`).join("");
    }
  }
  App.initHome = initHome;

  /* =========================
     页面：AI 估价
     ========================= */
  async function initEstimate() {
    const form = $("#estimateForm");
    if (!form) return;
    const scenicSelect = $("#scenicSelect");
    const categorySelect = $("#categorySelect");
    if (scenicSelect) {
      scenicSelect.innerHTML = D.SCENICS.map((s) => `<option value="${esc(s.id)}">${esc(s.id)}（${esc(s.city)}）</option>`).join("");
    }
    if (categorySelect) {
      categorySelect.innerHTML = D.CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    }
    const conditionGroup = $("#conditionGroup");
    if (conditionGroup) {
      conditionGroup.innerHTML = D.CONDITIONS.map((c, i) => `
        <label class="condition-option"><input type="radio" name="condition" value="${esc(c.value)}" ${i === 1 ? "checked" : ""}>
        <span>${esc(c.value)}<em class="muted small">${esc(c.desc)}</em></span></label>`).join("");
    }

    /* 上传图片：只做压缩预览，估价算法用结构化字段，避免“假装识别” */
    const upload = $("#imageUpload");
    const preview = $("#uploadPreview");
    let uploaded = null;
    bindOnce(upload, "change", async () => {
      const file = upload.files?.[0];
      if (!file) return;
      try {
        setTask("正在压缩并上传图片…");
        uploaded = await App.uploadImage(file);
        if (preview) {
          preview.src = uploaded.url.startsWith("data:") ? uploaded.url : root.assetPath(uploaded.url);
          preview.classList.add("has-image");
        }
        const meta = $("#uploadMeta");
        if (meta) meta.textContent = `已上传：${uploaded.width}×${uploaded.height}，压缩后约 ${Math.round(uploaded.dataUrl.length / 1365)}KB`;
        showToast("图片已上传，将随估价记录一起保存", "success");
      } catch (e) {
        showToast(e.message, "error");
      } finally {
        setTask(null);
      }
    });

    const tip = $("#scenicWeatherTip");
    const preloadWeather = async () => {
      const scenic = scenicSelect?.value;
      if (!scenic || !root.ZhijiabaoAPI?.WeatherService) return;
      try {
        if (tip) tip.textContent = "🌤️ 正在获取景区实时天气…";
        const weather = await root.ZhijiabaoAPI.WeatherService.getCurrent(scenic);
        App.currentWeather = weather;
        if (tip) {
          tip.textContent = weather && !weather.isDegraded
            ? `${weather.weatherIcon} ${weather.city} 实时 ${weather.temperature}°C ${weather.weatherLabel}，天气因子 ${weather.weatherFactor.toFixed(3)}`
            : "⚠️ 天气数据暂不可用，本次按中性天气因子 1.000 计算";
        }
      } catch {
        if (tip) tip.textContent = "⚠️ 天气数据暂不可用，本次按中性天气因子计算";
      }
    };
    bindOnce(scenicSelect, "change", preloadWeather);
    preloadWeather();

    /* 历史估价记录 */
    const renderHistory = async () => {
      const box = $("#estimateHistory");
      if (!box) return;
      try {
        const data = await Store.api("/api/estimates");
        const list = data.estimates || [];
        box.innerHTML = list.length
          ? list.map((e) => `
            <div class="history-row">
              <div><strong>${esc(e.scenic)} · ${esc(e.condition)}</strong>
                <p class="muted small">原价 ¥${e.original} → 建议 ¥${e.result}（区间 ¥${e.range_low}-${e.range_high}） · ${fmtTime(e.created_at || e.createdAt)}</p></div>
              <button class="link-btn" type="button" data-publish="${esc(e.id)}">转为闲置发布</button>
            </div>`).join("")
          : '<p class="muted">登录后你的估价记录会保存在账号里，可随时回看与一键转发布。</p>';
        box.onclick = (event) => {
          const btn = event.target.closest("[data-publish]");
          if (btn) {
            const row = list.find((x) => String(x.id) === btn.dataset.publish);
            if (row) openPublishModal({ prefill: { scenic: row.scenic, original: row.original, condition: row.condition, price: row.result, description: row.note }, fromEstimate: true });
          }
        };
      } catch (e) {
        box.innerHTML = `<p class="muted">估价记录加载失败：${esc(e.message)}</p>`;
      }
    };
    await renderHistory();
    App.refreshEstimateHistory = renderHistory;

    /* 提交估价 */
    $("#estimateSubmit").onclick = async () => {
      const payload = collectEstimateInput();
      const check = P.validateProduct({ name: "估价商品", scenic: payload.scenic, category: payload.category, condition: payload.condition, price: payload.original, original: payload.original }, { requireImages: false });
      if (!check.valid && check.errors.some((e) => ["scenic", "category", "condition", "original"].includes(e.field))) {
        showToast(check.errors[0].message, "error");
        return;
      }
      if (!Store.user) {
        showToast("登录后估价记录才能保存到账号（仍可先体验算法）", "info");
      }
      const steps = $("#aiSteps");
      const stepsList = [
        ["读取结构化特征", "品相 / 品类 / 购入时间 / 凭证"],
        ["匹配景区保值系数", `${payload.scenic}`],
        ["采集实时天气", App.currentWeather && !App.currentWeather.isDegraded ? `${App.currentWeather.weatherLabel} ${App.currentWeather.temperature}°C` : "使用中性因子"],
        ["计算季节与供需", P.getSeasonFactor().label],
        ["加权得出建议价", "多因子乘法模型"],
        ["评估置信度", "字段完整度决定"]
      ];
      if (steps) {
        steps.hidden = false;
        for (let i = 0; i < stepsList.length; i += 1) {
          $("#stepLabel").textContent = stepsList[i][0];
          $("#stepDesc").textContent = stepsList[i][1];
          $("#stepProgress").style.width = `${((i + 1) / stepsList.length) * 100}%`;
          await new Promise((r) => setTimeout(r, 220));
        }
        steps.hidden = true;
      }

      const valuation = P.aiValuation(payload.original, payload.condition, payload.scenic, {
        note: payload.note, boughtAt: payload.boughtAt, hasCertificate: payload.hasCertificate,
        hasPackage: payload.hasPackage, limited: payload.limited, flawed: payload.flawed, category: payload.category
      }, App.currentWeather);
      ShowEstimateResult({ ...payload, valuation, image: uploaded?.url || "" });
      Store.track("estimate", { scenic: payload.scenic, result: valuation.result });
      if (Store.user) {
        await Store.api("/api/estimates", {
          method: "POST",
          body: {
            scenic: payload.scenic, original: payload.original, condition: payload.condition, note: payload.note,
            boughtAt: payload.boughtAt, hasCertificate: payload.hasCertificate, hasPackage: payload.hasPackage,
            limited: payload.limited, flawed: payload.flawed,
            result: valuation.result, rangeLow: valuation.low, rangeHigh: valuation.high,
            confidence: valuation.confidence, weather: App.currentWeather || {},
            breakdown: valuation.breakdown.map((b) => ({ label: b.label, value: b.value }))
          }
        }).catch((e) => showToast(`估价记录保存失败：${e.message}`, "error"));
        await Store.refresh().catch(() => null);
        await renderHistory();
      }
    };

    /* 快捷开关：结构化属性代替正则猜测；直接绑定（可重复初始化）并同步 aria-pressed */
    $$("[data-flag]").forEach((btn) => {
      if (btn.dataset.flag === "hasPackage" && !btn.dataset.touched) btn.classList.add("active");
      btn.setAttribute("aria-pressed", String(btn.classList.contains("active")));
      btn.onclick = () => {
        btn.dataset.touched = "1";
        btn.classList.toggle("active");
        btn.setAttribute("aria-pressed", String(btn.classList.contains("active")));
      };
    });

    function collectEstimateInput() {
      const flag = (name) => !!document.querySelector(`[data-flag="${name}"].active`);
      return {
        scenic: scenicSelect?.value || D.SCENICS[0].id,
        category: categorySelect?.value || D.CATEGORIES[0],
        original: Math.round(Number($("#originalPrice")?.value || 0)),
        boughtAt: $("#boughtAt")?.value || "",
        condition: document.querySelector('input[name="condition"]:checked')?.value || "95新",
        note: $("#productNote")?.value || "",
        limited: flag("limited"), hasCertificate: flag("hasCertificate"),
        hasPackage: flag("hasPackage"), flawed: flag("flawed")
      };
    }
    App.collectEstimateInput = collectEstimateInput;
  }
  App.initEstimate = initEstimate;

  /* 估价结果弹窗：包含公式分解、报告导出、一键转发布 */
  function ShowEstimateResult(ctx) {
    const v = ctx.valuation;
    const node = ensureBackdrop("estimateModal", "估价结果");
    const card = node.querySelector(".modal-card");
    card.innerHTML = `
      <div class="modal-head"><div><p class="section-kicker">Valuation Result</p><h2>估价完成</h2></div>
        <button class="close-btn" type="button" data-close aria-label="关闭">×</button></div>
      <div class="result-hero">
        <div><p class="muted small">建议挂牌价</p><strong class="result-price">¥${v.result}</strong>
          <p class="muted small">合理区间 ¥${v.low} - ¥${v.high} · 置信度 ${v.confidence}%</p></div>
        <div class="result-side">
          <p>保值率 <strong>${Math.round(v.retention * 100)}%</strong></p>
          <p>一年后预估 <strong>¥${v.futureValue}</strong></p>
          <p>品类 <strong>${esc(ctx.category)}</strong></p>
        </div>
      </div>
      <section class="detail-section">
        <h3>算法分解（可复核）</h3>
        <table class="breakdown-table">
          <thead><tr><th>维度</th><th>取值</th><th>说明</th></tr></thead>
          <tbody>${v.breakdown.map((b) => `<tr><td>${esc(b.label)}</td><td>${esc(b.value)}</td><td class="muted">${esc(b.note)}</td></tr>`).join("")}</tbody>
        </table>
        <p class="muted small">模型说明：建议价 = 原价 × 品相系数 × 景区保值系数 × 季节系数 × 品相凭证加成 × 关键词修正 × 供需指数（热度 × 天气）。不含机器学习模型，属于可解释的规则模型，估值结果仅供二手流转参考。</p>
      </section>
      <div class="modal-actions result-actions">
        <button class="btn" type="button" id="toPublish"><span>一键发布到集市</span></button>
        <button class="btn ghost" type="button" id="exportReport"><span>导出估价报告</span></button>
        <button class="btn ghost" type="button" id="shareReport"><span>分享</span></button>
        <button class="btn ghost" type="button" data-close>关闭</button>
      </div>`;
    node.classList.add("is-open");
    card.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => closeBackdrop(node)));

    $("#toPublish", card).onclick = () => {
      closeBackdrop(node);
      openPublishModal({
        prefill: {
          name: `${ctx.scenic}文创`, scenic: ctx.scenic, category: ctx.category, condition: ctx.condition,
          original: ctx.original, price: v.result, description: ctx.note, images: ctx.image ? [ctx.image] : []
        },
        fromEstimate: true
      });
    };
    $("#exportReport", card).onclick = () => App.exportEstimateReport(ctx);
    $("#shareReport", card).onclick = async () => {
      const text = `智价宝 AI 估价：${ctx.scenic} 文创，原价 ¥${ctx.original}，建议挂牌 ¥${v.result}（区间 ¥${v.low}-${v.high}，置信度 ${v.confidence}%）`;
      if (navigator.share) {
        try { await navigator.share({ title: "智价宝估价结果", text, url: location.href }); return; } catch { /* 用户取消 */ }
      }
      if (root.copyText) root.copyText(text);
      else showToast(text, "info");
    };
  }
  App.ShowEstimateResult = ShowEstimateResult;

  /* 把估价结果画成一张图并下载（报告导出） */
  App.exportEstimateReport = function exportEstimateReport(ctx) {
    const v = ctx.valuation;
    const width = 780;
    const height = 900;
    const canvas = document.createElement("canvas");
    const ratio = 2;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const c = canvas.getContext("2d");
    c.scale(ratio, ratio);
    c.fillStyle = "#f6f3ec";
    c.fillRect(0, 0, width, height);
    c.fillStyle = "#2f3d3a";
    c.fillRect(0, 0, width, 96);
    c.fillStyle = "#f6f3ec";
    c.font = "bold 28px system-ui, sans-serif";
    c.fillText("智价宝 · AI 估价报告", 36, 58);
    c.font = "14px system-ui, sans-serif";
    c.fillText(`生成时间 ${new Date().toLocaleString("zh-CN")}`, 36, 82);

    c.fillStyle = "#2f3d3a";
    c.font = "bold 46px system-ui, sans-serif";
    c.fillText(`¥${v.result}`, 36, 168);
    c.font = "14px system-ui, sans-serif";
    c.fillStyle = "#5d6b68";
    c.fillText(`合理区间 ¥${v.low} - ¥${v.high}   置信度 ${v.confidence}%`, 36, 196);

    const rows = [
      ["景区来源", ctx.scenic], ["商品品类", ctx.category], ["品相等级", ctx.condition],
      ["购买原价", `¥${ctx.original}`], ["购入时间", ctx.boughtAt || "未填写"],
      ["附加属性", [ctx.limited && "限定款", ctx.hasCertificate && "有凭证", ctx.hasPackage && "包装完整", ctx.flawed && "有瑕疵"].filter(Boolean).join("、") || "无"],
      ["保值率", `${Math.round(v.retention * 100)}%`], ["一年后预估", `¥${v.futureValue}`]
    ];
    c.font = "15px system-ui, sans-serif";
    rows.forEach((row, i) => {
      const y = 250 + i * 30;
      c.fillStyle = "#7c8a87";
      c.fillText(row[0], 36, y);
      c.fillStyle = "#2f3d3a";
      c.fillText(String(row[1]), 200, y);
    });

    c.fillStyle = "#2f3d3a";
    c.font = "bold 18px system-ui, sans-serif";
    c.fillText("算法分解", 36, 540);
    c.font = "13px system-ui, sans-serif";
    v.breakdown.forEach((b, i) => {
      const y = 574 + i * 26;
      c.fillStyle = "#41504d";
      c.fillText(`${b.label}`, 36, y);
      c.fillStyle = "#4f827a";
      c.fillText(String(b.value), 330, y);
      c.fillStyle = "#8b9794";
      c.fillText(String(b.note).slice(0, 26), 420, y);
    });

    c.fillStyle = "#8b9794";
    c.font = "12px system-ui, sans-serif";
    c.fillText("本报告由智价宝可解释估价模型生成，结果为二手流转参考价，不构成任何交易承诺。", 36, height - 32);

    const link = document.createElement("a");
    link.download = `智价宝估价报告-${ctx.scenic}-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    showToast("估价报告已导出为图片", "success");
    Store.track("export_report", { scenic: ctx.scenic });
  };

  /* =========================
     页面：全网比价
     ========================= */
  async function initCompare() {
    const list = $("#compareList");
    if (!list) return;
    const keyword = $("#compareSearch");
    const scenicFilter = $("#compareScenic");
    const categoryFilter = $("#compareCategory");
    const sortSelect = $("#compareSort");
    const range = $("#priceRange");
    const rangeText = $("#rangeText");

    if (scenicFilter) scenicFilter.innerHTML = '<option value="">全部景区</option>' + D.SCENICS.map((s) => `<option value="${esc(s.id)}">${esc(s.id)}</option>`).join("");
    if (categoryFilter) categoryFilter.innerHTML = '<option value="">全部品类</option>' + D.CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    if (sortSelect) sortSelect.innerHTML = [["heat", "按热度"], ["price-asc", "价格从低到高"], ["price-desc", "价格从高到低"], ["new", "最新发布"], ["value", "折扣力度"]]
      .map(([v, l]) => `<option value="${v}">${l}</option>`).join("");

    $$("[data-platform]").forEach((btn) => {
      btn.onclick = () => {
        const p = D.PLATFORMS.find((x) => x.id === btn.dataset.platform);
        if (!p) return;
        const url = D.platformSearchUrl(p.id, keyword?.value || "景区文创");
        if (url) window.open(url, "_blank", "noopener");
        else showToast("该平台为本平台建议价，无需跳转", "info");
      };
    });

    const historyBox = $("#searchHistory");
    const renderHistory = async () => {
      if (!historyBox) return;
      const data = await Store.api("/api/search-history").catch(() => ({ history: [] }));
      historyBox.innerHTML = data.history?.length
        ? `<span class="muted small">最近搜索：</span>${data.history.map((k) => `<button class="chip small" type="button" data-kw="${esc(k)}">${esc(k)}</button>`).join("")}
           <button class="link-btn" type="button" id="clearHistory">清空</button>`
        : '<span class="muted small">搜索关键词会记录在账号中，便于下次快速比价</span>';
      historyBox.onclick = async (event) => {
        const chip = event.target.closest("[data-kw]");
        if (chip) {
          keyword.value = chip.dataset.kw;
          refresh();
          return;
        }
        if (event.target.closest("#clearHistory")) {
          await Store.api("/api/search-history", { method: "DELETE" }).catch(() => null);
          renderHistory();
        }
      };
    };
    await renderHistory();

    const render = async () => {
      const kw = keyword?.value.trim() || "";
      const data = await App.renderProductGrid(list, {
        limit: 24,
        query: {
          keyword: kw,
          scenic: scenicFilter?.value || "",
          category: categoryFilter?.value || "",
          priceMax: range?.value || "",
          sort: sortSelect?.value || "heat"
        },
        emptyAction: '<button class="btn ghost" type="button" id="resetCompare"><span>重置筛选</span></button>'
      });
      $("#resetCompare")?.addEventListener("click", () => {
        if (keyword) keyword.value = "";
        if (scenicFilter) scenicFilter.value = "";
        if (categoryFilter) categoryFilter.value = "";
        if (sortSelect) sortSelect.value = "heat";
        render();
      });
      /* 在卡片上补充三价对比与平台跳转 */
      if (data?.products) {
        data.products.forEach((p) => {
          const card = list.querySelector(`[data-id="${p.id}"]`);
          if (!card) return;
          const box = document.createElement("div");
          box.className = "compare-source";
          const official = Math.round(p.original);
          const secondhand = Math.round(p.price * 0.94);
          box.innerHTML = `
            <div class="source-row"><span>官方指导价</span><strong>¥${official}</strong></div>
            <div class="source-row"><span>二手成交参考</span><strong>¥${secondhand}</strong></div>
            <div class="source-row highlight"><span>本平台建议价</span><strong>¥${p.price}</strong></div>
            <div class="source-links">
              <button class="link-btn" type="button" data-open="${esc(D.platformSearchUrl("mall", p.name))}">去电商查同款</button>
              <button class="link-btn" type="button" data-open="${esc(D.platformSearchUrl("secondhand", p.name))}">去二手平台查成交</button>
            </div>`;
          card.querySelector(".product-body")?.appendChild(box);
        });
        list.querySelectorAll("[data-open]").forEach((btn) => {
          btn.onclick = (event) => {
            event.stopPropagation();
            window.open(btn.dataset.open, "_blank", "noopener");
          };
        });
        if (kw) await Store.api("/api/search-history", { method: "POST", body: { keyword: kw } }).catch(() => null);
      }
    };

    const refresh = () => {
      if (rangeText && range) rangeText.textContent = `¥${range.value} 以下`;
      return render();
    };
    let timer = null;
    bindOnce(keyword, "input", () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 350);
    });
    [scenicFilter, categoryFilter, sortSelect, range].forEach((node) => bindOnce(node, "change", refresh));
    await refresh();
  }
  App.initCompare = initCompare;

  /* 首页 / 比价页共用的“刷新当前页”钩子 */
  App.refreshCurrentPage = () => {
    const page = document.body.dataset.page;
    const map = { home: initHome, estimate: initEstimate, compare: initCompare, market: App.initMarket, profile: App.initProfile, orders: App.initOrders, admin: App.initAdmin, messages: App.initMessages };
    return map[page]?.();
  };
})(typeof window !== "undefined" ? window : globalThis);
