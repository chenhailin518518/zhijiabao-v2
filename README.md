# 智价宝 · 景区文创闲置流转平台

面向景区文创的闲置流转平台：上传图片即可获得**可解释的 AI 估价**，查到官方价与二手成交参考价，并通过**平台担保交易**把闲置文创流转给下一位旅行者。覆盖 8 个景区、10 类文创商品。

- 在线演示（纯静态，自动降级为本地演示模式）：<https://chenhailin518518.github.io/zhijiabao-v2/>
- 技术形态：原生 JavaScript + Node 零依赖后端（`node:http` + `node:sqlite`）+ SQLite
- 参赛方向：全国大学生数字媒体科技作品及创意竞赛 · 移动与网络应用开发类

---

## 一、快速开始

### 1. 完整模式（推荐：前后端一起跑）

```bash
# 需要 Node >= 22（Node 内置 node:sqlite，无需安装任何运行时依赖）
npm start
```

打开 <http://localhost:8080>。该命令同时承担静态站点托管与 REST API：

| 地址 | 说明 |
| --- | --- |
| <http://localhost:8080/> | 站点首页 |
| <http://localhost:8080/api/health> | 接口自检（返回景区与品类字典） |
| <http://localhost:8080/admin/> | 运营后台 |

首次启动会自动建库并写入种子数据（8 件商品、3 个演示账号）。重置数据：`npm run reset:data`。

### 2. 纯静态模式

直接把仓库丢到任意静态托管（GitHub Pages / Nginx / Nginx 容器）即可。前端会探测 `/api/health`：

- 探测成功 → **在线模式**，数据落 SQLite，多设备共享；
- 探测失败 → **本地演示模式**，自动降级为浏览器 `localStorage`，功能语义保持一致，页脚会明确提示"数据仅存本机"。

### 3. 演示账号

| 角色 | 手机号 | 密码 |
| --- | --- | --- |
| 管理员 | 18800000000 | admin888 |
| 普通用户（卖家） | 18800000001 | demo1234 |
| 普通用户（买家） | 18800000002 | demo1234 |

也支持手机号 + 验证码登录：演示环境由接口直接回传验证码，正式部署需接入短信网关。

---

## 二、功能模块

| 页面 | 能力 |
| --- | --- |
| 首页 `index.html` | 平台实时数据看板（来自服务端聚合接口）、四大功能入口、品类导航、热门文创、担保交易流程、8 个景区的文化资料墙、合规与数据来源说明 |
| AI 估价 `estimate.html` | 景区 / 品类 / 品相 / 原价 / 购入时间 / 凭证包装等结构化输入，7 项系数逐项可复核，输出建议价、区间、保值率、一年后预估与置信度；支持导出估价报告图片、系统分享、**一键转发布** |
| 全网比价 `compare.html` | 官方指导价、二手成交参考价、平台建议价三价同屏；近 30 天价格走势（Canvas 绘制，标注为演示数据）；按景区 / 品类 / 价格区间 / 关键词筛选；跳转电商与二手平台检索同款 |
| 二手集市 `market.html` | 多图发布（前端压缩）、景区 / 品类 / 标签 / 关键词筛选与排序、分区（个人闲置 / 商户尾货）、商品问答、收藏与降价提醒、我的发布管理（编辑 / 下架 / 重新上架 / 删除）、8 景区实时天气 |
| 我的订单 `orders.html` | 担保交易状态机：待付款 → 待发货 → 待收货 → 已完成；填写物流、确认收货放款、取消订单、申请售后、卖家同意退款、双向评价 |
| 消息中心 `messages.html` | 买卖双方站内沟通（议价、品相确认），系统通知；站外交易话术会被拦截 |
| 个人中心 `profile.html` | 注册 / 登录 / 找回密码、资料编辑、实名认证（仅存脱敏号码）、收货地址（上限 10 条）、收藏与降价提醒、浏览足迹、搜索历史、估价记录、我的发布、通知中心、余额提现、注销账号 |
| 运营后台 `admin.html` | 数据看板（PV / UV / GMV / 转化率 / 景区与品类分布 / 埋点 TOP）、商品审核（驳回需填原因）、举报处理、用户管理（冻结 / 恢复）、审计日志 |
| 用户协议与隐私说明 `legal.html` | 服务性质、账号与实名、个人信息收集与使用、内容安全与交易规则、数据来源与素材版权、AI 工具使用说明、免责声明 |
| `404.html` | 品牌化错误页（GitHub Pages 项目站点下自动修正路径前缀） |

---

## 三、架构

```
浏览器
├── site-data.js      共享字典：8 景区（含文化资料与坐标）、10 品类、品相、标签、比价平台、种子商品
├── pricing.js        纯计算：估价模型、订单状态机、信用分、价格走势、发布表单校验（浏览器与 Node 共用）
├── api-services.js   外部接口：Open-Meteo 天气 / 地理编码 / 二维码，带缓存与降级
├── store.js          数据层：探测后端 → 在线走 REST，离线降级为 localStorage，页面只用一套调用方式
├── script.js         通用 UI：主题、粒子、光标辉光、页面过渡、Toast、弹窗基座、无障碍、懒加载
├── app-core.js       业务层（一）：通用组件、图表、图片压缩上传、登录注册、商品卡片与详情、首页 / 估价 / 比价
├── app-account.js    业务层（二）：集市、个人中心、订单、消息、运营后台、启动引导
└── styles.css + styles-app.css   基础样式与业务组件样式（支持深色国风主题）

服务端（零依赖）
├── server/server.mjs  静态托管 + 全部 REST 接口 + 图片上传（含权限、限流、敏感词、状态机校验）
└── server/db.mjs      node:sqlite 建表、种子数据、密码哈希（scrypt）、信用分与审计日志
```

**为什么这样分层**：业务规则（估价、状态机、信用分、校验）只写在 `pricing.js` 与 `server/` 各一份，前者被浏览器与单元测试共用，后者被接口与集成测试共用，避免"页面一套、服务端一套"的漂移。

### 数据表

`users` `sessions` `sms_codes` `addresses` `products` `favorites` `footprints` `search_history` `estimates` `orders` `reviews` `questions` `conversations` `messages` `notifications` `reports` `events`（埋点） `audit_logs`

---

## 四、AI 估价模型

建议价 = 原价 × 品相系数 × 景区保值系数 × 季节系数 × 品相凭证加成 × 关键词修正 × 供需指数

| 维度 | 取值 | 说明 |
| --- | --- | --- |
| 品相系数 | 全新 0.82 / 95新 0.72 / 9成新 0.62 / 8成新 0.48 | 用户在表单选择 |
| 景区保值系数 | 0.92 ~ 1.12 | 8 个景区各自的保值与热度权重 |
| 季节系数 | 暑假 1.12 / 春游 1.08 / 秋游 1.05 / 淡季 0.92 | 按当前月份自动取值 |
| 凭证与包装加成 | 限定 +8% / 凭证 +4% / 原包装 +3% / 瑕痕 −5% / 购入 1 年内 +2% / 5 年以上 +3% | **结构化开关**，不再靠正则猜测 |
| 关键词修正 | 停售停产 +3% / 包装完整 +2% / 限定绝版 +5% / 瑕疵划痕 −4% | 仅作为结构化字段之外的补充信号 |
| 供需指数 | (0.85 + 景区热度 ÷ 100 × 0.3) × 天气因子 | 热度为内置权重 |
| 天气因子 | 0.84 ~ 1.03 | 取景区实时天气（Open-Meteo），失败时按 1.000 中性处理 |

同时输出合理区间（−12% ~ +15%）、保值率、一年后预估价值与置信度（由字段完整度与天气数据质量决定），成交价下限 18 元。

> 模型说明：这是**可解释的规则模型**，不含机器学习训练过程，模型公式与每一项取值都在估价结果页公开，便于复核与答辩。图片仅作为商品实拍图保存与展示，不参与猜价（避免"看图乱估价"）。

---

## 五、外部接口与数据来源

| 接口 | 用途 | 备注 |
| --- | --- | --- |
| Open-Meteo Forecast API | 8 个景区实时温度、体感、湿度、风速、天气代码、降水概率 | 免费无 Key，15 分钟缓存，失败降级 |
| Open-Meteo Geocoding API | 地名转经纬度 | 免费无 Key，24 小时缓存 |
| api.qrserver.com | 二维码分享 | 可选能力，非核心链路 |

请求统一经过 `safeFetch()`（8 秒超时 + `AbortController`），缓存写入 `localStorage`，键名前缀 `zhijiabao-api-cache-`。

| 数据 | 性质 |
| --- | --- |
| 景区介绍、非遗工艺、鉴别提示 | 团队整理 |
| 商品、价格、成交记录 | 演示数据，接口中标注 `simulated: true` |
| 第三方平台 | **仅做关键词检索跳转，不抓取、不缓存**，避免数据来源争议 |

---

## 六、工程实践

```bash
npm test              # 四类测试全跑
npm run test:unit     # 纯逻辑单元测试（估价 / 状态机 / 信用分 / 走势 / 校验）
npm run test:smoke    # 静态资源、版本一致性、镜像页同步、SEO/无障碍/合规文件、图片体积上限
npm run test:api      # 启动临时后端跑通注册→发布→审核→下单→付款→发货→收货→评价→售后
npm run test:dom      # jsdom 真实执行 10 个页面，校验渲染与本地交易闭环

npm run mirror        # 由根目录 *.html 生成 <name>/index.html 镜像页
npm run optimize:images   # PNG → WebP（需要 Python 3 + Pillow）
npm run reset:data    # 重置本地数据库与上传目录
```

### 镜像页为什么用工具生成

首页之外每个页面都同时支持 `/estimate` 与 `/estimate.html`。历史做法是手工维护两份 HTML，曾出现"连续 8 次提交只改了外壳页面"导致子目录页面功能失效的事故。现在只维护根目录的外壳页面，`<name>/index.html` 由 `tools/sync-mirrors.mjs` 生成，CI 会校验两者是否同步。

### 安全与治理

- 密码使用 `scrypt` 加盐哈希；会话令牌为 24 字节随机串，7 天过期
- 接口鉴权基于 `Bearer` 令牌，后台接口全部要求 `is_admin`，越权与非法状态流转会被拒绝并写入审计日志
- 商品 / 评价 / 提问 / 站内消息统一敏感词过滤；举报由后台处置并通知双方
- 实名认证仅保存脱敏证件号；上传图片限 3MB 且仅接受 PNG / JPEG / WebP
- 关键接口带限流（发码、发布、估价、上传、消息、举报）
- 前端对用户输入统一 `escapeHtml`，服务端二次校验，避免 XSS 与越权

### 性能与可用性

- 图片全部 WebP 化：商品图约 450–560KB → 45–80KB，首页背景 1.4MB → 20KB（合计 6.8MB → 约 0.5MB）
- Service Worker：HTML 网络优先、静态资源缓存优先，弱网与离线可打开
- 支持 `prefers-reduced-motion`、跳转主内容链接、`aria-live` 提示、键盘与焦点管理

---

## 七、目录结构

```
.
├── index.html / estimate.html / compare.html / market.html
├── orders.html / messages.html / profile.html / admin.html / legal.html
├── 404.html
├── <name>/index.html            镜像页（由 npm run mirror 生成）
├── site-data.js / pricing.js / api-services.js / store.js
├── script.js / app-core.js / app-account.js
├── styles.css / styles-app.css
├── assets/img/                  favicon、hero-bg.webp/jpg、8 张商品图（WebP）
├── server/                      server.mjs（接口与静态托管）、db.mjs（建表与种子）
├── tests/                       unit.mjs / smoke.mjs / api.mjs / dom.mjs
├── tools/                       sync-mirrors.mjs / optimize-images.py / reset-data.mjs
├── .github/workflows/ci.yml     CI：Node 22 与 24 双版本跑全部测试
├── manifest.webmanifest / sw.js / robots.txt / sitemap.xml
└── package.json / LICENSE / README.md / README.en.md
```

---

## 八、说明

- 本站为竞赛演示项目，演示环境的支付为模拟支付，不产生真实资金往来。
- 估价结果、价格走势与商品信息为演示数据，不构成真实交易依据。
- 第三方接口与素材来源已在 `legal.html` 与本文档中标注；代码以 MIT 协议开源。

## 许可

MIT © 智价宝项目组
