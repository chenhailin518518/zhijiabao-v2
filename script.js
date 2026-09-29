/*
  智价宝 - 通用交互与动效层
  职责：主题切换、粒子背景、光标辉光、页面过渡、滚动进度、Toast、弹窗基座、
        键盘无障碍、图片懒加载、剪贴板、移动端触控优化等通用 UI 能力。
  业务逻辑（账号、商品、订单、评价、后台等）见 app-core.js / app-account.js，
  数据访问见 store.js（在线连后端 / 离线用浏览器本地存储）。
*/

"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const scriptAssetPrefix = (() => {
  const src = document.currentScript?.getAttribute("src") || "";
  return src.startsWith("../") ? "../" : "";
})();

function assetPath(path) {
  if (!path || /^(?:[a-z]+:|\/|#)/i.test(path)) return path;
  return `${scriptAssetPrefix}${path}`;
}

/* 防抖 */
function debounce(fn, delay = 300) {
  let timer = null;
  return function (...args) {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn.apply(this, args), delay);
  };
}

/* 节流 */
function throttle(fn, limit = 200) {
  let inThrottle = false;
  return function (...args) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      window.setTimeout(() => { inThrottle = false; }, limit);
    }
  };
}

/* 安全的 localStorage 操作 */
const safeStorage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn("[storage] read failed:", key, e);
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn("[storage] write failed:", key, e);
      return false;
    }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }
};

/* 格式化日期 */
function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* 转义HTML，防止XSS */
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}

/* =========================
   移动端检测与适配工具
   ========================= */
const isMobileDevice = () => {
  if (typeof window === "undefined") return false;
  const userAgent = navigator.userAgent || navigator.vendor || window.opera || "";
  const mobileRegex = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i;
  const isMobileUA = mobileRegex.test(userAgent);
  const isSmallScreen = window.innerWidth <= 768;
  const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
  return isMobileUA || (isSmallScreen && isTouch);
};

const isTouchDevice = () => {
  return "ontouchstart" in window || navigator.maxTouchPoints > 0 || window.matchMedia?.("(pointer: coarse)").matches;
};

/* 设置CSS变量 --vh（处理移动端浏览器地址栏问题） */
function setViewportHeight() {
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty("--vh", `${vh}px`);
}

/* 移动端优化：禁用某些桌面端功能 */
function applyMobileOptimizations() {
  if (isMobileDevice()) {
    document.body.classList.add("is-mobile");
  }
  if (isTouchDevice()) {
    document.body.classList.add("is-touch");
  }
}

/* =========================
   轻量音效系统
   ========================= */
const interactionSound = (() => {
  let audioContext = null;
  let masterGain = null;
  let lastPlay = 0;

  const presets = {
    tap: { from: 540, to: 690, duration: 0.12, volume: 0.026 },
    page: { from: 360, to: 250, duration: 0.18, volume: 0.024 },
    modal: { from: 420, to: 760, duration: 0.22, volume: 0.03 },
    close: { from: 430, to: 280, duration: 0.12, volume: 0.022 },
    theme: { from: 520, to: 860, duration: 0.24, volume: 0.028 },
    success: { from: 660, to: 880, duration: 0.2, volume: 0.028 },
    error: { from: 320, to: 200, duration: 0.18, volume: 0.026 }
  };

  function ensureContext() {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    if (!audioContext) {
      audioContext = new AudioCtor();
      masterGain = audioContext.createGain();
      masterGain.gain.value = 0.34;
      masterGain.connect(audioContext.destination);
    }
    if (audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }
    return audioContext;
  }

  function play(type = "tap") {
    const nowMs = Date.now();
    if (nowMs - lastPlay < 48) return;
    lastPlay = nowMs;
    const ctx = ensureContext();
    if (!ctx || !masterGain) return;
    const preset = presets[type] || presets.tap;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = "sine";
    osc.frequency.setValueAtTime(preset.from, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(80, preset.to), now + preset.duration);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1800, now);
    filter.frequency.exponentialRampToValueAtTime(900, now + preset.duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(preset.volume, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + preset.duration);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + preset.duration + 0.04);
  }

  return { play };
})();


/* =========================
   错误边界：捕获未处理异常，避免白屏
   ========================= */
function initErrorBoundary() {
  window.addEventListener("error", (event) => {
    console.error("[global error]", event.message, event.filename, event.lineno);
  });
  window.addEventListener("unhandledrejection", (event) => {
    console.error("[unhandled promise]", event.reason);
  });
}

/* =========================
   键盘无障碍：ESC关闭弹窗、焦点管理
   ========================= */
function initKeyboardAccessibility() {
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const openModals = $$(".modal-backdrop.is-open");
      if (openModals.length > 0) {
        const topModal = openModals[openModals.length - 1];
        closeModal(topModal);
        interactionSound.play("close");
      }
    }
  });
}

/* =========================
   图片懒加载
   ========================= */
function initLazyImages() {
  if (!("IntersectionObserver" in window)) {
    $$("img[data-src]").forEach((img) => { img.src = img.dataset.src; });
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const img = entry.target;
        if (img.dataset.src) {
          img.src = img.dataset.src;
          img.removeAttribute("data-src");
        }
        observer.unobserve(img);
      }
    });
  }, { rootMargin: "200px" });
  $$("img[data-src]").forEach((img) => observer.observe(img));
}

/* =========================
   骨架屏
   ========================= */
function initSkeletonScreen() {
  const skeleton = $("#skeletonScreen");
  if (!skeleton) {
    document.body.classList.remove("skeleton-active");
    return;
  }
  const start = Date.now();
  const minVisibleMs = 680;
  function hideSkeleton() {
    const wait = Math.max(0, minVisibleMs - (Date.now() - start));
    window.setTimeout(() => {
      skeleton.classList.add("is-hidden");
      document.body.classList.remove("skeleton-active");
      window.setTimeout(() => skeleton.remove(), 720);
    }, wait);
  }
  if (document.readyState === "complete") {
    hideSkeleton();
  } else {
    window.addEventListener("load", hideSkeleton, { once: true });
    window.setTimeout(hideSkeleton, 2200);
  }
}

/* =========================
   主题切换
   ========================= */
function initThemeToggle() {
  const button = $("#themeToggle");
  const icon = button?.querySelector(".theme-toggle-icon");
  const storageKey = "zhijiabao-theme";
  function applyTheme(theme, withMotion = false) {
    const isDark = theme === "dark";
    document.body.classList.toggle("theme-dark", isDark);
    if (button) {
      button.setAttribute("aria-pressed", String(isDark));
      button.setAttribute("aria-label", isDark ? "切换浅色国风主题" : "切换深色国风主题");
      button.title = isDark ? "切换浅色国风" : "切换深色国风";
    }
    if (icon) icon.textContent = isDark ? "日" : "☾";
    if (withMotion) {
      document.body.classList.add("theme-transition");
      window.setTimeout(() => document.body.classList.remove("theme-transition"), 680);
    }
  }
  const saved = safeStorage.get(storageKey);
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"));
  button?.addEventListener("click", () => {
    const next = document.body.classList.contains("theme-dark") ? "light" : "dark";
    safeStorage.set(storageKey, next);
    applyTheme(next, true);
    interactionSound.play("theme");
  });
}

/* =========================
   交互音效
   ========================= */
function initInteractionSounds() {
  document.addEventListener("click", (event) => {
    const target = event.target.closest("button, .btn, .filter-tag, .condition-option");
    if (!target) return;
    if (target.closest("#themeToggle")) return;
    if (target.closest("a[data-transition]")) return;
    interactionSound.play("tap");
  });
}

/* =========================
   鼠标跟随微光
   ========================= */
function initCursorGlow() {
  if (window.matchMedia?.("(pointer: coarse)").matches) return;
  const glow = document.createElement("div");
  glow.className = "cursor-glow";
  glow.setAttribute("aria-hidden", "true");
  const dots = Array.from({ length: 9 }, () => {
    const dot = document.createElement("span");
    dot.className = "cursor-trail-dot";
    dot.setAttribute("aria-hidden", "true");
    document.body.appendChild(dot);
    return dot;
  });
  document.body.appendChild(glow);
  const points = dots.map(() => ({ x: window.innerWidth / 2, y: window.innerHeight / 2, alpha: 0 }));
  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight / 2;
  let visible = false;
  function animate() {
    points[0].x += (mouseX - points[0].x) * 0.38;
    points[0].y += (mouseY - points[0].y) * 0.38;
    points[0].alpha = visible ? 1 : 0;
    for (let i = 1; i < points.length; i += 1) {
      points[i].x += (points[i - 1].x - points[i].x) * 0.34;
      points[i].y += (points[i - 1].y - points[i].y) * 0.34;
      points[i].alpha = Math.max(0, points[i - 1].alpha - 0.09);
    }
    glow.style.opacity = visible ? "1" : "0";
    glow.style.transform = `translate3d(${mouseX - 64}px, ${mouseY - 64}px, 0) scale(${visible ? 1 : 0.82})`;
    dots.forEach((dot, index) => {
      const point = points[index];
      const scale = Math.max(0.24, 1 - index * 0.075);
      dot.style.opacity = String(point.alpha * (0.52 - index * 0.035));
      dot.style.transform = `translate3d(${point.x - 10}px, ${point.y - 10}px, 0) scale(${scale})`;
    });
    requestAnimationFrame(animate);
  }
  window.addEventListener("pointermove", (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;
    visible = true;
  }, { passive: true });
  window.addEventListener("pointerleave", () => { visible = false; });
  requestAnimationFrame(animate);
}

/* =========================
   粒子背景
   ========================= */
function initParticles() {
  const canvas = $("#particleCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const particles = [];
  let width = 0;
  let height = 0;
  let rafId = 0;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    particles.length = 0;
    const count = isMobileDevice()
      ? Math.min(32, Math.floor(width * height / 25000))
      : Math.min(76, Math.floor(width * height / 18000));
    for (let i = 0; i < count; i += 1) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 1.4 + Math.random() * 3.2,
        vx: -0.12 + Math.random() * 0.24,
        vy: -0.08 - Math.random() * 0.18,
        alpha: 0.16 + Math.random() * 0.3,
        hue: Math.random() > 0.5 ? "36,72,83" : "171,132,91"
      });
    }
  }
  function draw() {
    ctx.clearRect(0, 0, width, height);
    particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.y < -20) p.y = height + 20;
      if (p.x < -20) p.x = width + 20;
      if (p.x > width + 20) p.x = -20;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.hue},${p.alpha})`;
      ctx.fill();
    });
    rafId = requestAnimationFrame(draw);
  }
  resize();
  draw();
  window.addEventListener("resize", debounce(resize, 200));
  window.addEventListener("beforeunload", () => cancelAnimationFrame(rafId));
}

/* =========================
   页面转场
   ========================= */
function initPageTransitions() {
  const mask = $(".transition-mask");
  $$("a[data-transition]").forEach((link) => {
    link.addEventListener("click", (event) => {
      const href = link.getAttribute("href");
      if (!href || href.startsWith("#") || link.target === "_blank") return;
      event.preventDefault();
      interactionSound.play("page");
      mask?.classList.add("is-active");
      document.body.classList.add("is-leaving");
      window.setTimeout(() => { window.location.href = href; }, 430);
    });
  });
}

/* =========================
   顶部导航
   ========================= */
function initHeader() {
  const hero = $(".hero, .page-hero");
  function update() {
    const y = window.scrollY;
    document.body.classList.toggle("nav-compact", y > 42);
    if (hero) {
      hero.style.backgroundPosition = `center ${Math.round(y * 0.12)}px`;
    }
  }
  update();
  window.addEventListener("scroll", throttle(update, 100), { passive: true });
}

/* =========================
   滚动渐显
   ========================= */
function initReveal() {
  const nodes = $$(".reveal");
  nodes.forEach((node, index) => {
    node.style.transitionDelay = `${Math.min(index % 8, 7) * 70}ms`;
  });
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.14 });
  nodes.forEach((node) => observer.observe(node));
}

function initHeroText() {
  const title = $("[data-split-text]");
  if (!title) return;
  if (window.matchMedia?.("(max-width: 720px)").matches) return;
  const text = title.textContent.trim();
  title.textContent = "";
  [...text].forEach((ch, index) => {
    const span = document.createElement("span");
    span.className = "char";
    span.style.animationDelay = `${index * 42}ms`;
    span.textContent = ch === " " ? "\u00A0" : ch;
    title.appendChild(span);
  });
}

function initProductLoops() {
  $$(".product-card.float-loop").forEach((card, index) => {
    card.style.animationDelay = `${index * -0.55}s`;
  });
}

/* =========================
   数字动画
   ========================= */
function animateNumber(node, target, duration) {
  const start = performance.now();
  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    node.textContent = Math.round(target * eased);
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* =========================
   弹窗通用控制
   ========================= */
function closeModal(modal) {
  const card = modal?.querySelector(".modal-card");
  if (!modal || !card) return;
  card.classList.add("is-closing");
  interactionSound.play("close");
  window.setTimeout(() => {
    modal.classList.remove("is-open");
    card.classList.remove("is-closing");
  }, 260);
}

/* =========================
   Toast 提示
   ========================= */
function showToast(message, type = "info") {
  const old = $(".publish-toast");
  old?.remove();
  const toast = document.createElement("div");
  toast.className = "publish-toast";
  toast.textContent = message;
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  document.body.appendChild(toast);
  interactionSound.play(type === "error" ? "error" : "success");
  window.setTimeout(() => toast.remove(), 2500);
}

function initDraggableModal(modal) {
  const card = modal?.querySelector(".modal-card");
  if (!card) return;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  card.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    try { card.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
  });
  card.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const dx = Math.max(-18, Math.min(18, event.clientX - startX));
    const dy = Math.max(-18, Math.min(18, event.clientY - startY));
    card.style.transform = `translate(${dx}px, ${dy}px) scale(1)`;
  });
  card.addEventListener("pointerup", () => {
    dragging = false;
    card.style.transform = "";
  });
  card.addEventListener("pointercancel", () => {
    dragging = false;
    card.style.transform = "";
  });
}

/* =========================
   1. 滚动进度条：顶部国风渐变进度条
   ========================= */
function initScrollProgress() {
  const bar = document.createElement("div");
  bar.className = "scroll-progress-bar";
  bar.setAttribute("aria-hidden", "true");
  Object.assign(bar.style, {
    position: "fixed",
    top: "0",
    left: "0",
    height: "3px",
    width: "0%",
    background: "linear-gradient(90deg, #244853, #789c8f, #ab845b)",
    zIndex: "9999",
    transition: "width 120ms ease-out",
    boxShadow: "0 0 12px rgba(171,132,91,0.6)"
  });
  document.body.appendChild(bar);

  const update = throttle(() => {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = docHeight > 0 ? Math.min(100, (scrollTop / docHeight) * 100) : 0;
    bar.style.width = `${progress}%`;
  }, 50);

  window.addEventListener("scroll", update, { passive: true });
  update();
}

/* =========================
   2. 回到顶部按钮：滚动超过一屏后显示
   ========================= */
function initBackToTop() {
  const btn = document.createElement("button");
  btn.className = "back-to-top-btn";
  btn.type = "button";
  btn.setAttribute("aria-label", "回到顶部");
  btn.innerHTML = '<span style="font-size:20px;font-weight:900;">↑</span>';
  Object.assign(btn.style, {
    position: "fixed",
    right: "24px",
    bottom: "110px",
    width: "48px",
    height: "48px",
    borderRadius: "50%",
    border: "1px solid rgba(213,189,146,0.5)",
    color: "#f7f4ec",
    cursor: "pointer",
    background: "linear-gradient(135deg, #244853, #4f827a 48%, #ab845b)",
    boxShadow: "0 12px 28px rgba(36,72,83,0.28)",
    opacity: "0",
    transform: "translateY(20px) scale(0.8)",
    transition: "opacity 320ms ease, transform 320ms cubic-bezier(.2,1.45,.35,1)",
    zIndex: "900",
    display: "grid",
    placeItems: "center",
    pointerEvents: "none"
  });
  document.body.appendChild(btn);

  const update = throttle(() => {
    const show = window.scrollY > window.innerHeight * 0.6;
    btn.style.opacity = show ? "1" : "0";
    btn.style.transform = show ? "translateY(0) scale(1)" : "translateY(20px) scale(0.8)";
    btn.style.pointerEvents = show ? "auto" : "none";
  }, 100);

  window.addEventListener("scroll", update, { passive: true });

  btn.addEventListener("click", () => {
    interactionSound.play("tap");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  update();
}

/* =========================
   3. 按钮波纹效果：点击时产生国风水墨波纹
   ========================= */
function initRippleEffect() {
  document.addEventListener("click", (event) => {
    const target = event.target.closest(".btn, button, .filter-tag, .condition-option, .nav-link");
    if (!target) return;
    if (target.closest("#themeToggle")) return;

    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const ripple = document.createElement("span");
    Object.assign(ripple.style, {
      position: "absolute",
      left: `${event.clientX - rect.left - size / 2}px`,
      top: `${event.clientY - rect.top - size / 2}px`,
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: "50%",
      background: "radial-gradient(circle, rgba(255,255,255,0.5), rgba(213,189,146,0.3) 40%, transparent 70%)",
      transform: "scale(0)",
      animation: "rippleExpand 600ms ease-out forwards",
      pointerEvents: "none",
      zIndex: "1"
    });

    const originalPosition = getComputedStyle(target).position;
    if (originalPosition === "static") {
      target.style.position = "relative";
    }
    target.style.overflow = "hidden";
    target.appendChild(ripple);

    window.setTimeout(() => ripple.remove(), 650);
  });

  /* 注入波纹动画关键帧 */
  if (!document.getElementById("ripple-keyframes")) {
    const style = document.createElement("style");
    style.id = "ripple-keyframes";
    style.textContent = `
      @keyframes rippleExpand {
        to { transform: scale(2.5); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }
}

/* =========================
   4. 商品卡片3D倾斜：悬停时根据鼠标位置微倾斜
   ========================= */
function initCardTilt() {
  /* 触摸设备禁用3D倾斜，提升性能 */
  if (isTouchDevice()) return;
  if (window.matchMedia?.("(pointer: coarse)").matches) return;

  const maxTilt = 6;
  document.addEventListener("pointermove", throttle((event) => {
    const card = event.target.closest(".product-card, .glass-card, .panel");
    if (!card) return;
    if (card.closest(".modal-card")) return;

    const rect = card.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;

    card.style.transform = `perspective(800px) rotateY(${x * maxTilt}deg) rotateX(${-y * maxTilt}deg) translateY(-4px) scale(1.012)`;
    card.style.transition = "transform 120ms ease-out";
  }, 16));

  document.addEventListener("pointerout", (event) => {
    const card = event.target.closest(".product-card, .glass-card, .panel");
    if (!card) return;
    card.style.transform = "";
    card.style.transition = "transform 380ms cubic-bezier(.2,1.45,.35,1)";
  });
}

/* =========================
   6. AI智能问答助手：右下角浮动按钮 + 问答面板
   ========================= */
function initAIAssistant() {
  /* 预设问答库 */
  const QA_PAIRS = [
    { keywords: ["估价", "价格", "多少钱", "估值"], answer: "AI智能估价综合景区热度、品相折旧、季节系数、供需指数和历史成交样本，5秒内生成建议成交价。点击顶部「AI智能估价」即可体验。" },
    { keywords: ["比价", "对比", "哪个便宜", "全网"], answer: "全网比价聚合官方商城价、商户清仓价和二手成交价，支持按景区筛选和价格区间过滤，帮你找到最合理的购买价格。" },
    { keywords: ["交易", "购买", "卖", "出售", "发布"], answer: "二手集市支持个人闲置和商户尾货发布，平台担保交易，确认收货后放款，保障买卖双方权益。" },
    { keywords: ["保真", "真假", "验真", "品相"], answer: "平台通过图片识别、包装完整度核验、瑕疵描述和卖家信用体系降低交易争议，支持品相复核和售后申诉。" },
    { keywords: ["景区", "故宫", "西湖", "敦煌", "黄山"], answer: "智价宝已覆盖故宫、西湖、敦煌、黄山、平遥等28个核心景区的文创产品，支持按景区来源筛选和估价。" },
    { keywords: ["你好", "在吗", "hi", "hello", "帮助"], answer: "你好！我是智价宝AI助手，可以为你解答估价、比价、交易、保真等相关问题。请问有什么可以帮你的？" },
    { keywords: ["谢谢", "感谢", "thanks"], answer: "不客气！很高兴能帮到你。如果还有其他问题，随时问我。" }
  ];

  /* 创建浮动按钮 */
  const fab = document.createElement("button");
  fab.className = "ai-assistant-fab";
  fab.type = "button";
  fab.setAttribute("aria-label", "AI智能助手");
  fab.innerHTML = '<span style="font-size:22px;font-weight:900;">智</span>';
  Object.assign(fab.style, {
    position: "fixed",
    right: "24px",
    bottom: "24px",
    width: "56px",
    height: "56px",
    borderRadius: "50%",
    border: "1px solid rgba(213,189,146,0.6)",
    color: "#f7f4ec",
    cursor: "pointer",
    background: "linear-gradient(135deg, #244853, #4f827a 48%, #ab845b)",
    boxShadow: "0 16px 40px rgba(36,72,83,0.32), 0 0 24px rgba(171,132,91,0.3)",
    zIndex: "950",
    display: "grid",
    placeItems: "center",
    transition: "transform 320ms cubic-bezier(.2,1.45,.35,1), box-shadow 320ms ease",
    animation: "fabPulse 3s ease-in-out infinite"
  });
  document.body.appendChild(fab);

  /* 创建问答面板 */
  const panel = document.createElement("div");
  panel.className = "ai-assistant-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "AI智能助手");
  Object.assign(panel.style, {
    position: "fixed",
    right: "24px",
    bottom: "92px",
    width: "min(360px, calc(100vw - 48px))",
    maxHeight: "480px",
    borderRadius: "24px",
    background: "linear-gradient(135deg, rgba(255,255,255,0.82), rgba(247,244,236,0.72))",
    border: "1px solid rgba(255,255,255,0.7)",
    boxShadow: "0 28px 80px rgba(19,41,50,0.28)",
    backdropFilter: "blur(20px)",
    zIndex: "960",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    opacity: "0",
    transform: "translateY(20px) scale(0.92)",
    transition: "opacity 320ms ease, transform 320ms cubic-bezier(.2,1.45,.35,1)",
    pointerEvents: "none"
  });

  panel.innerHTML = `
    <div style="padding:18px 20px;background:linear-gradient(135deg, #244853, #4f827a);color:#f7f4ec;display:flex;align-items:center;justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.18);display:grid;place-items:center;font-weight:900;">智</div>
        <div>
          <div style="font-weight:900;font-size:15px;">智价宝AI助手</div>
          <div style="font-size:11px;opacity:0.7;">在线 · 随时为你解答</div>
        </div>
      </div>
      <button class="ai-panel-close" type="button" style="background:none;border:none;color:#f7f4ec;font-size:20px;cursor:pointer;padding:4px 8px;border-radius:8px;">×</button>
    </div>
    <div class="ai-chat-messages" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;min-height:240px;max-height:300px;">
      <div style="display:flex;gap:8px;align-items:flex-start;">
        <div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#244853,#ab845b);color:#fff;display:grid;place-items:center;font-size:12px;font-weight:900;flex-shrink:0;">智</div>
        <div style="background:rgba(255,255,255,0.7);padding:10px 14px;border-radius:4px 16px 16px 16px;font-size:13px;line-height:1.7;color:#162127;max-width:85%;">你好！我是智价宝AI助手，可以为你解答估价、比价、交易、保真等问题。试试点击下方快捷问题，或直接输入你的问题。</div>
      </div>
    </div>
    <div style="padding:10px 14px;border-top:1px solid rgba(36,72,83,0.1);display:flex;flex-wrap:wrap;gap:6px;">
      <button class="ai-quick-q" data-q="怎么估价？" style="padding:6px 12px;border-radius:999px;border:1px solid rgba(36,72,83,0.15);background:rgba(255,255,255,0.6);font-size:12px;cursor:pointer;color:#244853;">怎么估价？</button>
      <button class="ai-quick-q" data-q="交易安全吗？" style="padding:6px 12px;border-radius:999px;border:1px solid rgba(36,72,83,0.15);background:rgba(255,255,255,0.6);font-size:12px;cursor:pointer;color:#244853;">交易安全吗？</button>
      <button class="ai-quick-q" data-q="支持哪些景区？" style="padding:6px 12px;border-radius:999px;border:1px solid rgba(36,72,83,0.15);background:rgba(255,255,255,0.6);font-size:12px;cursor:pointer;color:#244853;">支持哪些景区？</button>
    </div>
    <div style="padding:12px 14px;border-top:1px solid rgba(36,72,83,0.1);display:flex;gap:8px;">
      <input class="ai-chat-input" type="text" placeholder="输入你的问题..." style="flex:1;height:40px;padding:0 14px;border-radius:999px;border:1px solid rgba(36,72,83,0.18);background:rgba(255,255,255,0.7);font-size:13px;outline:none;">
      <button class="ai-chat-send" type="button" style="width:40px;height:40px;border-radius:50%;border:none;background:linear-gradient(135deg,#244853,#ab845b);color:#fff;cursor:pointer;font-size:16px;">↑</button>
    </div>
  `;
  document.body.appendChild(panel);

  /* 注入动画关键帧 */
  if (!document.getElementById("ai-assistant-keyframes")) {
    const style = document.createElement("style");
    style.id = "ai-assistant-keyframes";
    style.textContent = `
      @keyframes fabPulse {
        0%, 100% { box-shadow: 0 16px 40px rgba(36,72,83,0.32), 0 0 0 0 rgba(171,132,91,0.4); }
        50% { box-shadow: 0 16px 40px rgba(36,72,83,0.32), 0 0 0 12px rgba(171,132,91,0); }
      }
      @keyframes msgIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes typingDot {
        0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
        30% { transform: translateY(-4px); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }

  let isOpen = false;
  function togglePanel(open) {
    isOpen = open !== undefined ? open : !isOpen;
    panel.style.opacity = isOpen ? "1" : "0";
    panel.style.transform = isOpen ? "translateY(0) scale(1)" : "translateY(20px) scale(0.92)";
    panel.style.pointerEvents = isOpen ? "auto" : "none";
    fab.style.transform = isOpen ? "rotate(90deg) scale(0.9)" : "";
    interactionSound.play(isOpen ? "modal" : "close");
  }

  fab.addEventListener("click", () => togglePanel());
  panel.querySelector(".ai-panel-close").addEventListener("click", () => togglePanel(false));

  /* AI回答逻辑 */
  function getAIAnswer(question) {
    const q = question.toLowerCase();
    for (const pair of QA_PAIRS) {
      if (pair.keywords.some(kw => q.includes(kw.toLowerCase()))) {
        return pair.answer;
      }
    }
    return `关于"${question}"，智价宝平台提供AI智能估价、全网透明比价、二手担保交易和景区数据反馈四大核心服务。你可以在顶部导航栏体验各项功能，或点击快捷问题了解更多。`;
  }

  function addMessage(text, isUser = false) {
    const messages = panel.querySelector(".ai-chat-messages");
    const msg = document.createElement("div");
    msg.style.cssText = `display:flex;gap:8px;align-items:flex-start;animation:msgIn 320ms ease forwards;${isUser ? "flex-direction:row-reverse;" : ""}`;
    msg.innerHTML = isUser
      ? `<div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#ab845b,#a84e43);color:#fff;display:grid;place-items:center;font-size:12px;font-weight:900;flex-shrink:0;">我</div>
         <div style="background:linear-gradient(135deg,#244853,#4f827a);color:#f7f4ec;padding:10px 14px;border-radius:16px 4px 16px 16px;font-size:13px;line-height:1.7;max-width:85%;">${escapeHtml(text)}</div>`
      : `<div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#244853,#ab845b);color:#fff;display:grid;place-items:center;font-size:12px;font-weight:900;flex-shrink:0;">智</div>
         <div style="background:rgba(255,255,255,0.7);padding:10px 14px;border-radius:4px 16px 16px 16px;font-size:13px;line-height:1.7;color:#162127;max-width:85%;">${escapeHtml(text)}</div>`;
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
    return msg;
  }

  function showTyping() {
    const messages = panel.querySelector(".ai-chat-messages");
    const typing = document.createElement("div");
    typing.className = "ai-typing-indicator";
    typing.style.cssText = "display:flex;gap:8px;align-items:center;animation:msgIn 320ms ease forwards;";
    typing.innerHTML = `
      <div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#244853,#ab845b);color:#fff;display:grid;place-items:center;font-size:12px;font-weight:900;flex-shrink:0;">智</div>
      <div style="background:rgba(255,255,255,0.7);padding:12px 16px;border-radius:4px 16px 16px 16px;display:flex;gap:4px;">
        <span style="width:6px;height:6px;border-radius:50%;background:#244853;animation:typingDot 1.2s infinite;"></span>
        <span style="width:6px;height:6px;border-radius:50%;background:#244853;animation:typingDot 1.2s infinite 0.2s;"></span>
        <span style="width:6px;height:6px;border-radius:50%;background:#244853;animation:typingDot 1.2s infinite 0.4s;"></span>
      </div>`;
    messages.appendChild(typing);
    messages.scrollTop = messages.scrollHeight;
    return typing;
  }

  function sendQuestion(question) {
    if (!question.trim()) return;
    addMessage(question, true);
    const typing = showTyping();
    interactionSound.play("tap");

    window.setTimeout(() => {
      typing.remove();
      const answer = getAIAnswer(question);
      addMessage(answer, false);
      interactionSound.play("modal");
    }, 900 + Math.random() * 600);
  }

  /* 快捷问题 */
  panel.querySelectorAll(".ai-quick-q").forEach(btn => {
    btn.addEventListener("click", () => {
      sendQuestion(btn.dataset.q);
    });
  });

  /* 输入发送 */
  const input = panel.querySelector(".ai-chat-input");
  const sendBtn = panel.querySelector(".ai-chat-send");
  sendBtn.addEventListener("click", () => {
    sendQuestion(input.value);
    input.value = "";
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      sendQuestion(input.value);
      input.value = "";
    }
  });
}

/* =========================
   7. 首页数据动态脉动：数据看板数字定时微更新，模拟实时数据
   ========================= */
function initDashboardPulse() {
  if (document.body.dataset.page !== "home") return;

  const counters = $$("[data-count]");
  if (!counters.length) return;

  /* 每8秒微更新数据，模拟实时增长 */
  window.setInterval(() => {
    counters.forEach(node => {
      const current = Number(node.textContent.replace(/,/g, "")) || Number(node.dataset.count || 0);
      /* 随机微增 0-2 */
      const increment = Math.floor(Math.random() * 3);
      if (increment > 0) {
        const next = current + increment;
        node.dataset.count = String(next);
        animateNumber(node, next, 600);
      }
    });
  }, 8000);
}

/* =========================
   8. 页面预加载：悬停导航链接时预加载目标页面
   ========================= */
function initPagePreload() {
  const preloaded = new Set();
  $$("a[data-transition]").forEach(link => {
    link.addEventListener("mouseenter", () => {
      const href = link.getAttribute("href");
      if (!href || href.startsWith("#") || preloaded.has(href)) return;
      preloaded.add(href);

      /* 预加载HTML */
      const linkEl = document.createElement("link");
      linkEl.rel = "prefetch";
      linkEl.href = href;
      linkEl.as = "document";
      document.head.appendChild(linkEl);

      /* 预加载JS和CSS */
      const jsLink = document.createElement("link");
      jsLink.rel = "prefetch";
      jsLink.href = "script.js?v=20260904a";
      jsLink.as = "script";
      document.head.appendChild(jsLink);
    });
  });
}

/* =========================
   9. 输入框聚焦增强：聚焦时父容器微光效果
   ========================= */
(function initInputGlow() {
  document.addEventListener("focusin", (event) => {
    const field = event.target.closest(".field, .select");
    if (!field) return;
    field.style.boxShadow = "inset 0 0 18px rgba(213,189,146,0.18), 0 0 0 4px rgba(120,156,143,0.12), 0 0 28px rgba(213,189,146,0.28)";
  });
  document.addEventListener("focusout", (event) => {
    const field = event.target.closest(".field, .select");
    if (!field) return;
    field.style.boxShadow = "";
  });
})();

/* ============================================================
   第三轮增强：AI功能深化 + 数据统计 + 智能推荐 + 体验优化
   ============================================================ */

/* =========================
   1. 复制到剪贴板工具
   ========================= */
function initClipboardUtils() {
  /* 通用复制函数 */
  window.copyToClipboard = function (text, successMsg = "已复制到剪贴板") {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        showToast(successMsg);
      }).catch(() => fallbackCopy(text, successMsg));
    } else {
      fallbackCopy(text, successMsg);
    }
  };

  function fallbackCopy(text, successMsg) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
      showToast(successMsg);
    } catch (e) {
      showToast("复制失败，请手动复制", "error");
    }
    document.body.removeChild(textarea);
  }
}

/* =========================
   4. 可访问性增强：ARIA标签 + 焦点管理 + 跳过导航
   ========================= */
function initAccessibilityEnhance() {
  /* 添加跳过导航链接（屏幕阅读器用） */
  if (!document.querySelector(".skip-link")) {
    const skipLink = document.createElement("a");
    skipLink.className = "skip-link";
    skipLink.href = "#main-content";
    skipLink.textContent = "跳过导航，直达主要内容";
    Object.assign(skipLink.style, {
      position: "absolute",
      top: "-40px",
      left: "0",
      background: "#244853",
      color: "#f7f4ec",
      padding: "8px 16px",
      zIndex: "10000",
      transition: "top 0.2s",
      textDecoration: "none",
      fontSize: "14px"
    });
    skipLink.addEventListener("focus", () => { skipLink.style.top = "0"; });
    skipLink.addEventListener("blur", () => { skipLink.style.top = "-40px"; });
    document.body.prepend(skipLink);
  }

  /* 为主内容区域添加id */
  const mainContent = document.querySelector("main, .main, .page-content, .content");
  if (mainContent && !mainContent.id) {
    mainContent.id = "main-content";
  }

  /* 为所有按钮添加aria-label（如果没有的话） */
  $$("button").forEach(btn => {
    if (!btn.getAttribute("aria-label") && !btn.textContent.trim()) {
      const icon = btn.querySelector("svg, span, i");
      if (icon) {
        btn.setAttribute("aria-label", icon.getAttribute("aria-label") || "按钮");
      }
    }
  });

  /* 为图片添加alt（如果没有的话） */
  $$("img").forEach(img => {
    if (!img.getAttribute("alt")) {
      img.setAttribute("alt", "");
    }
  });

  /* 焦点可见性增强 */
  const style = document.createElement("style");
  style.textContent = `
    :focus-visible {
      outline: 2px solid #789c8f !important;
      outline-offset: 2px;
      border-radius: 4px;
    }
    button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible {
      outline: 2px solid #789c8f !important;
      outline-offset: 2px;
    }
  `;
  document.head.appendChild(style);

  /* 模态框焦点陷阱 */
  const originalCloseModal = window.closeModal;
  window.closeModal = function (modal) {
    originalCloseModal?.(modal);
    /* 焦点返回到触发按钮 */
    const trigger = document.activeElement;
    if (trigger) trigger.focus?.();
  };
}

/* =========================
   移动端触摸优化（防止双击缩放、键盘弹出适配等）
   ========================= */
function initMobileTouchOptimization() {
  if (!isTouchDevice()) return;

  /* 防止双击缩放 */
  let lastTouchEnd = 0;
  document.addEventListener("touchend", (event) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
      event.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false });

  /* 防止手势缩放 */
  document.addEventListener("gesturestart", (event) => {
    event.preventDefault();
  });

  /* 输入框聚焦时自动滚动到可见区域 */
  document.addEventListener("focusin", (event) => {
    const target = event.target;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") {
      setTimeout(() => {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 300);
    }
  });

  /* 键盘收起时恢复视口高度 */
  const originalHeight = window.innerHeight;
  window.addEventListener("resize", () => {
    if (window.innerHeight < originalHeight * 0.75) {
      /* 键盘弹出时 */
      document.body.classList.add("keyboard-open");
    } else {
      /* 键盘收起时 */
      document.body.classList.remove("keyboard-open");
    }
  });

  /* 优化触摸滚动：防止页面滚动时触发点击 */
  let touchStartY = 0;
  let touchStartX = 0;
  let isScrolling = false;

  document.addEventListener("touchstart", (event) => {
    touchStartY = event.touches[0].clientY;
    touchStartX = event.touches[0].clientX;
    isScrolling = false;
  }, { passive: true });

  document.addEventListener("touchmove", (event) => {
    const deltaY = Math.abs(event.touches[0].clientY - touchStartY);
    const deltaX = Math.abs(event.touches[0].clientX - touchStartX);
    if (deltaY > 10 || deltaX > 10) {
      isScrolling = true;
    }
  }, { passive: true });

  /* 滚动时阻止点击事件 */
  document.addEventListener("click", (event) => {
    if (isScrolling) {
      event.preventDefault();
      event.stopPropagation();
      isScrolling = false;
    }
  }, true);

  /* 移动端禁用长按菜单（除了输入框和链接） */
  document.addEventListener("contextmenu", (event) => {
    const target = event.target;
    if (target.closest(".product-card, .glass-card, .panel, .btn, button") &&
        !target.closest("input, textarea, a")) {
      event.preventDefault();
    }
  });

  /* 添加移动端类名到HTML */
  document.documentElement.classList.add("touch-device");
}


/* ========================= 
   全局初始化（装饰与 UI 组件；业务逻辑见 app.js）
   ========================= */
document.addEventListener("DOMContentLoaded", () => {
  try {
    setViewportHeight();
    applyMobileOptimizations();
    window.addEventListener("resize", debounce(setViewportHeight, 200));
    window.addEventListener("orientationchange", () => setTimeout(setViewportHeight, 300));

    initThemeToggle();
    initInteractionSounds();
    initCursorGlow();
    initSkeletonScreen();
    initParticles();
    initPageTransitions();
    initHeader();
    initReveal();
    initHeroText();
    initProductLoops();
    initKeyboardAccessibility();
    initLazyImages();
    initErrorBoundary();
    initScrollProgress();
    initBackToTop();
    initRippleEffect();
    initCardTilt();
    initAIAssistant();
    initDashboardPulse();
    initPagePreload();
    initClipboardUtils();
    initAccessibilityEnhance();
    initMobileTouchOptimization();
  } catch (e) {
    console.error("[ui] init error:", e);
  }
});