/*
  智价宝小程序 · 外部图床

  用户拍的商品图交给哪个存储，由 utils/config.js 的 MEDIA.uploadDriver 决定：

    auto   先试腾讯云 CloudBase 云存储，用不了就退回小程序自带的存储
    builtin 固定用自带存储

  外部图床的好处是返回的地址本身就能当图片地址用（<image src> 直接支持），
  不必像自带存储那样先签发临时地址 —— 少一次网络请求，也不会遇到链接过期。

  为什么默认 auto 而不是直接指定云存储：
  云存储这一路有个前置条件，在小程序代码里解决不了 ——
  该环境必须授权给小程序 appid wx66706d5dec015215。
  在腾讯云 CloudBase 控制台「环境 → 概览 → 微信小程序授权」里添加即可。
  没授权时 uploadFile 会失败，本模块退回自带存储并在控制台留痕，上传流程不会中断。
*/
"use strict";

const { MEDIA } = require("./config.js");

/* null 表示还没判断过，避免每次上传都重复探测 */
let usable = null;

function driverEnabled() {
  const driver = MEDIA && MEDIA.uploadDriver;
  if (driver === "builtin") return false;
  return !!MEDIA.cloudbaseEnv;
}

function available() {
  if (usable !== null) return usable;
  if (!driverEnabled()) {
    usable = false;
    return usable;
  }
  if (!wx.cloud || !wx.cloud.uploadFile) {
    console.warn("[media] 当前基础库不支持云存储上传，商品图改存小程序自带存储。");
    usable = false;
    return usable;
  }
  try {
    wx.cloud.init({ env: MEDIA.cloudbaseEnv, traceUser: false });
    usable = true;
  } catch (err) {
    console.warn("[media] 云存储初始化失败，商品图改存小程序自带存储。", err);
    usable = false;
  }
  return usable;
}

/*
  上传一张本地图片，成功返回可直接显示的地址，失败返回空串交由调用方走原路。
  路径与自带存储保持同一套命名（users/<uid>/products/<随机串>.<ext>），
  换图床不用改数据库里的字段含义。
*/
function extOf(filePath) {
  const m = /\.([A-Za-z0-9]{2,5})$/.exec(String(filePath || ""));
  const ext = m ? m[1].toLowerCase() : "jpg";
  return /^(jpe?g|png|gif|webp|bmp)$/.test(ext) ? (ext === "jpeg" ? "jpg" : ext) : "jpg";
}

function randomName() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function upload(filePath, opts) {
  const options = opts || {};
  if (!available()) return Promise.resolve("");

  const uid = String(options.uid || "anonymous");
  const cloudPath = `zhijiabao/users/${uid}/products/${randomName()}.${extOf(filePath)}`;

  return new Promise((resolve) => {
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: (res) => {
        const fileID = (res && res.fileID) || "";
        if (fileID) return resolve(fileID);
        console.warn("[media] 云存储返回结果里没有文件标识，商品图改存小程序自带存储。");
        resolve("");
      },
      fail: (err) => {
        console.warn("[media] 上传到云存储失败，商品图改存小程序自带存储。", err);
        usable = false;
        resolve("");
      }
    });
  });
}

module.exports = { upload, available };
