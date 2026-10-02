/*
  智价宝小程序 · 通用工具
  格式化 / 反馈 / 主题，页面里到处要用的零散能力集中在这里，避免各页面各写一份。
*/

/* 金额：整数不带小数，非整数保留两位 */
function money(value) {
  const n = Math.round(Number(value) || 0);
  return `¥${n}`;
}

function formatDate(input) {
  if (!input) return "";
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return String(input);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function formatDateTime(input) {
  if (!input) return "";
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return String(input);
  const p = (n) => String(n).padStart(2, "0");
  return `${formatDate(d)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* 相对时间：今天 / 昨天 / N 天前 */
function fromNow(input) {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const day = Math.floor(diff / 86400000);
  if (day <= 0) return "今天";
  if (day === 1) return "昨天";
  if (day < 30) return `${day} 天前`;
  return formatDate(d);
}

/*
  商品图片路径归一。

  五种来源，处理方式不同，混在一起就会白图：
    站点字典   assets/img/product-xxx.jpg   Web 相对路径 -> 在线档换托管地址，离线档补前导斜杠
    本地发布   wxfile://store_xxx.jpg        已落盘的本地文件 -> 原样返回，补斜杠会变成 /wxfile://...
    在线发布   /uploads/xxx.jpg              服务端相对路径 -> 在线模式下补上 API 域名
    云端发布   users/<uid>/products/xxx.jpg  云端对象键 -> 查显示缓存换成临时地址（见 cloud-media.js）
    外部图床   https://xxx/yyy.jpg           完整地址 -> 原样返回

  云端对象键在显示缓存里查不到时退回占位图：签发临时地址是异步的、会过期，
  同步渲染这一层拿不到也不能留个坏图框。

  在线档取图床、离线档取包内副本，是为了满足一个硬约束：
  比赛现场断网也要能完整演示，商品图不能因为取不到远端就变成空白。
*/
const { API_BASE, MEDIA } = require("./config.js");
const CloudMedia = require("./cloud-media.js");

const PLACEHOLDER = "assets/img/product-pin.jpg";

/*
  当前运行档位。

  必须在使用时读，不能在模块加载时读：档位是 store.js 的 init() 异步探测出来的，
  模块加载那一刻还没定，提前读会永远拿到初始值。
  store.js 通过 require 惰性取，避免它和本模块之间的加载顺序互相牵制。
*/
function runtimeMode() {
  try {
    const app = getApp();
    const mode = app && app.globalData && app.globalData.mode;
    if (mode && mode !== "checking") return mode;
  } catch (e) { /* 页面之外调用，继续往下取 */ }
  try {
    return require("./store.js").mode || "offline";
  } catch (e) {
    return "offline";
  }
}

function isOnline() {
  const mode = runtimeMode();
  return mode === "cloud" || mode === "online";
}

/* 包内静态图：在线档取托管地址，离线档取包内副本 */
function staticImage(rel) {
  if (MEDIA.remote && MEDIA.base && isOnline()) return `${MEDIA.base}/${rel}`;
  return `/${rel}`;
}

function productImage(path) {
  if (!path) return staticImage(PLACEHOLDER);
  const p = String(path);
  /* 已是本地文件、云存储文件标识或完整 http(s) 地址，都能直接当图片地址用 */
  if (/^(wxfile:\/\/|cloud:\/\/|https?:\/\/)/.test(p)) return p;
  if (CloudMedia.isCloudKey(p)) return CloudMedia.get(p) || staticImage(PLACEHOLDER);
  const rel = p.replace(/^\/+/, "");
  if (API_BASE && rel.indexOf("uploads/") === 0) return `${API_BASE}/${rel}`;
  /* 只对包内静态图目录换地址：托管站上只有这一批同名副本，其他相对路径换了就是 404 */
  if (rel.indexOf("assets/img/") === 0) return staticImage(rel);
  return `/${rel}`;
}

function toast(title, icon = "none") {
  wx.showToast({ title: String(title || ""), icon, duration: 1800 });
}

function ok(title) {
  wx.showToast({ title: String(title || "操作成功"), icon: "success", duration: 1500 });
}

function loading(title = "处理中") {
  wx.showLoading({ title, mask: true });
}

function hideLoading() {
  try { wx.hideLoading(); } catch (e) { /* ignore */ }
}

function confirm(content, title = "请确认") {
  return new Promise((resolve) => {
    wx.showModal({
      title,
      content,
      confirmColor: "#244853",
      success: (res) => resolve(!!res.confirm),
      fail: () => resolve(false)
    });
  });
}

function prompt(content, title = "请输入", placeholder = "") {
  return new Promise((resolve) => {
    wx.showModal({
      title,
      content,
      editable: true,
      placeholderText: placeholder,
      confirmColor: "#244853",
      success: (res) => resolve(res.confirm ? String(res.content || "").trim() : null),
      fail: () => resolve(null)
    });
  });
}

/* 统一处理 err：把 Error 的 message 弹出来，避免每个页面写一遍 try/catch 提示 */
function fail(err, fallback = "操作失败，请稍后重试") {
  const message = (err && err.message) || fallback;
  /* 带 hint 的失败要说清「怎么解决」，toast 放不下，改用弹窗 */
  if (err && err.hint) {
    return new Promise((resolve) => {
      wx.showModal({
        title: message,
        content: err.hint,
        showCancel: false,
        confirmText: "确定",
        confirmColor: "#244853",
        complete: () => resolve()
      });
    });
  }
  wx.showToast({ title: message, icon: "none", duration: 2200 });
}

/* 主题读写：所有页面在 onShow 时同步一次，保证跨页切换后颜色一致 */
const THEME_KEY = "zhijiabao-theme";

function getTheme() {
  try { return wx.getStorageSync(THEME_KEY) || ""; } catch (e) { return ""; }
}

function setTheme(theme) {
  try { wx.setStorageSync(THEME_KEY, theme); } catch (e) { /* ignore */ }
}

function toggleTheme(current) {
  const next = current === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

module.exports = {
  money,
  formatDate,
  formatDateTime,
  fromNow,
  productImage,
  toast,
  ok,
  loading,
  hideLoading,
  confirm,
  prompt,
  fail,
  getTheme,
  setTheme,
  toggleTheme
};
