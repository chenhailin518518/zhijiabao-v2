/*
  智价宝 - 业务层（二）：集市 / 个人中心 / 订单 / 消息 / 运营后台 + 启动引导
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
  const App = (root.App = root.App || {});
  const money = P.money;
  const { fmtTime, relative, emptyState, statusChip, confirmDialog, requireLogin, ensureBackdrop, closeBackdrop } = App;

  /* =========================
     发布 / 编辑商品
     ========================= */
  const publishState = { images: [], editingId: "" };

  async function openPublishModal({ prefill = {}, product = null, fromEstimate = false } = {}) {
    if (!requireLogin("发布闲置前请先登录")) return;
    const editing = !!product;
    publishState.editingId = editing ? product.id : "";
    publishState.images = editing ? [...(product.images || [])] : [...(prefill.images || [])];

    const node = ensureBackdrop("publishModal", "发布闲置");
    const card = node.querySelector(".modal-card");
    const value = editing ? product : prefill;
    card.innerHTML = `
      <div class="modal-head">
        <div><p class="section-kicker">${editing ? "Edit Item" : "Publish Item"}</p>
          <h2>${editing ? "编辑商品" : "发布文创闲置"}</h2></div>
        <button class="close-btn" type="button" data-close aria-label="关闭">×</button>
      </div>
      ${fromEstimate ? '<p class="notice-bar">已带入 AI 估价的建议价，你可以自行调整后再发布。</p>' : ""}
      <form class="form-grid" id="publishForm" novalidate>
        <div class="form-row"><label for="pubName">商品名称 <em>*</em></label>
          <input class="field" id="pubName" maxlength="40" value="${esc(value.name || "")}" placeholder="2-40 个字符，例如：故宫瑞兽冰箱贴">
          <p class="field-error" data-error="name"></p></div>
        <div class="form-row"><label for="pubScenic">景区来源 <em>*</em></label>
          <select class="select" id="pubScenic">${D.SCENICS.map((s) => `<option value="${esc(s.id)}" ${value.scenic === s.id ? "selected" : ""}>${esc(s.id)}（${esc(s.city)}）</option>`).join("")}</select>
          <p class="field-error" data-error="scenic"></p></div>
        <div class="form-row"><label for="pubCategory">商品品类 <em>*</em></label>
          <select class="select" id="pubCategory">${D.CATEGORIES.map((c) => `<option value="${esc(c)}" ${value.category === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
          <p class="field-error" data-error="category"></p></div>
        <div class="form-row"><label for="pubCondition">品相 <em>*</em></label>
          <select class="select" id="pubCondition">${D.CONDITIONS.map((c) => `<option value="${esc(c.value)}" ${value.condition === c.value ? "selected" : ""}>${esc(c.value)}（${esc(c.desc)}）</option>`).join("")}</select></div>
        <div class="form-row"><label for="pubOriginal">购买原价（元） <em>*</em></label>
          <input class="field" id="pubOriginal" type="number" min="1" max="200000" value="${value.original ?? ""}">
          <p class="field-error" data-error="original"></p></div>
        <div class="form-row"><label for="pubPrice">期望价（元） <em>*</em></label>
          <input class="field" id="pubPrice" type="number" min="1" max="100000" value="${value.price ?? ""}">
          <p class="field-hint">不得超过原价的 120%，超出会被平台拦截。</p>
          <p class="field-error" data-error="price"></p></div>
        <div class="form-row"><label for="pubFreight">运费（元，0 表示包邮）</label>
          <input class="field" id="pubFreight" type="number" min="0" max="200" value="${value.freight ?? 0}"></div>
        <div class="form-row"><label for="pubTag">标签</label>
          <select class="select" id="pubTag">${D.TAGS.map((t) => `<option value="${esc(t)}" ${value.tag === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
        <div class="form-row full"><label for="pubDesc">品相说明</label>
          <textarea class="field" id="pubDesc" rows="3" maxlength="300" placeholder="说明使用痕迹、配件是否齐全、是否带包装与凭证">${esc(value.description || "")}</textarea>
          <p class="field-hint"><span id="descCount">0</span>/300</p></div>
        <div class="form-row full"><label>商品实拍图 <em>*</em>（最多 6 张，自动压缩）</label>
          <div class="upload-grid" id="pubImages"></div>
          <input type="file" id="pubImageInput" accept="image/*" multiple hidden>
          <p class="field-error" data-error="images"></p></div>
      </form>
      <div class="modal-actions">
        <button class="btn ghost" type="button" data-close>取消</button>
        <button class="btn" type="button" id="pubSubmit"><span>${editing ? "保存修改" : "提交发布"}</span></button>
      </div>`;

    node.classList.add("is-open");
    const form = $("#publishForm", card);
    const desc = $("#pubDesc", card);
    const syncCount = () => { $("#descCount", card).textContent = desc.value.length; };
    desc.addEventListener("input", syncCount);
    syncCount();

    const renderImages = () => {
      const box = $("#pubImages", card);
      box.innerHTML = publishState.images.map((src, i) => `
        <div class="upload-item">
          <img src="${src.startsWith("data:") || src.startsWith("http") || src.startsWith("/") ? src : root.assetPath(src)}" alt="商品图 ${i + 1}">
          <button type="button" class="remove-btn" data-remove="${i}" aria-label="删除这张图">×</button>
        </div>`).join("") + `
        <button type="button" class="upload-add" id="pubAddImage" aria-label="添加图片">
          <span>＋</span><em>添加图片</em>
        </button>`;
      $("#pubAddImage", card).onclick = () => $("#pubImageInput", card).click();
      box.querySelectorAll("[data-remove]").forEach((btn) => {
        btn.onclick = () => {
          publishState.images.splice(Number(btn.dataset.remove), 1);
          renderImages();
        };
      });
    };
    renderImages();

    $("#pubImageInput", card).addEventListener("change", async () => {
      const files = [...($("#pubImageInput", card).files || [])];
      if (!files.length) return;
      if (publishState.images.length + files.length > 6) {
        showToast("最多上传 6 张图片", "error");
        return;
      }
      setTask(`正在压缩并上传 ${files.length} 张图片…`);
      for (const file of files) {
        try {
          const uploaded = await App.uploadImage(file);
          publishState.images.push(uploaded.url);
          renderImages();
        } catch (e) {
          showToast(`「${file.name}」上传失败：${e.message}`, "error");
        }
      }
      setTask(null);
      $("#pubImageInput", card).value = "";
    });

    card.querySelectorAll("[data-close]").forEach((btn) => (btn.onclick = () => closeBackdrop(node)));
    $("#pubSubmit", card).onclick = async () => {
      form.querySelectorAll(".field-error").forEach((n) => (n.textContent = ""));
      const payload = {
        name: $("#pubName", card).value.trim(),
        scenic: $("#pubScenic", card).value,
        category: $("#pubCategory", card).value,
        condition: $("#pubCondition", card).value,
        original: Number($("#pubOriginal", card).value),
        price: Number($("#pubPrice", card).value),
        freight: Number($("#pubFreight", card).value || 0),
        tag: $("#pubTag", card).value,
        description: desc.value.trim(),
        images: publishState.images
      };
      const check = P.validateProduct(payload);
      if (!check.valid) {
        check.errors.forEach((err) => {
          const slot = form.querySelector(`[data-error="${err.field}"]`);
          if (slot && !slot.textContent) slot.textContent = err.message;
        });
        const first = check.errors[0];
        form.querySelector(`[data-error="${first.field}"]`)?.scrollIntoView({ block: "center" });
        showToast(first.message, "error");
        return;
      }
      try {
        setTask(editing ? "正在保存修改…" : "正在提交审核…");
        if (editing) {
          await Store.api(`/api/products/${publishState.editingId}`, { method: "PATCH", body: payload });
          showToast("修改已保存，将重新进入审核", "success");
        } else {
          const res = await Store.api("/api/products", { method: "POST", body: payload });
          showToast(res.message || "发布成功，等待审核", "success");
          Store.track("product_publish", { scenic: payload.scenic, price: payload.price });
        }
        closeBackdrop(node);
        await Store.refresh().catch(() => null);
        await App.refreshCurrentPage?.();
      } catch (e) {
        showToast(e.message, "error");
      } finally {
        setTask(null);
      }
    };
  }
  App.openPublishModal = openPublishModal;

  /* =========================
     页面：二手集市
     ========================= */
  async function initMarket() {
    const list = $("#marketList");
    if (!list) return;
    const params = new URLSearchParams(location.search);
    const state = {
      segment: params.get("segment") || "personal",
      scenic: params.get("scenic") || "",
      category: params.get("category") || params.get("cat") || "",
      tag: params.get("tag") || "",
      keyword: params.get("keyword") || "",
      sort: "heat",
      page: 1
    };

    const scenicSelect = $("#marketScenic");
    const categorySelect = $("#marketCategory");
    const tagSelect = $("#marketTag");
    const sortSelect = $("#marketSort");
    const keywordInput = $("#marketSearch");
    if (scenicSelect) scenicSelect.innerHTML = '<option value="">全部景区</option>' + D.SCENICS.map((s) => `<option value="${esc(s.id)}">${esc(s.id)}</option>`).join("");
    if (categorySelect) categorySelect.innerHTML = '<option value="">全部品类</option>' + D.CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    if (tagSelect) tagSelect.innerHTML = '<option value="">全部标签</option>' + D.TAGS.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
    if (sortSelect) sortSelect.innerHTML = [["heat", "热度优先"], ["new", "最新发布"], ["price-asc", "价格最低"], ["price-desc", "价格最高"], ["value", "折扣最大"]]
      .map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
    if (scenicSelect) scenicSelect.value = state.scenic;
    if (categorySelect) categorySelect.value = state.category;
    if (tagSelect) tagSelect.value = state.tag;
    if (keywordInput) keywordInput.value = state.keyword;

    $$("[data-segment]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.segment === state.segment);
      btn.onclick = () => {
        state.segment = btn.dataset.segment;
        state.page = 1;
        $$("[data-segment]").forEach((b) => b.classList.toggle("active", b === btn));
        render();
      };
    });

    const render = async (append = false) => {
      if (!append) state.page = 1;
      const tag = state.segment === "merchant" ? (state.tag || "商户尾货") : state.tag;
      const data = await App.renderProductGrid(list, {
        limit: 12,
        query: {
          scenic: state.scenic, category: state.category, tag, keyword: state.keyword,
          sort: state.sort, page: state.page, limit: 12
        },
        emptyAction: '<button class="btn ghost" type="button" id="resetMarket"><span>重置筛选</span></button>'
      });
      $("#resetMarket")?.addEventListener("click", reset);
      const more = $("#loadMore");
      if (more) more.hidden = !data?.hasMore;
      if (data) state.total = data.total;
      const counter = $("#marketCounter");
      if (counter && data) counter.textContent = `共 ${data.total} 件商品`;
    };

    const reset = () => {
      Object.assign(state, { scenic: "", category: "", tag: "", keyword: "", sort: "heat", page: 1 });
      if (scenicSelect) scenicSelect.value = "";
      if (categorySelect) categorySelect.value = "";
      if (tagSelect) tagSelect.value = "";
      if (sortSelect) sortSelect.value = "heat";
      if (keywordInput) keywordInput.value = "";
      render();
    };

    let timer = null;
    App.bindOnce(keywordInput, "input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => { state.keyword = keywordInput.value.trim(); render(); }, 350);
    });
    App.bindOnce(scenicSelect, "change", () => { state.scenic = scenicSelect.value; render(); });
    App.bindOnce(categorySelect, "change", () => { state.category = categorySelect.value; render(); });
    App.bindOnce(tagSelect, "change", () => { state.tag = tagSelect.value; render(); });
    App.bindOnce(sortSelect, "change", () => { state.sort = sortSelect.value; render(); });
    App.bindOnce($("#loadMore"), "click", async () => {
      state.page += 1;
      await render(true);
    });

    App.bindOnce($("#openPublish"), "click", () => openPublishModal());
    App.bindOnce($("#publishEntry"), "click", () => openPublishModal());

    /* 我的发布（登录后显示管理入口） */
    const mineBox = $("#myProducts");
    if (mineBox) {
      if (!Store.user) {
        mineBox.innerHTML = emptyState("登录后可管理你的闲置", "支持编辑、下架、重新上架与删除", '<button class="btn ghost" type="button" id="mineLogin"><span>登录 / 注册</span></button>');
        $("#mineLogin")?.addEventListener("click", () => App.openAuthModal("login"));
      } else {
        try {
          const data = await Store.api("/api/products?owner=me&status=all&limit=48");
          mineBox.innerHTML = data.products.length
            ? `<div class="mine-grid">${data.products.map((p) => `
              <div class="mine-row">
                <img src="${root.assetPath(p.images?.[0] || "")}" alt="${esc(p.name)}">
                <div class="mine-info">
                  <strong>${esc(p.name)}</strong>
                  <p class="muted small">¥${p.price} · ${esc(p.scenic)} · ${esc(p.condition)} · ${statusChip(p.status)}</p>
                  ${p.rejectReason ? `<p class="field-error">驳回原因：${esc(p.rejectReason)}</p>` : ""}
                  <p class="muted small">浏览 ${p.views} · 收藏 ${p.favoriteCount} · ${relative(p.createdAt)}</p>
                </div>
                <div class="mine-actions">
                  <button class="link-btn" type="button" data-view="${esc(p.id)}">查看</button>
                  <button class="link-btn" type="button" data-edit="${esc(p.id)}">编辑</button>
                  ${p.status === "在售" || p.status === "待审核" ? `<button class="link-btn" type="button" data-offline="${esc(p.id)}">下架</button>` : ""}
                  ${p.status === "已下架" ? `<button class="link-btn" type="button" data-relist="${esc(p.id)}">重新上架</button>` : ""}
                  <button class="link-btn danger-text" type="button" data-del="${esc(p.id)}">删除</button>
                </div>
              </div>`).join("")}</div>`
            : emptyState("你还没有发布闲置", "AI 估价后可以一键转发布，也可以直接点击右上角发布", '<button class="btn" type="button" id="minePublish"><span>发布闲置</span></button>');
          $("#minePublish")?.addEventListener("click", () => openPublishModal());
          mineBox.onclick = async (event) => {
            const target = event.target.closest("[data-view],[data-edit],[data-offline],[data-relist],[data-del]");
            if (!target) return;
            const { view, edit, offline, relist, del } = target.dataset;
            try {
              if (view) App.openProductDetail(view);
              if (edit) {
                const product = data.products.find((p) => p.id === edit);
                openPublishModal({ product });
              }
              if (offline) {
                await Store.api(`/api/products/${offline}/offline`, { method: "POST" });
                showToast("商品已下架", "success");
                await initMarket();
              }
              if (relist) {
                await Store.api(`/api/products/${relist}/relist`, { method: "POST" });
                showToast("已重新提交审核", "success");
                await initMarket();
              }
              if (del) {
                if (await confirmDialog({ title: "删除商品", message: "删除后不可恢复，确认删除？", confirmText: "确认删除", danger: true })) {
                  await Store.api(`/api/products/${del}`, { method: "DELETE" });
                  showToast("商品已删除", "success");
                  await initMarket();
                }
              }
            } catch (e) {
              showToast(e.message, "error");
            }
          };
        } catch (e) {
          mineBox.innerHTML = emptyState("我的发布加载失败", e.message);
        }
      }
    }

    await render();

    /* 集市天气条：只展示真实接口数据，失败时明确标注 */
    const strip = $("#weatherStrip");
    if (strip && root.ZhijiabaoAPI?.WeatherService) {
      strip.innerHTML = '<p class="muted small">正在获取 8 个景区的实时天气…</p>';
      try {
        const weather = await root.ZhijiabaoAPI.WeatherService.getBatch(D.SCENICS.map((s) => s.id));
        strip.innerHTML = D.SCENICS.map((s) => {
          const w = weather[s.id];
          const ok = w && !w.isDegraded;
          return `<div class="weather-card ${ok ? "" : "degraded"}">
            <strong>${esc(s.id)}</strong>
            <p class="weather-main">${ok ? `${w.weatherIcon} ${w.temperature}°C ${esc(w.weatherLabel)}` : "数据不可用"}</p>
            <p class="muted small">${ok ? `湿度 ${w.humidity}% · 风 ${w.windSpeed}km/h` : "本次估价将使用中性天气因子"}</p>
          </div>`;
        }).join("");
      } catch {
        strip.innerHTML = '<p class="muted small">天气接口不可用（数据源 Open-Meteo），不影响估价与交易功能。</p>';
      }
    }
  }
  App.initMarket = initMarket;

  /* =========================
     页面：个人中心
     ========================= */
  async function initProfile() {
    const host = $("#profileHost");
    if (!host) return;

    if (!Store.user) {
      host.innerHTML = `
        <div class="panel auth-gate">
          <h2>登录后管理你的闲置与订单</h2>
          <p class="muted">账号支持手机号 + 验证码或密码登录；注册后可发布闲置、发起担保交易、查看订单与消息。</p>
          <div class="inline-field">
            <button class="btn" type="button" id="gateLogin"><span>登录</span></button>
            <button class="btn ghost" type="button" id="gateRegister"><span>注册新账号</span></button>
          </div>
          <p class="muted small">演示账号：18800000001 / demo1234</p>
        </div>
        <div class="panel">
          <h3>接入真实数据层后新增的能力</h3>
          <ul class="feature-list">
            <li>账号体系：注册、登录、找回密码、实名认证、注销账号</li>
            <li>交易闭环：订单状态机、担保付款、发货、确认收货放款、售后退款</li>
            <li>信用体系：订单评价、信用分计算、举报与后台处置</li>
          </ul>
        </div>`;
      $("#gateLogin").onclick = () => App.openAuthModal("login");
      $("#gateRegister").onclick = () => App.openAuthModal("register");
      return;
    }

    const user = Store.user;
    const counts = Store.counts || {};
    host.innerHTML = `
      <div class="panel profile-head-card">
        <div class="profile-head">
          <div class="big-avatar">${esc((user.nickname || "用").slice(0, 1))}</div>
          <div class="profile-main">
            <h2>${esc(user.nickname)} <span class="credit-pill big">信用 ${user.credit} · ${esc(user.creditLevel)}</span></h2>
            <p class="muted">${esc(user.bio || "还没有填写个人简介")} · ${esc(user.city || "未填写所在城市")}</p>
            <p class="muted small">手机号 ${esc(user.phone)} · ${user.idVerified ? `已实名（${esc(user.idNoMasked)}）` : "未实名认证"} · 加入于 ${fmtTime(user.createdAt).slice(0, 10)}</p>
          </div>
          <div class="wallet">
            <p class="muted small">可提现余额</p>
            <strong>${money(user.balance)}</strong>
            <button class="btn ghost small" type="button" id="withdrawBtn"><span>提现</span></button>
          </div>
        </div>
        <div class="stat-row">
          <div><strong>${counts.orders || 0}</strong><span>订单</span></div>
          <div><strong>${counts.products || 0}</strong><span>我的发布</span></div>
          <div><strong>${counts.favorites || 0}</strong><span>收藏</span></div>
          <div><strong>${counts.estimates || 0}</strong><span>估价记录</span></div>
          <div><strong>${counts.unreadNotice || 0}</strong><span>未读通知</span></div>
        </div>
      </div>

      <nav class="tabs profile-tabs" role="tablist">
        ${[["orders", "订单"], ["favorites", "收藏"], ["posts", "我的发布"], ["footprints", "浏览足迹"], ["estimates", "估价记录"], ["addresses", "收货地址"], ["notices", "通知"], ["settings", "资料与安全"]]
          .map(([id, label], i) => `<button role="tab" type="button" data-tab="${id}" class="${i === 0 ? "active" : ""}">${label}</button>`).join("")}
      </nav>
      <section class="panel" id="profilePanel"></section>`;

    $("#withdrawBtn").onclick = async () => {
      const amount = Number(prompt(`当前可提现 ¥${user.balance}，请输入提现金额：`, String(user.balance || "")));
      if (!amount) return;
      try {
        await Store.withdraw(amount);
        showToast("提现申请已提交", "success");
        await initProfile();
      } catch (e) {
        showToast(e.message, "error");
      }
    };

    const panel = $("#profilePanel");
    const tabs = {
      orders: renderOrders,
      favorites: renderFavorites,
      posts: renderPosts,
      footprints: renderFootprints,
      estimates: renderEstimates,
      addresses: renderAddresses,
      notices: renderNotices,
      settings: renderSettings
    };
    const switchTab = async (id) => {
      $$(".profile-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
      panel.innerHTML = '<div class="detail-loading"><span class="spinner"></span>加载中…</div>';
      await tabs[id](panel);
      location.hash = id;
    };
    $$(".profile-tabs button").forEach((btn) => (btn.onclick = () => switchTab(btn.dataset.tab)));
    await switchTab((location.hash || "#orders").slice(1));

    /* ---- 各面板 ---- */
    async function renderOrders(box) {
      const data = await Store.api("/api/orders?role=all");
      box.innerHTML = `
        <div class="panel-head"><h3>最近订单</h3><a class="link-btn" href="../orders/" data-transition>查看全部订单与售后</a></div>
        ${data.orders.length ? `<div class="order-mini">${data.orders.slice(0, 5).map(orderMiniHtml).join("")}</div>`
          : emptyState("还没有订单", "在集市选中商品后即可发起担保交易")}`;
    }

    async function renderFavorites(box) {
      const data = await Store.api("/api/favorites");
      box.innerHTML = `
        <div class="panel-head"><h3>我的收藏（${data.favorites.length}）</h3><p class="muted small">可对收藏商品设置降价提醒，低于目标价时收到站内通知</p></div>
        ${data.favorites.length ? `<div class="fav-grid">${data.favorites.map((p) => `
          <div class="fav-card">
            <img src="${root.assetPath(p.images?.[0] || "")}" alt="${esc(p.name)}">
            <div>
              <strong>${esc(p.name)}</strong>
              <p class="muted small">¥${p.price} · ${esc(p.scenic)} · ${esc(p.status)}</p>
              <p class="muted small">${p.priceAlert ? `已设降价提醒：低于 ¥${p.alertPrice}` : "未设置降价提醒"}</p>
            </div>
            <div class="fav-actions">
              <button class="link-btn" type="button" data-view="${esc(p.id)}">查看</button>
              <button class="link-btn" type="button" data-alert="${esc(p.id)}">${p.priceAlert ? "修改提醒" : "设降价提醒"}</button>
              <button class="link-btn danger-text" type="button" data-unfav="${esc(p.id)}">取消收藏</button>
            </div>
          </div>`).join("")}</div>`
          : emptyState("还没有收藏", "逛逛集市，把心动的文创收进来")}`;
      box.onclick = async (event) => {
        const t = event.target.closest("[data-view],[data-alert],[data-unfav]");
        if (!t) return;
        try {
          if (t.dataset.view) App.openProductDetail(t.dataset.view);
          if (t.dataset.alert) {
            const product = data.favorites.find((f) => f.id === t.dataset.alert);
            App.openAlertModal(product);
          }
          if (t.dataset.unfav) {
            await Store.api(`/api/favorites/${t.dataset.unfav}`, { method: "POST" });
            showToast("已取消收藏", "success");
            await Store.refresh().catch(() => null);
            await renderFavorites(box);
          }
        } catch (e) {
          showToast(e.message, "error");
        }
      };
    }

    async function renderPosts(box) {
      const data = await Store.api("/api/products?owner=me&status=all&limit=48");
      box.innerHTML = `
        <div class="panel-head"><h3>我的发布（${data.products.length}）</h3>
          <button class="btn small" type="button" id="panelPublish"><span>发布闲置</span></button></div>
        ${data.products.length ? data.products.map((p) => `
          <div class="mine-row">
            <img src="${root.assetPath(p.images?.[0] || "")}" alt="${esc(p.name)}">
            <div class="mine-info">
              <strong>${esc(p.name)}</strong>
              <p class="muted small">¥${p.price} · ${esc(p.scenic)} · ${statusChip(p.status)} · 浏览 ${p.views} · 收藏 ${p.favoriteCount}</p>
              ${p.rejectReason ? `<p class="field-error">驳回原因：${esc(p.rejectReason)}</p>` : ""}
            </div>
            <div class="mine-actions">
              <button class="link-btn" type="button" data-view="${esc(p.id)}">查看</button>
              <button class="link-btn" type="button" data-edit="${esc(p.id)}">编辑</button>
            </div>
          </div>`).join("") : emptyState("你还没有发布闲置", "AI 估价完成后可以一键转发布")}`;
      $("#panelPublish").onclick = () => openPublishModal();
      box.onclick = (event) => {
        const t = event.target.closest("[data-view],[data-edit]");
        if (!t) return;
        if (t.dataset.view) App.openProductDetail(t.dataset.view);
        if (t.dataset.edit) openPublishModal({ product: data.products.find((p) => p.id === t.dataset.edit) });
      };
    }

    async function renderFootprints(box) {
      const data = await Store.api("/api/footprints");
      box.innerHTML = `
        <div class="panel-head"><h3>浏览足迹（${data.footprints.length}）</h3>
          ${data.footprints.length ? '<button class="link-btn danger-text" type="button" id="clearFoot">清空足迹</button>' : ""}</div>
        ${data.footprints.length ? `<div class="foot-list">${data.footprints.map((p) => `
          <button class="foot-row" type="button" data-view="${esc(p.id)}">
            <img src="${root.assetPath(p.images?.[0] || "")}" alt="${esc(p.name)}">
            <span>${esc(p.name)}</span><strong>¥${p.price}</strong><em class="muted small">${relative(p.viewedAt)}</em>
          </button>`).join("")}</div>` : emptyState("暂无浏览记录", "你浏览过的商品会自动记录在这里")}`;
      $("#clearFoot")?.addEventListener("click", async () => {
        await Store.api("/api/footprints", { method: "DELETE" });
        showToast("浏览足迹已清空", "success");
        await renderFootprints(box);
      });
      box.querySelectorAll("[data-view]").forEach((btn) => (btn.onclick = () => App.openProductDetail(btn.dataset.view)));
    }

    async function renderEstimates(box) {
      const data = await Store.api("/api/estimates");
      box.innerHTML = `
        <div class="panel-head"><h3>估价记录（${data.estimates.length}）</h3><a class="link-btn" href="../estimate/" data-transition>去估价</a></div>
        ${data.estimates.length ? data.estimates.map((e) => `
          <div class="history-row">
            <div><strong>${esc(e.scenic)} · ${esc(e.condition)}</strong>
              <p class="muted small">原价 ¥${e.original} → 建议 ¥${e.result}（区间 ¥${e.range_low}-${e.range_high}，置信度 ${e.confidence}%） · ${fmtTime(e.created_at)}</p></div>
            <div class="row-actions">
              <button class="link-btn" type="button" data-publish="${esc(e.id)}">转发布</button>
              <button class="link-btn danger-text" type="button" data-drop="${esc(e.id)}">删除</button>
            </div>
          </div>`).join("") : emptyState("还没有估价记录", "上传图片或直接填写信息即可得到建议价")}`;
      box.onclick = async (event) => {
        const t = event.target.closest("[data-publish],[data-drop]");
        if (!t) return;
        if (t.dataset.publish) {
          const row = data.estimates.find((x) => String(x.id) === t.dataset.publish);
          openPublishModal({
            prefill: { scenic: row.scenic, original: row.original, condition: row.condition, price: row.result, description: row.note },
            fromEstimate: true
          });
        }
        if (t.dataset.drop) {
          await Store.api(`/api/estimates/${t.dataset.drop}`, { method: "DELETE" });
          showToast("估价记录已删除", "success");
          await Store.refresh().catch(() => null);
          await renderEstimates(box);
        }
      };
    }

    async function renderAddresses(box) {
      const data = await Store.api("/api/addresses");
      box.innerHTML = `
        <div class="panel-head"><h3>收货地址（${data.addresses.length}/10）</h3></div>
        <form class="form-grid" id="addressForm">
          <div class="form-row"><label for="addrName">收件人</label><input class="field" id="addrName" maxlength="20"></div>
          <div class="form-row"><label for="addrPhone">手机号</label><input class="field" id="addrPhone" inputmode="numeric" maxlength="11"></div>
          <div class="form-row full"><label for="addrRegion">所在地区</label><input class="field" id="addrRegion" maxlength="30" placeholder="如：上海市 浦东新区"></div>
          <div class="form-row full"><label for="addrDetail">详细地址</label><input class="field" id="addrDetail" maxlength="60" placeholder="街道、门牌号"></div>
          <button class="btn" type="button" id="addrSave"><span>保存地址</span></button>
          <p class="field-error" id="addrError" role="alert"></p>
        </form>
        <div class="addr-list">
          ${data.addresses.length ? data.addresses.map((a) => `
            <div class="addr-row">
              <div><strong>${esc(a.name)}</strong> ${esc(a.phone)} ${a.is_default ? '<span class="tag">默认</span>' : ""}
                <p class="muted small">${esc(a.region)} ${esc(a.detail)}</p></div>
              <div class="row-actions">
                ${a.is_default ? "" : `<button class="link-btn" type="button" data-default="${a.id}">设为默认</button>`}
                <button class="link-btn danger-text" type="button" data-drop="${a.id}">删除</button>
              </div>
            </div>`).join("") : '<p class="muted">还没有收货地址，添加后下单可以直接选用。</p>'}
        </div>`;
      $("#addrSave").onclick = async () => {
        try {
          await Store.api("/api/addresses", {
            method: "POST",
            body: {
              name: $("#addrName").value.trim(), phone: $("#addrPhone").value.trim(),
              region: $("#addrRegion").value.trim(), detail: $("#addrDetail").value.trim()
            }
          });
          showToast("地址已保存", "success");
          await renderAddresses(box);
        } catch (e) {
          $("#addrError").textContent = e.message;
        }
      };
      box.onclick = async (event) => {
        const t = event.target.closest("[data-default],[data-drop]");
        if (!t) return;
        try {
          if (t.dataset.default) await Store.api(`/api/addresses/${t.dataset.default}/default`, { method: "POST" });
          if (t.dataset.drop) await Store.api(`/api/addresses/${t.dataset.drop}`, { method: "DELETE" });
          await renderAddresses(box);
        } catch (e) {
          showToast(e.message, "error");
        }
      };
    }

    async function renderNotices(box) {
      const data = await Store.api("/api/notifications");
      box.innerHTML = `
        <div class="panel-head"><h3>通知中心（未读 ${data.unread}）</h3>
          ${data.unread ? '<button class="link-btn" type="button" id="readAll">全部标为已读</button>' : ""}</div>
        ${data.notifications.length ? data.notifications.map((n) => `
          <div class="notice-row ${n.read_at ? "" : "unread"}">
            <span class="notice-type">${esc(n.type)}</span>
            <div><strong>${esc(n.title)}</strong><p class="muted small">${esc(n.body)}</p>
              <p class="muted small">${fmtTime(n.created_at)}</p></div>
            ${n.link ? `<a class="link-btn" href="${esc(n.link)}" data-transition>查看</a>` : ""}
          </div>`).join("") : emptyState("暂无通知", "订单、审核、评价、降价提醒都会在这里出现")}`;
      $("#readAll")?.addEventListener("click", async () => {
        await Store.api("/api/notifications/read", { method: "POST" });
        await Store.refresh().catch(() => null);
        await renderNotices(box);
      });
    }

    async function renderSettings(box) {
      box.innerHTML = `
        <div class="panel-head"><h3>资料与账号安全</h3></div>
        <div class="settings-grid">
          <form class="form-grid" id="profileForm">
            <h4>基本资料</h4>
            <div class="form-row"><label for="profNick">昵称</label><input class="field" id="profNick" maxlength="16" value="${esc(user.nickname)}"></div>
            <div class="form-row"><label for="profCity">所在城市</label><input class="field" id="profCity" maxlength="20" value="${esc(user.city)}"></div>
            <div class="form-row full"><label for="profBio">个人简介</label><input class="field" id="profBio" maxlength="60" value="${esc(user.bio)}"></div>
            <button class="btn" type="button" id="profileSave"><span>保存资料</span></button>
            <p class="field-error" id="profileError" role="alert"></p>
          </form>

          <form class="form-grid" id="realnameForm">
            <h4>实名认证 ${user.idVerified ? '<span class="tag">已认证</span>' : ""}</h4>
            <div class="form-row"><label for="realName">真实姓名</label><input class="field" id="realName" maxlength="20" value="${esc(user.realName)}" ${user.idVerified ? "disabled" : ""}></div>
            <div class="form-row"><label for="idNo">身份证号</label><input class="field" id="idNo" maxlength="18" placeholder="18 位身份证号" ${user.idVerified ? "disabled" : ""}></div>
            <p class="muted small">仅保存脱敏后的号码（如 310***********1234），完整证件号不落库。</p>
            <button class="btn" type="button" id="realnameSave" ${user.idVerified ? "disabled" : ""}><span>${user.idVerified ? "已完成认证" : "提交认证"}</span></button>
            <p class="field-error" id="realnameError" role="alert"></p>
          </form>

          <form class="form-grid" id="passwordForm">
            <h4>修改密码</h4>
            <div class="form-row"><label for="newPwd">新密码</label><input class="field" id="newPwd" type="password" maxlength="32" placeholder="至少 6 位"></div>
            <div class="form-row"><label for="pwdCode">验证码</label>
              <div class="inline-field"><input class="field" id="pwdCode" maxlength="6" placeholder="6 位验证码">
                <button class="btn ghost" type="button" id="pwdCodeBtn"><span>获取验证码</span></button></div></div>
            <button class="btn" type="button" id="pwdSave"><span>重置密码</span></button>
            <p class="field-error" id="pwdError" role="alert"></p>
          </form>

          <div class="form-grid danger-zone">
            <h4>账号操作</h4>
            <p class="muted small">退出登录只清除本机登录态；注销账号会下架你的在售商品且不可恢复。</p>
            <div class="inline-field">
              <button class="btn ghost" type="button" id="logoutBtn"><span>退出登录</span></button>
              <button class="btn ghost danger-text" type="button" id="closeAccountBtn"><span>注销账号</span></button>
            </div>
          </div>
        </div>`;

      $("#profileSave").onclick = async () => {
        try {
          await Store.updateProfile({ nickname: $("#profNick").value.trim(), city: $("#profCity").value.trim(), bio: $("#profBio").value.trim() });
          showToast("资料已保存", "success");
          await App.renderHeaderAuth();
          await initProfile();
        } catch (e) {
          $("#profileError").textContent = e.message;
        }
      };
      $("#realnameSave").onclick = async () => {
        try {
          await Store.verifyRealname({ realName: $("#realName").value.trim(), idNo: $("#idNo").value.trim() });
          showToast("实名认证通过，信用分已更新", "success");
          await initProfile();
        } catch (e) {
          $("#realnameError").textContent = e.message;
        }
      };
      $("#pwdCodeBtn").onclick = () => App.sendCode?.(user.phone, "reset", $("#pwdCodeBtn"));
      $("#pwdSave").onclick = async () => {
        try {
          await Store.resetPassword({ phone: user.phone, code: $("#pwdCode").value.trim(), password: $("#newPwd").value });
          showToast("密码已重置，请重新登录", "success");
          await Store.logout();
          await initProfile();
        } catch (e) {
          $("#pwdError").textContent = e.message;
        }
      };
      $("#logoutBtn").onclick = async () => {
        await Store.logout();
        showToast("已退出登录", "success");
        await App.renderHeaderAuth();
        await initProfile();
      };
      $("#closeAccountBtn").onclick = async () => {
        if (!(await confirmDialog({ title: "注销账号", message: "注销后将下架你的在售商品，且不可恢复，确认继续？", confirmText: "确认注销", danger: true }))) return;
        try {
          await Store.closeAccount();
          showToast("账号已注销", "success");
          await App.renderHeaderAuth();
          await initProfile();
        } catch (e) {
          showToast(e.message, "error");
        }
      };
    }
  }
  App.initProfile = initProfile;

  const orderMiniHtml = (o) => `
    <div class="order-mini-row">
      <span>${esc(o.productName)}</span>${statusChip(o.status)}<strong>¥${o.price + o.freight}</strong>
      <em class="muted small">${relative(o.createdAt)}</em>
    </div>`;

  /* =========================
     页面：订单中心
     ========================= */
  async function initOrders() {
    const host = $("#ordersHost");
    if (!host) return;
    if (!requireLogin("查看订单前请先登录")) {
      host.innerHTML = emptyState("登录后查看订单", "担保交易全流程都会记录在这里", '<button class="btn" type="button" id="orderLogin"><span>登录 / 注册</span></button>');
      $("#orderLogin").onclick = () => App.openAuthModal("login");
      return;
    }

    const state = { role: new URLSearchParams(location.search).get("role") || "all", status: "all" };
    host.innerHTML = `
      <div class="orders-toolbar">
        <div class="tabs" role="tablist">
          ${[["all", "全部"], ["buyer", "我买到的"], ["seller", "我卖出的"]].map(([v, l]) => `<button role="tab" type="button" data-role="${v}" class="${state.role === v ? "active" : ""}">${l}</button>`).join("")}
        </div>
        <div class="tabs sub" role="tablist">
          ${[["all", "全部状态"], ["待付款", "待付款"], ["待发货", "待发货"], ["待收货", "待收货"], ["已完成", "已完成"], ["售后中", "售后中"]].map(([v, l]) => `<button role="tab" type="button" data-status="${v}" class="${state.status === v ? "active" : ""}">${l}</button>`).join("")}
        </div>
      </div>
      <div class="order-stats" id="orderStats"></div>
      <div id="orderList"></div>`;

    const render = async () => {
      const list = $("#orderList");
      list.innerHTML = '<div class="detail-loading"><span class="spinner"></span>加载订单…</div>';
      const data = await Store.api(`/api/orders?role=${state.role === "all" ? "all" : state.role}&status=${encodeURIComponent(state.status)}`);
      const s = data.stats;
      $("#orderStats").innerHTML = [
        ["全部订单", s.all], ["待付款", s.pending], ["待发货", s.shipping],
        ["待收货", s.receiving], ["已完成", s.done], ["售后 / 退款", s.afterSale]
      ].map(([label, value]) => `<div class="stat-card"><strong>${value}</strong><span>${label}</span></div>`).join("");

      if (!data.orders.length) {
        list.innerHTML = emptyState("没有相关订单", "去集市挑选文创，或切换筛选条件");
        return;
      }
      list.innerHTML = data.orders.map((o) => orderCardHtml(o)).join("");
      list.onclick = (event) => {
        const btn = event.target.closest("[data-act]");
        if (btn) handleAction(btn.dataset.act, btn.dataset.id);
      };
    };

    const orderCardHtml = (o) => {
      const me = Store.user.id;
      const role = o.buyer?.id === me ? "买家" : "卖家";
      const actions = P.orderActions(o, me);
      return `
        <article class="order-card" data-id="${esc(o.id)}">
          <header class="order-head">
            <div>
              <p class="muted small">订单号 ${esc(o.id)} · ${role}视角 · ${fmtTime(o.createdAt)}</p>
              <h3>${esc(o.productName)}</h3>
            </div>
            ${statusChip(o.status)}
          </header>
          <div class="order-body">
            <img src="${root.assetPath(o.productImage)}" alt="${esc(o.productName)}">
            <div class="order-info">
              <p>成交价 <strong>¥${o.price}</strong> + 运费 ${o.freight ? `¥${o.freight}` : "包邮"} = <strong>¥${o.total}</strong></p>
              <p class="muted small">买家 ${esc(o.buyer?.name || "-")} · 卖家 ${esc(o.seller?.name || "平台代管")}</p>
              <p class="muted small">收货：${esc(o.address?.name || "")} ${esc(o.address?.phone || "")} ${esc(o.address?.region || "")} ${esc(o.address?.detail || "")}</p>
              ${o.trackingNo ? `<p class="muted small">物流：${esc(o.expressCompany)} ${esc(o.trackingNo)}</p>` : ""}
              ${o.cancelReason ? `<p class="field-error">取消原因：${esc(o.cancelReason)}</p>` : ""}
            </div>
            <ol class="timeline">
              ${o.timeline.map((t) => `<li><strong>${esc(t.label)}</strong><span class="muted small">${esc(t.extra || "")}</span><em class="muted small">${relative(t.at)}</em></li>`).join("")}
            </ol>
          </div>
          <footer class="order-actions">
            ${actions.map((a) => `<button class="btn ${a.style === "primary" ? "" : "ghost"} small" type="button" data-act="${a.action}" data-id="${esc(o.id)}"><span>${a.label}</span></button>`).join("") || '<span class="muted small">当前状态无需操作</span>'}
            <button class="link-btn" type="button" data-view="${esc(o.productId)}">查看商品</button>
          </footer>
        </article>`;
    };

    const handleAction = async (action, id) => {
      try {
        if (action === "ship") {
          const node = ensureBackdrop("shipModal", "填写物流");
          node.querySelector(".modal-card").innerHTML = `
            <div class="modal-head"><div><p class="section-kicker">Shipping</p><h2>填写快递信息</h2></div>
              <button class="close-btn" type="button" data-close aria-label="关闭">×</button></div>
            <div class="form-row"><label for="carrier">快递公司</label>
              <select class="select" id="carrier">${["顺丰速运", "京东物流", "中通快递", "圆通速递", "韵达快递", "中国邮政"].map((c) => `<option>${c}</option>`).join("")}</select></div>
            <div class="form-row"><label for="trackingNo">快递单号</label><input class="field" id="trackingNo" maxlength="24" placeholder="6-24 位字母或数字"></div>
            <p class="field-error" id="shipError" role="alert"></p>
            <div class="modal-actions">
              <button class="btn ghost" type="button" data-close>取消</button>
              <button class="btn" type="button" id="shipSubmit"><span>确认发货</span></button></div>`;
          node.classList.add("is-open");
          node.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => closeBackdrop(node)));
          $("#shipSubmit", node).onclick = async () => {
            try {
              await Store.api(`/api/orders/${id}/ship`, {
                method: "POST",
                body: { expressCompany: $("#carrier", node).value, trackingNo: $("#trackingNo", node).value.trim() }
              });
              showToast("已发货，等待买家确认收货", "success");
              closeBackdrop(node);
              await render();
              await Store.refresh().catch(() => null);
            } catch (e) {
              $("#shipError", node).textContent = e.message;
            }
          };
          return;
        }
        if (action === "refund") {
          const node = ensureBackdrop("refundModal", "申请售后");
          node.querySelector(".modal-card").innerHTML = `
            <div class="modal-head"><div><p class="section-kicker">After Sale</p><h2>申请售后</h2></div>
              <button class="close-btn" type="button" data-close aria-label="关闭">×</button></div>
            <div class="form-row"><label for="refundReason">售后原因（至少 4 个字）</label>
              <textarea class="field" id="refundReason" rows="3" maxlength="60" placeholder="如：收到时存在磕碰，与描述不符"></textarea></div>
            <p class="field-error" id="refundError" role="alert"></p>
            <div class="modal-actions">
              <button class="btn ghost" type="button" data-close>取消</button>
              <button class="btn" type="button" id="refundSubmit"><span>提交申请</span></button></div>`;
          node.classList.add("is-open");
          node.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => closeBackdrop(node)));
          $("#refundSubmit", node).onclick = async () => {
            try {
              await Store.api(`/api/orders/${id}/refund`, { method: "POST", body: { reason: $("#refundReason", node).value.trim() } });
              showToast("售后申请已提交，等待卖家处理", "success");
              closeBackdrop(node);
              await render();
            } catch (e) {
              $("#refundError", node).textContent = e.message;
            }
          };
          return;
        }
        if (action === "review") {
          const node = ensureBackdrop("reviewModal", "评价");
          let score = 5;
          node.querySelector(".modal-card").innerHTML = `
            <div class="modal-head"><div><p class="section-kicker">Review</p><h2>评价本次交易</h2></div>
              <button class="close-btn" type="button" data-close aria-label="关闭">×</button></div>
            <div class="star-picker" role="radiogroup" aria-label="评分">
              ${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" data-score="${n}" class="active" aria-label="${n} 星">★</button>`).join("")}
            </div>
            <div class="form-row"><label for="reviewContent">评价内容（选填）</label>
              <textarea class="field" id="reviewContent" rows="3" maxlength="200" placeholder="说说商品品相、卖家服务与发货速度"></textarea></div>
            <p class="field-error" id="reviewError" role="alert"></p>
            <div class="modal-actions">
              <button class="btn ghost" type="button" data-close>取消</button>
              <button class="btn" type="button" id="reviewSubmit"><span>提交评价</span></button></div>`;
          node.classList.add("is-open");
          $$(".star-picker [data-score]", node).forEach((btn) => {
            btn.onclick = () => {
              score = Number(btn.dataset.score);
              $$(".star-picker [data-score]", node).forEach((b) => b.classList.toggle("active", Number(b.dataset.score) <= score));
            };
          });
          $$(".star-picker [data-score]", node).forEach((b) => b.classList.add("active"));
          node.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => closeBackdrop(node)));
          $("#reviewSubmit", node).onclick = async () => {
            try {
              await Store.api(`/api/orders/${id}/review`, {
                method: "POST", body: { score, content: $("#reviewContent", node).value.trim() }
              });
              showToast("评价已提交，信用分已更新", "success");
              closeBackdrop(node);
              await render();
              await Store.refresh().catch(() => null);
            } catch (e) {
              $("#reviewError", node).textContent = e.message;
            }
          };
          return;
        }
        if (action === "cancel") {
          if (!(await confirmDialog({ title: "取消订单", message: "取消后商品会重新回到集市，确认取消？", confirmText: "确认取消", danger: true }))) return;
          await Store.api(`/api/orders/${id}/cancel`, { method: "POST", body: { reason: "买家主动取消" } });
          showToast("订单已取消", "success");
        } else {
          const labels = { pay: "付款", confirm: "确认收货", "refund-accept": "同意退款" };
          await Store.api(`/api/orders/${id}/${action}`, { method: "POST" });
          showToast(`${labels[action] || "操作"}成功`, "success");
        }
        await render();
        await Store.refresh().catch(() => null);
      } catch (e) {
        showToast(e.message, "error");
      }
    };

    App.bindOnce(host, "click", (event) => {
      const roleBtn = event.target.closest("[data-role]");
      const statusBtn = event.target.closest("[data-status]");
      const viewBtn = event.target.closest("[data-view]");
      if (roleBtn) {
        state.role = roleBtn.dataset.role;
        $$("[data-role]", host).forEach((b) => b.classList.toggle("active", b === roleBtn));
        render();
      }
      if (statusBtn) {
        state.status = statusBtn.dataset.status;
        $$("[data-status]", host).forEach((b) => b.classList.toggle("active", b === statusBtn));
        render();
      }
      if (viewBtn) App.openProductDetail(viewBtn.dataset.view);
    });

    await render();
  }
  App.initOrders = initOrders;

  /* =========================
     页面：消息中心
     ========================= */
  async function initMessages() {
    const host = $("#messagesHost");
    if (!host) return;
    if (!requireLogin("查看消息前请先登录")) {
      host.innerHTML = emptyState("登录后查看消息", "买卖沟通与系统通知都会汇总到这里", '<button class="btn" type="button" id="msgLogin"><span>登录 / 注册</span></button>');
      $("#msgLogin").onclick = () => App.openAuthModal("login");
      return;
    }

    host.innerHTML = `
      <div class="message-layout">
        <aside class="panel conv-panel">
          <h3>会话</h3>
          <div id="convList"></div>
          <h3>系统通知</h3>
          <div id="noticeList"></div>
        </aside>
        <section class="panel chat-panel" id="chatPanel">
          <div class="detail-loading"><span class="spinner"></span>选择左侧会话开始沟通</div>
        </section>
      </div>`;

    let currentPeer = null;
    const loadConversations = async () => {
      const data = await Store.api("/api/conversations");
      $("#convList").innerHTML = data.conversations.length
        ? data.conversations.map((c) => `
          <button class="conv-row ${currentPeer === c.peer_id ? "active" : ""}" type="button" data-peer="${c.peer_id}">
            <span class="avatar-sm">${esc((c.peer_name || "?").slice(0, 1))}</span>
            <span class="conv-body"><strong>${esc(c.peer_name)}</strong><em class="muted small">${esc(c.last_body)}</em></span>
            ${c.unread ? `<em class="badge-dot">${c.unread}</em>` : ""}
          </button>`).join("")
        : '<p class="muted small">还没有会话，在商品详情点“联系卖家”即可开始沟通。</p>';
      $$("[data-peer]", host).forEach((btn) => (btn.onclick = () => openChat(Number(btn.dataset.peer))));
    };

    const loadNotices = async () => {
      const data = await Store.api("/api/notifications");
      $("#noticeList").innerHTML = data.notifications.length
        ? data.notifications.slice(0, 8).map((n) => `
          <div class="notice-mini ${n.read_at ? "" : "unread"}">
            <strong>${esc(n.title)}</strong>
            <p class="muted small">${esc(n.body)} · ${relative(n.created_at)}</p>
          </div>`).join("")
        : '<p class="muted small">暂无通知。</p>';
    };

    const openChat = async (peer) => {
      currentPeer = peer;
      const panel = $("#chatPanel");
      panel.innerHTML = '<div class="detail-loading"><span class="spinner"></span>加载会话…</div>';
      const data = await Store.api(`/api/messages?peer=${peer}`);
      const conv = (await Store.api("/api/conversations")).conversations.find((c) => c.peer_id === peer);
      panel.innerHTML = `
        <header class="chat-head"><strong>${esc(conv?.peer_name || "对方用户")}</strong>
          <span class="muted small">信用 ${conv?.peer_credit ?? "-"}</span></header>
        <div class="chat-box" id="chatBox">
          ${data.messages.length ? data.messages.map((m) => `
            <div class="bubble ${m.from_user === Store.user.id || m.fromUser === Store.user.id ? "mine" : "theirs"}">
              ${esc(m.body)}<em>${relative(m.createdAt || m.created_at)}</em></div>`).join("")
            : '<p class="muted small">还没有消息，打个招呼吧。</p>'}
        </div>
        <div class="quick-row">
          ${["还在吗？", "能便宜一点吗？", "有原包装和凭证吗？"].map((q) => `<button class="chip" type="button" data-quick="${esc(q)}">${esc(q)}</button>`).join("")}
          <button class="chip" type="button" id="reportUser">举报该用户</button>
        </div>
        <div class="inline-field">
          <input class="field" id="chatInput" maxlength="300" placeholder="输入消息，禁止留下站外联系方式">
          <button class="btn" type="button" id="chatSend"><span>发送</span></button>
        </div>`;
      const box = $("#chatBox");
      box.scrollTop = box.scrollHeight;
      $$("[data-quick]", panel).forEach((b) => (b.onclick = () => { $("#chatInput").value = b.dataset.quick; }));
      $("#reportUser").onclick = () => App.openReportModal({ type: "user", id: peer, label: conv?.peer_name });
      const send = async () => {
        try {
          await Store.api("/api/messages", { method: "POST", body: { to: peer, body: $("#chatInput").value } });
          $("#chatInput").value = "";
          await openChat(peer);
          await loadConversations();
          await Store.refresh().catch(() => null);
        } catch (e) {
          showToast(e.message, "error");
        }
      };
      $("#chatSend").onclick = send;
      $("#chatInput").onkeydown = (event) => { if (event.key === "Enter") send(); };
      await loadConversations();
    };

    await loadConversations();
    await loadNotices();
  }
  App.initMessages = initMessages;

  /* =========================
     页面：运营后台
     ========================= */
  async function initAdmin() {
    const host = $("#adminHost");
    if (!host) return;
    if (!requireLogin("后台需要管理员登录")) {
      host.innerHTML = emptyState("请使用管理员账号登录", "演示管理员：18800000000 / admin888", '<button class="btn" type="button" id="adminLogin"><span>登录</span></button>');
      $("#adminLogin").onclick = () => App.openAuthModal("login");
      return;
    }
    if (!Store.user.isAdmin) {
      host.innerHTML = emptyState("当前账号没有后台权限", "请使用管理员账号 18800000000 / admin888 登录", '<button class="btn" type="button" id="adminSwitch"><span>切换账号</span></button>');
      $("#adminSwitch").onclick = async () => {
        await Store.logout();
        App.openAuthModal("login");
      };
      return;
    }

    host.innerHTML = `
      <nav class="tabs" role="tablist" id="adminTabs">
        ${[["dashboard", "数据看板"], ["audit", "商品审核"], ["reports", "举报处理"], ["users", "用户管理"], ["logs", "审计日志"]]
          .map(([id, label], i) => `<button role="tab" type="button" data-tab="${id}" class="${i === 0 ? "active" : ""}">${label}</button>`).join("")}
      </nav>
      <section id="adminPanel"><div class="detail-loading"><span class="spinner"></span>加载后台数据…</div></section>`;

    const panel = $("#adminPanel");
    const tabs = { dashboard: renderDashboard, audit: renderAudit, reports: renderReports, users: renderUsers, logs: renderLogs };
    $$("#adminTabs button").forEach((btn) => {
      btn.onclick = async () => {
        $$("#adminTabs button").forEach((b) => b.classList.toggle("active", b === btn));
        await tabs[btn.dataset.tab]();
      };
    });

    async function renderDashboard() {
      const { stats } = await Store.api("/api/admin/stats");
      panel.innerHTML = `
        ${stats.local ? '<p class="notice-bar">当前为本地演示模式：统计口径基于本机数据，启动 npm start 后为全站真实数据。</p>' : ""}
        <div class="kpi-grid">
          ${[
            ["在售商品", stats.onSale, `总商品 ${stats.products}`],
            ["注册用户", stats.users, `7 日新增 ${stats.newUsers7d}`],
            ["成交订单", stats.completedOrders, `订单总数 ${stats.orders}`],
            ["成交额 GMV", money(stats.gmv), "仅统计已完成订单"],
            ["估价次数", stats.estimates, `收藏评价 ${stats.reviews} 条`],
            ["平均评分", stats.avgScore || "-", "满分 5 分"],
            ["页面浏览 PV", stats.pv, `去重访客 ${stats.uv}`],
            ["待处理举报", stats.pendingReports, `举报总数 ${stats.reports}`],
            ["待审核商品", stats.pendingAudit, "需人工审核后上架"],
            ["转化率", `${stats.conversion}%`, "订单数 / PV"],
            ["今日活跃访客", stats.dau, "按 visitor 去重"],
            ["实名用户", stats.verifiedUsers, "通过实名认证"]
          ].map(([label, value, hint]) => `
            <div class="kpi-card"><span>${label}</span><strong>${value}</strong><em>${hint}</em></div>`).join("")}
        </div>
        <div class="chart-grid">
          <div class="panel"><h3>近 14 天访问量</h3><canvas id="pvChart" aria-label="访问量趋势"></canvas></div>
          <div class="panel"><h3>景区热度排行（按浏览量）</h3><canvas id="scenicChart" aria-label="景区排行"></canvas></div>
          <div class="panel"><h3>品类分布</h3><canvas id="categoryChart" aria-label="品类分布"></canvas></div>
          <div class="panel"><h3>近 7 天事件埋点 TOP</h3>
            <ul class="event-list">${stats.events7d.length ? stats.events7d.map((e) => `<li><span>${esc(e.name)}</span><strong>${e.c}</strong></li>`).join("") : '<li class="muted">暂无埋点数据</li>'}</ul></div>
        </div>`;
      App.drawLineChart($("#pvChart"), (stats.dailyPv.length ? stats.dailyPv : [{ day: new Date().toISOString().slice(0, 10), c: 0 }]).map((d) => ({ date: d.day, price: d.c })), { label: "PV", color: "#c49a5a" });
      App.drawBarChart($("#scenicChart"), stats.scenicRank.slice(0, 8).map((r) => ({ scenic: r.scenic, c: r.views })));
      App.drawBarChart($("#categoryChart"), stats.categoryRank.slice(0, 6).map((r) => ({ category: r.category, c: r.c })));
    }

    async function renderAudit() {
      const { products } = await Store.api("/api/admin/products?status=" + encodeURIComponent("待审核"));
      panel.innerHTML = `
        <div class="panel-head"><h3>待审核商品（${products.length}）</h3><p class="muted small">审核通过后商品才会出现在集市；驳回必须填写原因并会通知卖家</p></div>
        ${products.length ? products.map((p) => `
          <div class="audit-row">
            <img src="${root.assetPath(p.images?.[0] || "")}" alt="${esc(p.name)}">
            <div class="audit-info">
              <strong>${esc(p.name)}</strong>
              <p class="muted small">¥${p.price}（原价 ¥${p.original}）· ${esc(p.scenic)} · ${esc(p.category)} · ${esc(p.condition)}</p>
              <p class="muted small">卖家 ${esc(p.seller?.name || "-")}（信用 ${p.seller?.credit ?? "-"}）· 发布于 ${fmtTime(p.createdAt)}</p>
              <p class="muted small">说明：${esc(p.description || "无")}</p>
            </div>
            <div class="audit-actions">
              <button class="btn small" type="button" data-approve="${esc(p.id)}"><span>通过审核</span></button>
              <button class="btn ghost small danger-text" type="button" data-reject="${esc(p.id)}"><span>驳回</span></button>
              <button class="link-btn" type="button" data-view="${esc(p.id)}">预览</button>
            </div>
          </div>`).join("") : emptyState("没有待审核商品", "卖家新发布的商品会出现在这里")}`;
      panel.onclick = async (event) => {
        const t = event.target.closest("[data-approve],[data-reject],[data-view]");
        if (!t) return;
        try {
          if (t.dataset.view) {
            App.openProductDetail(t.dataset.view);
            return;
          }
          if (t.dataset.approve) {
            await Store.api(`/api/admin/products/${t.dataset.approve}/review`, { method: "POST", body: { approve: true } });
            showToast("已通过审核并上架", "success");
          }
          if (t.dataset.reject) {
            const reason = prompt("请输入驳回原因（会通知卖家）：", "图片无法确认商品真实性，请补充实拍图");
            if (!reason) return;
            await Store.api(`/api/admin/products/${t.dataset.reject}/review`, { method: "POST", body: { approve: false, reason } });
            showToast("已驳回并通知卖家", "success");
          }
          await renderAudit();
        } catch (e) {
          showToast(e.message, "error");
        }
      };
    }

    async function renderReports() {
      const { reports } = await Store.api("/api/admin/reports");
      panel.innerHTML = `
        <div class="panel-head"><h3>举报处理（待处理 ${reports.filter((r) => r.status === "待处理").length}）</h3></div>
        ${reports.length ? reports.map((r) => `
          <div class="report-row ${r.status === "待处理" ? "pending" : ""}">
            <div>
              <strong>${esc(r.reason)}</strong>
              <p class="muted small">对象：${esc(r.target_type)} / ${esc(r.target_label || r.target_id)} · 举报人 ${esc(r.reporter || "用户")} · ${fmtTime(r.created_at)}</p>
              <p class="muted small">补充：${esc(r.detail || "无")}</p>
              ${r.handle_note ? `<p class="muted small">处理记录：${esc(r.handle_note)}</p>` : ""}
            </div>
            <div class="report-actions">
              <span class="status-chip status-${r.status === "待处理" ? "after" : "done"}">${esc(r.status)}</span>
              ${r.status === "待处理" ? `
                <button class="btn small" type="button" data-accept="${r.id}" data-type="${esc(r.target_type)}" data-target="${esc(r.target_id)}"><span>核实违规</span></button>
                <button class="btn ghost small" type="button" data-dismiss="${r.id}"><span>驳回举报</span></button>` : ""}
            </div>
          </div>`).join("") : emptyState("没有举报记录", "买家对商品或用户的举报会出现在这里")}`;
      panel.onclick = async (event) => {
        const t = event.target.closest("[data-accept],[data-dismiss]");
        if (!t) return;
        try {
          if (t.dataset.accept) {
            const note = prompt("请输入处理结论（会通知举报人）：", "核实违规，已下架相关内容") || "核实违规";
            await Store.api(`/api/admin/reports/${t.dataset.accept}`, { method: "POST", body: { accept: true, note } });
            showToast("已处理并通知相关人员", "success");
          }
          if (t.dataset.dismiss) {
            const note = prompt("请输入驳回说明：", "经核实内容未违规") || "经核实内容未违规";
            await Store.api(`/api/admin/reports/${t.dataset.dismiss}`, { method: "POST", body: { accept: false, note } });
            showToast("举报已驳回", "success");
          }
          await renderReports();
        } catch (e) {
          showToast(e.message, "error");
        }
      };
    }

    async function renderUsers() {
      const { users } = await Store.api("/api/admin/users");
      panel.innerHTML = `
        <div class="panel-head"><h3>用户管理（${users.length}）</h3></div>
        <div class="table-wrap">
          <table class="admin-table">
            <thead><tr><th>昵称</th><th>手机号</th><th>信用分</th><th>实名</th><th>商品 / 订单</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>${users.map((u) => `
              <tr>
                <td>${esc(u.nickname)}${u.isAdmin ? ' <span class="tag">管理员</span>' : ""}</td>
                <td>${esc(u.phone)}</td>
                <td>${u.credit} · ${esc(u.creditLevel || "")}</td>
                <td>${u.idVerified ? "已认证" : "未认证"}</td>
                <td>${u.productCount} / ${u.orderCount}</td>
                <td>${u.status === "active" ? "正常" : u.status === "frozen" ? "已冻结" : "已注销"}</td>
                <td>${u.id === Store.user.id ? "-" : `<button class="link-btn" type="button" data-toggle="${u.id}" data-status="${u.status}">${u.status === "frozen" ? "恢复" : "冻结"}</button>`}</td>
              </tr>`).join("")}</tbody>
          </table>
        </div>`;
      panel.onclick = async (event) => {
        const t = event.target.closest("[data-toggle]");
        if (!t) return;
        const next = t.dataset.status === "frozen" ? "active" : "frozen";
        if (!(await confirmDialog({ title: next === "frozen" ? "冻结账号" : "恢复账号", message: next === "frozen" ? "冻结后该用户会立即下线且无法登录。" : "恢复后该用户可以正常登录。", confirmText: "确认" }))) return;
        try {
          await Store.api(`/api/admin/users/${t.dataset.toggle}/status`, { method: "POST", body: { status: next } });
          showToast("操作成功", "success");
          await renderUsers();
        } catch (e) {
          showToast(e.message, "error");
        }
      };
    }

    async function renderLogs() {
      const { logs } = await Store.api("/api/admin/audit");
      panel.innerHTML = `
        <div class="panel-head"><h3>审计日志（最近 ${logs.length} 条）</h3><p class="muted small">记录注册、发布、订单流转、审核与举报处理等敏感操作</p></div>
        <div class="table-wrap"><table class="admin-table">
          <thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>说明</th></tr></thead>
          <tbody>${logs.map((l) => `<tr><td>${fmtTime(l.created_at)}</td><td>${esc(l.nickname || "系统")}</td><td>${esc(l.action)}</td><td>${esc(l.target)}</td><td class="muted">${esc(l.detail || "")}</td></tr>`).join("")}</tbody>
        </table></div>`;
    }

    await renderDashboard();
  }
  App.initAdmin = initAdmin;

  /* =========================
     启动
     ========================= */
  const PAGE_INIT = {
    home: App.initHome,
    estimate: App.initEstimate,
    compare: App.initCompare,
    market: App.initMarket,
    profile: App.initProfile,
    orders: App.initOrders,
    messages: App.initMessages,
    admin: App.initAdmin
  };

  document.addEventListener("DOMContentLoaded", async () => {
    /* 引导只执行一次，避免脚本被重复引入或事件被重复派发时重复绑定 */
    if (root.__zhijiabaoBooted) return;
    root.__zhijiabaoBooted = true;
    try {
      await Store.init();
    } catch (e) {
      console.error("[app] 数据层初始化失败", e);
    }
    App.renderModeBadge();
    await App.renderHeaderAuth();
    Store.onChange(() => App.renderHeaderAuth());

    /* PWA：注册 Service Worker，弱网与离线也能打开已缓存的页面 */
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register(root.assetPath("sw.js")).catch(() => null);
    }

    const page = document.body.dataset.page;
    const init = PAGE_INIT[page];
    if (!init) return;
    try {
      await init();
      document.body.classList.add("app-ready");
    } catch (e) {
      console.error("[app] 页面初始化失败", e);
      showToast(`页面初始化失败：${e.message}`, "error");
    }
  });
})(typeof window !== "undefined" ? window : globalThis);
