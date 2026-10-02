/*
  智价宝小程序 · 云服务客户端

  全项目只有这一个客户端实例，Auth / Database / Storage / LLM 共用它。
  endpoint 与 publishableKey 两个值都必须传，且都取自 config.js 里的
  publicConfig —— 小程序没有 location.origin，SDK 那条同源兜底在这里不存在，
  漏传 endpoint 会在初始化时就失败。

  wx 传的是 createDiagnosticWx(wx) 包装过的实例：
  请求失败时会在控制台打出 [WorkBuddy Cloud] request failed，
  带方法、URL、状态码、错误码、请求 id，手机上一开 vConsole 就能看到原因。
  成功与主动取消不打印。

  这个文件不做业务，业务在 utils/cloud-api.js。
*/
"use strict";

const { createDiagnosticWx } = require("./workbuddy-cloud-diagnostics.js");
const { CLOUD } = require("./config.js");

let client = null;
let clientError = "";

let sdk = null;

/*
  SDK 用懒加载，不在文件顶层 require。

  原因很实际：SDK 是从 node_modules 装的，要现在微信开发者工具里执行一次
  「工具 → 构建 npm」才会生成 miniprogram_npm，require 才解析得到。
  如果放在顶层，没执行过构建 npm 的机器上一加载这个文件就抛，
  而 utils/cloud-api.js → utils/store.js 是一串 require 链，
  结果是「本地演示模式」也被一起带崩 —— 断网能跑的兜底档反而进不去。

  放到这里之后：云服务没开时这段代码根本不执行；开了但没构建 npm，
  也只是一次有明确原因的可控失败，页面会提示去构建 npm。
*/
function loadSdk() {
  if (sdk) return sdk;
  try {
    sdk = require("@tencent-ai/workbuddy-cloud-sdk/miniprogram");
  } catch (err) {
    throw new Error("云服务组件尚未就绪：请在微信开发者工具中执行一次「工具 → 构建 npm」");
  }
  return sdk;
}

/* 拿不到客户端就返回 null，由调用方决定降级还是报错，这里不抛 */
function getCloud() {
  if (client || clientError) return client;
  const pc = CLOUD.publicConfig || {};
  if (!CLOUD.enabled) {
    clientError = "云服务未启用";
    return null;
  }
  if (!pc.endpoint || !pc.publishableKey) {
    clientError = "云服务配置不完整：缺少接入地址或公钥";
    return null;
  }
  try {
    const { createMiniProgramWorkBuddyCloud } = loadSdk();
    client = createMiniProgramWorkBuddyCloud({
      endpoint: pc.endpoint,
      publishableKey: pc.publishableKey,
      wx: createDiagnosticWx(wx)
    });
  } catch (err) {
    clientError = `云服务初始化失败，请稍后重试`;
    console.warn("[cloud]", clientError);
    client = null;
  }
  return client;
}

const cloudError = () => clientError;

module.exports = { getCloud, cloudError };
