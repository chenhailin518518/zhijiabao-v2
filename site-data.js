/*
  智价宝 - 站点共享字典
  8 个景区（含文化资料与坐标）、10 个商品品类、品相等级、比价平台、种子商品。
  前端渲染、离线模式、后端种子数据都以本文件为唯一来源，避免多处硬编码不一致。
*/
(function (root) {
  "use strict";

  /* 8 个景区：坐标用于实时天气，culture 字段用于填补“只有名字没有文化内容”的空缺 */
  const SCENICS = [
    {
      id: "故宫博物院", city: "北京", lat: 39.9163, lon: 116.3972,
      heat: 95, bonus: 1.12, retention: 0.78, level: "世界文化遗产",
      intro: "明清两代皇宫，现存规模最大的木结构古建筑群，文创以宫廷纹样、瑞兽、书画为核心母题。",
      story: "文创灵感多取自《千里江山图》《胤禛行乐图》与太和殿瑞兽，属“把文物带回家”的典型路径。",
      craft: "宫廷纹样丝织、景泰蓝、掐丝珐琅、宣纸书画衍生",
      tip: "认准故宫文创官方授权标识；联名款与生肖限定款保值率最高。"
    },
    {
      id: "杭州西湖", city: "杭州", lat: 30.2416, lon: 120.1551,
      heat: 82, bonus: 1.04, retention: 0.62, level: "世界文化景观遗产",
      intro: "以“三面云山一面城”的湖山格局闻名，文创常见荷、柳、桥、绢伞等江南意象。",
      story: "西湖十景与白蛇传说提供了稳定的叙事母题，荷影、断桥、雷峰塔题材复购率最高。",
      craft: "王星记扇、西湖绸伞、青瓷、龙井茶衍生器皿",
      tip: "绸伞与折扇注意检查伞骨、扇骨是否变形，这类损耗最影响转手价格。"
    },
    {
      id: "敦煌莫高窟", city: "敦煌", lat: 40.0370, lon: 94.8092,
      heat: 76, bonus: 1.02, retention: 0.70, level: "世界文化遗产",
      intro: "集壁画、彩塑、建筑于一体的石窟艺术宝库，飞天、藻井、九色鹿是最常用的文创符号。",
      story: "敦煌色系（土红、石青、石绿、铅白）与飞天飘带构成高辨识度的视觉资产，金属与丝织品类最畅销。",
      craft: "矿物颜料复刻、壁画临摹、飞天丝巾、藻井书签",
      tip: "壁画题材商品建议保留原包装与说明卡，凭证齐全的藏品溢价明显。"
    },
    {
      id: "黄山风景区", city: "黄山", lat: 30.1333, lon: 118.1667,
      heat: 70, bonus: 0.98, retention: 0.65, level: "世界文化与自然双遗产",
      intro: "以奇松、怪石、云海、温泉“四绝”著称，迎客松是核心视觉符号。",
      story: "山岳题材文创以小件、轻量、易携带为特征，徽章与冰箱贴是游客离园后的主要流转品类。",
      craft: "徽墨歙砚、竹雕、松烟墨、山岳铜章",
      tip: "金属徽章注意背面划痕，属于最常见的品相扣分项。"
    },
    {
      id: "平遥古城", city: "晋中", lat: 37.1897, lon: 112.1764,
      heat: 64, bonus: 0.95, retention: 0.66, level: "世界文化遗产",
      intro: "保存完整的明清县城，票号文化与晋商遗风是文创的主要来源。",
      story: "日昇昌票号、镖局、城隍庙题材构成晋商叙事线，刺绣香囊与布艺最贴合古城气质。",
      craft: "晋绣、推光漆器、平遥牛肉、布艺香囊",
      tip: "香囊类注意香料是否挥发，气味流失会明显影响二手成交价。"
    },
    {
      id: "武夷山", city: "南平", lat: 27.7500, lon: 117.9500,
      heat: 58, bonus: 0.92, retention: 0.60, level: "世界文化与自然双遗产",
      intro: "丹霞地貌与岩茶产区叠加，茶文化是其文创的核心资产。",
      story: "大红袍母树故事与“岩骨花香”的味觉记忆，让茶器、茶罐类文创具备跨季节消费属性。",
      craft: "建盏、岩茶、竹编、茶器礼盒",
      tip: "茶类纪念品务必说明罐内是否含茶，食品类无法二次流通。"
    },
    {
      id: "大雁塔", city: "西安", lat: 34.2247, lon: 108.9628,
      heat: 72, bonus: 1.00, retention: 0.67, level: "世界文化遗产",
      intro: "唐代大慈恩寺塔，玄奘译经与丝路起点是其叙事母题。",
      story: "唐风、丝路、祈福三条线并行，铜铃、拓片、唐装书签是热门品类。",
      craft: "唐三彩、拓片、铜铃、唐风织物",
      tip: "铜器类注意氧化与铜绿，可用软布擦拭后再拍照上架。"
    },
    {
      id: "丽江古城", city: "丽江", lat: 26.8721, lon: 100.2296,
      heat: 68, bonus: 0.97, retention: 0.58, level: "世界文化遗产",
      intro: "纳西族聚居的高原古城，东巴文字与木府文化构成独特符号系统。",
      story: "东巴象形文字、丽江手绘、马帮文化提供差异化题材，明信片与手绘类更适合轻量流转。",
      craft: "东巴纸、纳西绣、木雕、手绘明信片",
      tip: "纸质品注意防潮与折痕，建议用硬质信封寄送。"
    }
  ];

  const CATEGORIES = [
    "纪念徽章", "书签", "明信片", "扇子", "杯子茶具",
    "非遗手作", "摆件", "茶叶食品", "服饰配件", "其他"
  ];

  const CONDITIONS = [
    { value: "全新", factor: 0.82, desc: "未拆封或仅拆封未使用" },
    { value: "95新", factor: 0.72, desc: "使用痕迹极轻，配件齐全" },
    { value: "9成新", factor: 0.62, desc: "有轻微使用痕迹，不影响使用" },
    { value: "8成新", factor: 0.48, desc: "明显使用痕迹或瑕疵" }
  ];

  const TAGS = ["个人闲置", "限定联名", "商户尾货", "非遗手作", "轻收藏", "实用文创", "清仓捡漏", "祈福纪念"];

  /* 比价平台：只做关键词跳转，不抓取第三方页面，避免数据来源争议 */
  const PLATFORMS = [
    { id: "official", label: "景区官方商城", note: "官方指导价，正品但价格最高" },
    { id: "mall", label: "综合电商在售价", note: "含第三方店铺，注意辨别授权" },
    { id: "secondhand", label: "二手平台成交价", note: "同款二手实际成交区间" },
    { id: "platform", label: "智价宝建议价", note: "本平台算法给出的建议挂牌价" }
  ];

  /* 种子商品（与后端 server/db.mjs 的种子保持一致，离线演示模式使用） */
  const SEED_PRODUCTS = [
    { id: "fan", name: "故宫云纹折扇", scenic: "故宫博物院", category: "扇子", condition: "95新", tag: "限定联名", price: 135, original: 168, freight: 0, heat: 92, retention: 0.72, views: 396, sellerName: "澄禾", image: "assets/img/product-fan.webp", description: "宫廷云纹扇面，适合收藏和夏季旅拍，近三日热度上升 18%。" },
    { id: "cup", name: "西湖荷影陶瓷杯", scenic: "杭州西湖", category: "杯子茶具", condition: "9成新", tag: "实用文创", price: 76, original: 128, freight: 8, heat: 78, retention: 0.58, views: 354, sellerName: "湖畔旧物", image: "assets/img/product-cup.webp", description: "青釉杯身与荷影纹样，适合作为伴手礼，二手成交速度较快。" },
    { id: "bookmark", name: "敦煌飞天金属书签", scenic: "敦煌莫高窟", category: "书签", condition: "全新", tag: "商户尾货", price: 44, original: 69, freight: 6, heat: 65, retention: 0.62, views: 315, sellerName: "鸣沙商铺", image: "assets/img/product-bookmark.webp", description: "轻薄金属材质，适合批量清仓，平台建议活动价 39-45 元。" },
    { id: "pin", name: "黄山迎客松徽章", scenic: "黄山风景区", category: "纪念徽章", condition: "95新", tag: "轻收藏", price: 29, original: 45, freight: 5, heat: 71, retention: 0.64, views: 333, sellerName: "山行者", image: "assets/img/product-pin.webp", description: "小件高频交易商品，适合作为游客离园后的二次流转入口。" },
    { id: "tea", name: "武夷山岩茶纪念罐", scenic: "武夷山", category: "茶叶食品", condition: "8成新", tag: "礼盒周边", price: 119, original: 198, freight: 12, heat: 58, retention: 0.60, views: 294, sellerName: "岩骨花香", image: "assets/img/product-tea.webp", description: "茶罐包装完整但有轻微磨痕，适合展示收藏和低价捡漏。" },
    { id: "sachet", name: "平遥古城香囊", scenic: "平遥古城", category: "非遗手作", condition: "全新", tag: "非遗手作", price: 38, original: 59, freight: 6, heat: 69, retention: 0.66, views: 327, sellerName: "古城手作", image: "assets/img/product-sachet.webp", description: "刺绣纹样保存良好，适合节庆活动和校园文创交换场。" },
    { id: "bell", name: "大雁塔祈福铜铃", scenic: "大雁塔", category: "摆件", condition: "9成新", tag: "祈福纪念", price: 72, original: 108, freight: 8, heat: 74, retention: 0.67, views: 342, sellerName: "长安慢递", image: "assets/img/product-bell.webp", description: "铜色光泽自然，平台相似商品近期成交价集中在 68-79 元。" },
    { id: "postcard", name: "丽江古城手绘明信片", scenic: "丽江古城", category: "明信片", condition: "全新", tag: "清仓组合", price: 24, original: 35, freight: 4, heat: 62, retention: 0.55, views: 306, sellerName: "木府文创", image: "assets/img/product-postcard.webp", description: "套装余量较多，适合商户清仓和游客拼单购买。" }
  ];

  const platformSearchUrl = (id, keyword) => {
    const key = encodeURIComponent(keyword || "景区文创");
    if (id === "official") return `https://www.baidu.com/s?wd=${key}%20%E5%AE%98%E6%96%B9%E5%95%86%E5%9F%8E`;
    if (id === "mall") return `https://s.taobao.com/search?q=${key}`;
    if (id === "secondhand") return `https://www.goofish.com/search?q=${key}`;
    return "";
  };

  root.ZhijiabaoData = {
    SCENICS,
    CATEGORIES,
    CONDITIONS,
    TAGS,
    PLATFORMS,
    SEED_PRODUCTS,
    scenic: (id) => SCENICS.find((s) => s.id === id) || null,
    /* 兼容历史数据里出现的旧景区名（例如“莫高窟”“丽江古城”简写） */
    matchScenic: (name) => {
      if (!name) return null;
      const raw = String(name).trim();
      const exact = SCENICS.find((s) => s.id === raw);
      if (exact) return exact;
      return SCENICS.find((s) => s.id.includes(raw) || raw.includes(s.id.replace(/[市省]/g, ""))) || null;
    },
    platformSearchUrl,
    version: "2.0.0"
  };
})(typeof window !== "undefined" ? window : globalThis);
