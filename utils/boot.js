/*
  智价宝小程序 · 启动封装
  数据层的初始化是异步的（要探测后端是否可用），页面 onLoad 里统一 await ready()，
  既能保证拿到 Store 实例，又不会出现「页面先跑、Store 还没 init」的时序问题。
  初始化只做一次，多个页面并发进入时共用同一个 Promise。
*/
const Store = require("./store.js");

let bootPromise = null;

/*
  把探测出来的档位回写到 globalData。
  档位原本只存在 Store 上，globalData.mode 一直停在初始值 "checking"，
  任何按 globalData 判断「现在是不是在线」的代码都会永远判成离线。
*/
function syncAppMode(mode) {
  try {
    const app = getApp();
    if (app && app.globalData) app.globalData.mode = mode;
  } catch (e) { /* 页面之外调用，拿不到 App 实例不影响数据层 */ }
}

function ready() {
  if (!bootPromise) {
    bootPromise = Store.init()
      .then((mode) => {
        const settled = Store.mode || mode || "offline";
        syncAppMode(settled);
        return settled;
      })
      .catch((err) => {
        console.warn("[boot] 数据层初始化失败，降级为本地演示模式", err);
        Store.mode = "offline";
        syncAppMode("offline");
        return "offline";
      });
  }
  return bootPromise;
}

module.exports = { ready, Store };
