/*
  智价宝小程序 · 景区天气
  天气只用于修正估价里的「供需指数」，拿不到数据时按中性因子 1.000 计算，不阻塞估价。

  三条取数路径，按可用性依次降级：
    1. API_BASE 已配置 -> 走本站后端代理 /api/weather（后端按景区缓存，且已处理境外域名）
    2. WEATHER_DIRECT 打开 -> 直连 Open-Meteo（需把 api.open-meteo.com 加入 request 合法域名）
    3. 都不可用 -> 返回中性因子，并在界面上如实标注
  计算逻辑复用 pricing.js 的 openMeteoUrl / weatherFromOpenMeteo / degradedWeather，
  与 Web 端、后端代理共用同一份实现。
*/
const D = require("./site-data.js");
const P = require("./pricing.js");
const { API_BASE, WEATHER_DIRECT } = require("./config.js");

const CACHE_PREFIX = "zhijiabao-weather-";
const TTL = 15 * 60 * 1000;

function cacheGet(scenic) {
  try {
    const raw = wx.getStorageSync(CACHE_PREFIX + scenic);
    if (!raw || !raw.expireAt) return null;
    if (Date.now() > raw.expireAt) {
      wx.removeStorageSync(CACHE_PREFIX + scenic);
      return null;
    }
    return raw.value;
  } catch (e) {
    return null;
  }
}

function cacheSet(scenic, value) {
  try {
    wx.setStorageSync(CACHE_PREFIX + scenic, { value, expireAt: Date.now() + TTL });
  } catch (e) { /* ignore */ }
}

function request(url, timeout = 6000) {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: "GET",
      timeout,
      success: (res) => resolve(res),
      fail: (err) => reject(new Error((err && err.errMsg) || "网络请求失败"))
    });
  });
}

const WeatherService = {
  /* 景区坐标来自站点字典，不再单独维护一张表 */
  coordinate(scenic) {
    const row = D.scenic(scenic) || D.matchScenic(scenic);
    return row ? { lat: row.lat, lon: row.lon, city: row.city } : null;
  },

  async getCurrent(scenic) {
    const coord = this.coordinate(scenic);
    if (!coord) return P.degradedWeather({ scenic, city: "" });

    const cached = cacheGet(scenic);
    if (cached) return cached;

    /* 路径 1：后端代理 */
    if (API_BASE) {
      try {
        const res = await request(`${API_BASE}/api/weather?scenic=${encodeURIComponent(scenic)}`, 6000);
        const payload = res.statusCode === 200 ? res.data : null;
        if (payload && payload.weather) {
          if (!payload.weather.isDegraded) cacheSet(scenic, payload.weather);
          return payload.weather;
        }
      } catch (e) { /* 落到下一条路径 */ }
    }

    /* 路径 2：直连 Open-Meteo */
    if (WEATHER_DIRECT) {
      try {
        const res = await request(P.openMeteoUrl(coord.lat, coord.lon), 6000);
        if (res.statusCode === 200 && res.data) {
          const result = P.weatherFromOpenMeteo(res.data, { scenic, city: coord.city });
          cacheSet(scenic, result);
          return result;
        }
      } catch (e) { /* 落到中性因子 */ }
    }

    /* 路径 3：中性天气因子 */
    return P.degradedWeather({ scenic, city: coord.city });
  },

  async getBatch(scenics) {
    const unique = [...new Set(scenics)];
    const results = await Promise.all(unique.map((s) => this.getCurrent(s)));
    const map = {};
    results.forEach((r, i) => { if (r) map[unique[i]] = r; });
    return map;
  },

  /* 给界面用的一句话说明，避免各页面各写一套文案 */
  describe(weather) {
    if (!weather) return "未选择景区";
    if (weather.isDegraded) {
      return `⚠️ 离线演示模式：按中性天气因子 1.000 计算`;
    }
    return `${weather.weatherIcon} ${weather.city} ${weather.temperature}°C ${weather.weatherLabel}，天气因子 ${weather.weatherFactor.toFixed(3)}`;
  }
};

module.exports = WeatherService;
