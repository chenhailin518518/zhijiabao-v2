/*
  智价宝小程序 · 运行配置

  数据层有三档，优先级从高到低：云服务模式 -> 在线模式 -> 本地演示模式。

  云服务模式（CLOUD.enabled = true，且云服务探测通过）
    数据落在 WorkBuddy 云服务（托管 PostgreSQL + 行级安全），
    换一台手机登录同一个账号能看到同一份商品、订单、站内信。
    账号体系由云服务托管：用真实手机号收验证码登录。

  在线模式（API_BASE 填 https 域名）
    走自建 Node 后端。需要满足三件事：域名已在微信公众平台配置为 request
    合法域名、已完成 ICP 备案、证书受客户端信任。填错会导致全部请求被拦截。
    例：API_BASE: "https://api.example.com"

  本地演示模式（上面两者都没启用时的兜底）
    数据全部落在小程序本地存储，断网也能完整演示估价、下单、订单流转、售后。
    比赛现场要一键切换买家/卖家/运营三个角色，只有这一档做得到 ——
    所以它是默认档。
*/
const API_BASE = "";

/*
  CLOUD —— 云服务开关与公开配置

  enabled 默认 false，原因很实际：云端账号走的是真实手机号验证码，
  18800000001 这类演示号在云端并不存在，现场没法用演示账号一键切角色。
  要联云就把它改成 true，然后在微信开发者工具里点一次「工具 → 构建 npm」。

  publicConfig 三个值来自开通云服务时平台返回的结果，可以直接放在前端代码里：
    resourceId      环境资源 id
    endpoint        小程序统一网关。所有小程序共用这一个固定域名 ——
                    微信的 request 合法域名不支持通配、数量还有上限，
                    所以不是「每个应用一个域名」。不要改成应用自己的域名。
    publishableKey  标识「是哪个应用」，本身不带任何权限，服务端按来源校验
*/
const CLOUD = {
  enabled: false,
  publicConfig: {
    resourceId: "wbcs_5uhQ3Y755cDX9PDx53W32f",
    endpoint: "https://mp-api.app.workbuddy.host",
    publishableKey: "wbpk_OQRg7r2G3wl37PY817EIOj_IG1RKhjJpkKnisgeokP7IdPImMDte6JX"
  }
};

/*
  MEDIA —— 图片资源托管地址

  包内 assets/img/ 下的八张商品图在云存储上有一份同名副本，路径规则与包内完全一致
  （assets/img/product-fan.jpg 对应 <base>/assets/img/product-fan.jpg），
  所以新增图片只要文件名对得上就能自动生效，不需要再维护一张映射表。

  base 指向托管站点，末尾不带斜杠。

  remote 打开后，在线档（云服务模式 / 在线模式）显示托管地址，本地演示档仍取包内副本。
  包内那八张图按 147KB 保留着，是断网时的兜底：比赛现场没有网络也要能完整演示。
  如果确认演示环境一定有网，可以删掉包内副本省下这 147KB，代价是断网时商品图全空。

  uploadDriver 决定用户拍的商品图存到哪个图床：
    auto    先试云存储，用不了就退回自带的存储，不需要任何额外配置
    builtin 固定用小程序自带的存储（对象键 + 显示前签发临时地址）
  CloudBase 这一路要生效，得先在控制台把 cloudbaseEnv 这个环境授权给小程序 appid。
*/
const MEDIA = {
  base: "https://fxjdfx-d6g4piv8n15f69b4a-1480810758.tcloudbaseapp.com/zhijiabao",
  remote: true,
  uploadDriver: "auto",
  cloudbaseEnv: "fxjdfx-d6g4piv8n15f69b4a"
};

/*
  WEATHER_DIRECT 控制是否允许小程序直连 Open-Meteo 取实时天气。
  打开的前提是把 api.open-meteo.com 加入 request 合法域名，否则请求会被微信拦截。
  比赛演示建议保持 false：拿不到天气时估价按中性因子 1.000 计算，结果照常给出。
*/
const WEATHER_DIRECT = false;

/* 主题：light 月白国风（默认） / dark 深色国风 */
const DEFAULT_THEME = "light";

/* 演示账号，登录页一键填充用 */
const DEMO_ACCOUNTS = [
  { label: "买家", nickname: "澄禾", phone: "18800000001", password: "demo1234" },
  { label: "卖家", nickname: "湖畔旧物", phone: "18800000002", password: "demo1234" },
  { label: "运营", nickname: "智价宝运营", phone: "18800000000", password: "admin888" }
];

/*
  举报理由，与 Web 版举报弹窗完全一致。
  共 7 项，超过 wx.showActionSheet 的 6 项上限，因此举报面板用页面内浮层实现，
  见 templates/report-sheet.wxml。
*/
const REPORT_REASONS = [
  "虚假宣传", "假货或仿制品", "价格欺诈", "盗图侵权", "骚扰或辱骂", "站外交易", "其他违规"
];

module.exports = { API_BASE, CLOUD, MEDIA, WEATHER_DIRECT, DEFAULT_THEME, DEMO_ACCOUNTS, REPORT_REASONS };
