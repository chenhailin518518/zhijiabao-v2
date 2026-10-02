/*
  智价宝小程序 · 云端图片显示缓存

  为什么需要这一层：

  云端的商品图在数据库里存的是对象键，形如 users/<uid>/products/xxx.jpg。
  对象键不是能直接塞进 <image src> 的地址，存储也不对外暴露公开 URL
  （唯一合规的读法是服务端签发一个临时下载地址，默认 600 秒、最长 3600 秒）。
  签发是异步的，而 WXML 的 src 是同步取的 —— 两边对不上，就需要一个中间缓存。

  缓存里放两种东西，按来源分：
    本机刚上传的图  值 = 本地临时文件路径（wxfile://...），本机立刻能显示，不额外花时间
    别的设备来的图  值 = 服务端签发的临时地址，带过期时间，过期后自动失效并重新签发

  过期用时间戳判，不引定时器：小程序里定时器会被后台挂起，判不准。
*/
"use strict";

const cache = Object.create(null);

/* 对象键长这样：users/<uid>/products/xxx.jpg 或 shared/<uid>/xxx.jpg */
const KEY_RE = /^(?:users|shared)\/[A-Za-z0-9_\-.]+(?:\/[A-Za-z0-9_\-.()]+)+$/;

function isCloudKey(path) {
  return KEY_RE.test(String(path || ""));
}

/* ttlMs 不传表示不过期（本机临时文件走这条） */
function set(key, url, ttlMs) {
  const k = String(key || "");
  if (!k || !url) return;
  cache[k] = { url: String(url), exp: ttlMs ? Date.now() + ttlMs : 0 };
}

function get(key) {
  const k = String(key || "");
  const hit = cache[k];
  if (!hit) return "";
  if (hit.exp && Date.now() > hit.exp) {
    delete cache[k];
    return "";
  }
  return hit.url;
}

module.exports = { set, get, isCloudKey };
