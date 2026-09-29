-- =========================================================
-- 智价宝 —— 初始演示数据（MySQL 8）
-- 内容：3 个演示账号 + 8 件景区文创商品 + 历史评价 + 商品问答
-- 特点：全部使用 INSERT IGNORE，可重复执行；密码为 scrypt 哈希（格式 salt:hash，与服务端一致）
-- 演示账号：18800000000 / admin888（管理员）
--          18800000001 / demo1234（卖家「澄禾」）
--          18800000002 / demo1234（买家/卖家「湖畔旧物」）
-- 说明：更丰富的演示数据（订单、埋点、评价、售后等）可用 npm run seed:demo 通过真实接口生成。
-- =========================================================

-- 用户
INSERT IGNORE INTO `users`
  (`id`, `phone`, `password_hash`, `nickname`, `avatar`, `bio`, `city`, `real_name`, `id_no_masked`,
   `id_verified`, `is_admin`, `status`, `credit`, `balance`, `created_at`)
VALUES
  (1, '18800000000',
   'zjbadmin000000000000000000000001:ac4ae484fcfed909e8546d0a1e32dc44fa224e1410600211ac3aaf8e50f5af79e7206ad1f38c687f0c85181eb21bdbd51b8d9e11032a839886fe7d8e266d25f8',
   '智价宝运营', '', '平台运营与内容审核账号', '上海', '', '', 0, 1, 'active', 96, 0, NOW()),
  (2, '18800000001',
   'zjbuser1000000000000000000000001:b1856e60fd49da2067104a571a958bbbade0bd51ac66b8a4be3276432063dd0a6d9a89d47ab2af60e7272883f61ab935c0c556f5ab9703b0455c9847e934f5e7',
   '澄禾', '', '故宫文创收藏爱好者', '北京', '', '', 0, 0, 'active', 88, 0, NOW()),
  (3, '18800000002',
   'zjbuser2000000000000000000000002:062a6ab3500f15884221dd46243c1c17d7039848b6e75306bf4851040b9a55bcbc22aabf2bb10b15edd3d0bea6c327e47edc6f6c34a9903a019ca96ec9a22aac',
   '湖畔旧物', '', '杭州景区文创尾货卖家', '杭州', '', '', 0, 0, 'active', 84, 0, NOW());

-- 商品：8 个景区各一件，覆盖 8 类品类
INSERT IGNORE INTO `products`
  (`id`, `owner_id`, `name`, `scenic`, `category`, `condition`, `tag`, `price`, `original`, `freight`,
   `description`, `images`, `heat`, `retention`, `views`, `status`, `seller_name`, `source`, `created_at`)
VALUES
  ('fan', 2, '故宫云纹折扇', '故宫博物院', '扇子', '95新', '限定联名', 135, 168, 0,
   '宫廷云纹扇面，适合收藏和夏季旅拍，近三日热度上升 18%。', '["assets/img/product-fan.webp"]', 92, 0.72, 396, '在售', '澄禾', 'seed', NOW()),
  ('cup', 3, '西湖荷影陶瓷杯', '杭州西湖', '杯子茶具', '9成新', '实用文创', 76, 128, 8,
   '青釉杯身与荷影纹样，适合作为伴手礼，二手成交速度较快。', '["assets/img/product-cup.webp"]', 78, 0.58, 354, '在售', '湖畔旧物', 'seed', NOW()),
  ('bookmark', NULL, '敦煌飞天金属书签', '敦煌莫高窟', '书签', '全新', '商户尾货', 44, 69, 6,
   '轻薄金属材质，适合批量清仓，平台建议活动价 39-45 元。', '["assets/img/product-bookmark.webp"]', 65, 0.62, 315, '在售', '鸣沙商铺', 'seed', NOW()),
  ('pin', NULL, '黄山迎客松徽章', '黄山风景区', '纪念徽章', '95新', '轻收藏', 29, 45, 5,
   '小件高频交易商品，适合作为游客离园后的二次流转入口。', '["assets/img/product-pin.webp"]', 71, 0.64, 333, '在售', '山行者', 'seed', NOW()),
  ('tea', NULL, '武夷山岩茶纪念罐', '武夷山', '茶叶食品', '8成新', '礼盒周边', 119, 198, 12,
   '茶罐包装完整但有轻微磨痕，适合展示收藏和低价捡漏。', '["assets/img/product-tea.webp"]', 58, 0.60, 294, '在售', '岩骨花香', 'seed', NOW()),
  ('sachet', NULL, '平遥古城香囊', '平遥古城', '非遗手作', '全新', '非遗手作', 38, 59, 6,
   '刺绣纹样保存良好，适合节庆活动和校园文创交换场。', '["assets/img/product-sachet.webp"]', 69, 0.66, 327, '在售', '古城手作', 'seed', NOW()),
  ('bell', NULL, '大雁塔祈福铜铃', '大雁塔', '摆件', '9成新', '祈福纪念', 72, 108, 8,
   '铜色光泽自然，平台相似商品近期成交价集中在 68-79 元。', '["assets/img/product-bell.webp"]', 74, 0.67, 342, '在售', '长安慢递', 'seed', NOW()),
  ('postcard', NULL, '丽江古城手绘明信片', '丽江古城', '明信片', '全新', '清仓组合', 24, 35, 4,
   '套装余量较多，适合商户清仓和游客拼单购买。', '["assets/img/product-postcard.webp"]', 62, 0.55, 306, '在售', '木府文创', 'seed', NOW());

-- 历史评价（用于商品评分与卖家信用分展示）
INSERT IGNORE INTO `reviews`
  (`id`, `order_id`, `product_id`, `from_user`, `to_user`, `role`, `score`, `content`, `images`, `created_at`)
VALUES
  (1, NULL, 'fan', 2, 2, 'buyer', 5, '扇面完好，包装也很仔细，和景区买的一模一样。', '[]', NOW()),
  (2, NULL, 'fan', 2, 2, 'buyer', 4, '折扇做工不错，扇骨有点紧，整体满意。', '[]', NOW()),
  (3, NULL, 'cup', 3, 3, 'buyer', 5, '杯身没有磕碰，比景区便宜一半。', '[]', NOW()),
  (4, NULL, 'pin', 1, NULL, 'buyer', 4, '徽章背面有轻微划痕，卖家提前说明了，可以接受。', '[]', NOW()),
  (5, NULL, 'bookmark', 1, NULL, 'buyer', 5, '书签很精致，适合送人。', '[]', NOW());

-- 商品问答
INSERT IGNORE INTO `questions`
  (`id`, `product_id`, `user_id`, `asker`, `body`, `answer`, `answered_at`, `created_at`)
VALUES
  (1, 'fan', 1, '游客小林', '扇子有原来的包装盒吗？想送人。', '有原装锦盒，盒子边角有一道压痕，发货时会加固。', NOW(), NOW()),
  (2, 'cup', 1, '文创爱好者', '杯子能装热水吗？容量多少？', '陶瓷杯可装热水，容量约 350ml，建议不要微波。', NOW(), NOW()),
  (3, 'tea', 1, '茶友阿成', '茶罐里还有茶吗？', '罐内茶叶已用完，售卖的是纪念罐本身。', NOW(), NOW());
