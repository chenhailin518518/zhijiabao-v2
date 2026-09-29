/* =========================================================
   智价宝 - 外部 API 服务模块
   封装：天气数据（在线模式优先走本站后端代理，纯静态部署回退直连 Open-Meteo）
   特点：纯前端可用、免费无 Key、自带 localStorage 缓存
   注：地理编码与二维码两个境外服务已移除——前者始终无人调用且景区坐标已内置，
       后者从未接线（页面里不存在对应容器），留着只会让小程序改造多两个不可用域名。
   ========================================================= */

"use strict";

/* =========================
  景区坐标映射表（WGS84）
  直接派生自 site-data.js 的共享字典，同一批坐标不再两处维护
   ========================= */
const SCENIC_COORDINATES = Object.fromEntries(
  (window.ZhijiabaoData?.SCENICS || []).map((s) => [s.id, { lat: s.lat, lon: s.lon, city: s.city }])
);

/* WMO 天气代码映射与因子计算已收敛到 pricing.js，浏览器与后端代理共用一份 */


/* =========================
   缓存工具（自带过期时间）
   ========================= */
const APICache = {
  _prefix: "zhijiabao-api-cache-",
  _defaultTTL: 30 * 60 * 1000, /* 默认30分钟 */

  get(key) {
    try {
      const raw = localStorage.getItem(this._prefix + key);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (Date.now() > data.expireAt) {
        localStorage.removeItem(this._prefix + key);
        return null;
      }
      return data.value;
    } catch (e) {
      console.warn("[APICache] read failed:", key, e);
      return null;
    }
  },

  set(key, value, ttl = this._defaultTTL) {
    try {
      const data = { value, expireAt: Date.now() + ttl };
      localStorage.setItem(this._prefix + key, JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn("[APICache] write failed:", key, e);
      return false;
    }
  },

  clear() {
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith(this._prefix))
        .forEach(k => localStorage.removeItem(k));
    } catch (e) { /* ignore */ }
  }
};

/* =========================
   安全的 fetch 封装（带超时和降级）
   ========================= */
async function safeFetch(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

/* =========================
  天气服务
  在线模式优先走本站后端代理 /api/weather（后端按景区缓存并对境外域名负责），
  纯静态部署没有后端时回退为浏览器直连 Open-Meteo。
  proxyAvailable 记录代理是否可用，避免静态托管下每次请求都先打一次 404。
   ========================= */
let proxyAvailable = null;

const WeatherService = {
  /**
   * 获取景区实时天气
   * @param {string} scenic - 景区名称
   * @returns {Promise<Object>} 天气数据对象
   */
  async getCurrent(scenic) {
    const coord = SCENIC_COORDINATES[scenic];
    if (!coord) {
      console.warn("[Weather] 未找到景区坐标:", scenic);
      return null;
    }

    /* 先查缓存 */
    const cacheKey = `weather-${scenic}`;
    const cached = APICache.get(cacheKey);
    if (cached) {
      console.log("[Weather] 命中缓存:", scenic);
      return cached;
    }

    const P = window.ZhijiabaoPricing;
    const store = window.Store;

    /* 在线模式：走自有后端代理 */
    if (P && proxyAvailable !== false && store?.mode !== "offline") {
      try {
        const resp = await fetch(`${store?.apiBase || ""}/api/weather?scenic=${encodeURIComponent(scenic)}`, {
          headers: { Accept: "application/json" }
        });
        const payload = resp.ok ? await resp.json() : null;
        if (payload && payload.weather) {
          proxyAvailable = true;
          /* 降级值不写缓存，否则一次上游抖动会把中性因子锁定 15 分钟 */
          if (!payload.weather.isDegraded) APICache.set(cacheKey, payload.weather, 15 * 60 * 1000);
          console.log("[Weather] 代理获取成功:", scenic, payload.weather.weatherLabel);
          return payload.weather;
        }
        proxyAvailable = false;
      } catch (e) {
        proxyAvailable = false;
        console.warn("[Weather] 后端代理不可用，回退直连:", e.message);
      }
    }

    /* 直连兜底：静态托管（GitHub Pages 等）没有后端 */
    try {
      const data = await safeFetch(P.openMeteoUrl(coord.lat, coord.lon));
      const result = P.weatherFromOpenMeteo(data, { scenic, city: coord.city });
      APICache.set(cacheKey, result, 15 * 60 * 1000);
      console.log("[Weather] 获取成功:", scenic, result.weatherLabel, `${result.temperature}°C`);
      return result;
    } catch (e) {
      console.error("[Weather] 获取失败:", scenic, e.message);
      return P.degradedWeather({ scenic, city: coord.city });
    }
  },

  /**
   * 批量获取多个景区天气（并行）
   * @param {string[]} scenics - 景区名称数组
   */
  async getBatch(scenics) {
    const unique = [...new Set(scenics)];
    const results = await Promise.all(unique.map(s => this.getCurrent(s)));
    const map = {};
    results.forEach((r, i) => { if (r) map[unique[i]] = r; });
    return map;
  }
};

/* =========================
  统一导出（挂到 window，供 script.js 调用）
   ========================= */
window.ZhijiabaoAPI = {
  SCENIC_COORDINATES,
  WeatherService,
  APICache,
  version: "2.0.0"
};

console.log("%c[智价宝API服务] 已加载 v2.0.0 | 天气（代理优先，直连兜底）", "color:#4f827a;font-weight:bold;");
