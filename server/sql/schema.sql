-- =========================================================
-- 智价宝 · 景区文创闲置流转平台 —— 数据库结构（MySQL 8 / InnoDB / utf8mb4）
-- 说明：
--   1. 时间统一用 DATETIME，应用层以 'YYYY-MM-DD HH:MM:SS' 字符串写入，连接配置 dateStrings=true，避免时区换算歧义；
--   2. condition 是 MySQL 保留字，因此统一加反引号；
--   3. 金额统一为整数（元），避免浮点误差；retention 为 0~1 的保值率；
--   4. 全部使用 CREATE TABLE IF NOT EXISTS，可重复执行。
-- =========================================================

-- 用户
CREATE TABLE IF NOT EXISTS `users` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `phone`         VARCHAR(20)  NOT NULL COMMENT '手机号，登录账号',
  `password_hash` VARCHAR(200) DEFAULT NULL COMMENT 'scrypt 哈希，格式 salt:hash',
  `nickname`      VARCHAR(32)  NOT NULL DEFAULT '',
  `avatar`        VARCHAR(300) NOT NULL DEFAULT '',
  `bio`           VARCHAR(120) NOT NULL DEFAULT '' COMMENT '个人简介',
  `city`          VARCHAR(40)  NOT NULL DEFAULT '',
  `real_name`     VARCHAR(40)  NOT NULL DEFAULT '' COMMENT '实名姓名',
  `id_no_masked`  VARCHAR(40)  NOT NULL DEFAULT '' COMMENT '脱敏证件号，不存完整号码',
  `id_verified`   TINYINT(1)   NOT NULL DEFAULT 0,
  `is_admin`      TINYINT(1)   NOT NULL DEFAULT 0,
  `status`        VARCHAR(16)  NOT NULL DEFAULT 'active' COMMENT 'active / frozen / deleted',
  `credit`        INT          NOT NULL DEFAULT 70 COMMENT '信用分 0-100',
  `balance`       INT          NOT NULL DEFAULT 0 COMMENT '可提现余额（元）',
  `created_at`    DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_users_phone` (`phone`),
  KEY `idx_users_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户账号';

-- 登录会话
CREATE TABLE IF NOT EXISTS `sessions` (
  `token`      VARCHAR(64) NOT NULL,
  `user_id`    INT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL,
  `expires_at` DATETIME NOT NULL,
  PRIMARY KEY (`token`),
  KEY `idx_sessions_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='登录会话令牌';

-- 短信验证码（演示环境由接口直接回传，正式部署需接短信网关）
CREATE TABLE IF NOT EXISTS `sms_codes` (
  `phone`     VARCHAR(20) NOT NULL,
  `code`      VARCHAR(10) NOT NULL,
  `expire_at` DATETIME    NOT NULL,
  `purpose`   VARCHAR(16) NOT NULL DEFAULT 'login' COMMENT 'login / register / reset',
  PRIMARY KEY (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='短信验证码';

-- 收货地址
CREATE TABLE IF NOT EXISTS `addresses` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    INT UNSIGNED NOT NULL,
  `name`       VARCHAR(40)  NOT NULL,
  `phone`      VARCHAR(20)  NOT NULL,
  `region`     VARCHAR(60)  NOT NULL COMMENT '省市区',
  `detail`     VARCHAR(120) NOT NULL COMMENT '详细地址',
  `is_default` TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at` DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_addresses_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='收货地址（每用户上限 10 条由应用层约束）';

-- 商品（景区文创闲置）
CREATE TABLE IF NOT EXISTS `products` (
  `id`            VARCHAR(64)  NOT NULL COMMENT '商品编号，如 fan / p-xxxx',
  `owner_id`      INT UNSIGNED DEFAULT NULL COMMENT '发布者，NULL 表示平台代管',
  `name`          VARCHAR(80)  NOT NULL,
  `scenic`        VARCHAR(40)  NOT NULL COMMENT '景区来源',
  `category`      VARCHAR(32)  NOT NULL COMMENT '商品品类',
  `condition`     VARCHAR(16)  NOT NULL DEFAULT '95新' COMMENT '品相（保留字，需反引号）',
  `tag`           VARCHAR(24)  NOT NULL DEFAULT '',
  `price`         INT          NOT NULL COMMENT '期望价（元）',
  `original`      INT          NOT NULL COMMENT '购买原价（元）',
  `freight`       INT          NOT NULL DEFAULT 0 COMMENT '运费，0 表示包邮',
  `description`   VARCHAR(400) NOT NULL DEFAULT '',
  `images`        TEXT         COMMENT '图片地址 JSON 数组',
  `heat`          INT          NOT NULL DEFAULT 60 COMMENT '热度',
  `retention`     DECIMAL(4,2) NOT NULL DEFAULT 0.62 COMMENT '保值率',
  `views`         INT          NOT NULL DEFAULT 0,
  `status`        VARCHAR(16)  NOT NULL DEFAULT '待审核' COMMENT '待审核 / 在售 / 交易中 / 已售出 / 已下架',
  `reject_reason` VARCHAR(200) NOT NULL DEFAULT '',
  `seller_name`   VARCHAR(40)  NOT NULL DEFAULT '平台代管',
  `source`        VARCHAR(16)  NOT NULL DEFAULT 'seed' COMMENT 'seed / user',
  `created_at`    DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_products_scenic` (`scenic`),
  KEY `idx_products_category` (`category`),
  KEY `idx_products_status` (`status`),
  KEY `idx_products_owner` (`owner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='景区文创商品';

-- 收藏与降价提醒
CREATE TABLE IF NOT EXISTS `favorites` (
  `user_id`     INT UNSIGNED NOT NULL,
  `product_id`  VARCHAR(64)  NOT NULL,
  `price_alert` TINYINT(1)   NOT NULL DEFAULT 0,
  `alert_price` INT          DEFAULT NULL COMMENT '目标价，低于该价格时通知',
  `created_at`  DATETIME     NOT NULL,
  PRIMARY KEY (`user_id`, `product_id`),
  KEY `idx_favorites_product` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='收藏';

-- 浏览足迹
CREATE TABLE IF NOT EXISTS `footprints` (
  `user_id`    INT UNSIGNED NOT NULL,
  `product_id` VARCHAR(64)  NOT NULL,
  `viewed_at`  DATETIME     NOT NULL,
  PRIMARY KEY (`user_id`, `product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='浏览足迹';

-- 搜索历史
CREATE TABLE IF NOT EXISTS `search_history` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    INT UNSIGNED NOT NULL,
  `keyword`    VARCHAR(60)  NOT NULL,
  `created_at` DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_search_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='搜索历史';

-- 估价记录
CREATE TABLE IF NOT EXISTS `estimates` (
  `id`              VARCHAR(64)  NOT NULL,
  `user_id`         INT UNSIGNED DEFAULT NULL,
  `scenic`          VARCHAR(40)  NOT NULL,
  `original`        INT          NOT NULL,
  `condition`       VARCHAR(16)  NOT NULL,
  `note`            VARCHAR(300) NOT NULL DEFAULT '',
  `bought_at`       VARCHAR(20)  NOT NULL DEFAULT '' COMMENT '购入时间 YYYY-MM-DD',
  `has_certificate` TINYINT(1)   NOT NULL DEFAULT 0,
  `has_package`     TINYINT(1)   NOT NULL DEFAULT 0,
  `limited`         TINYINT(1)   NOT NULL DEFAULT 0,
  `flawed`          TINYINT(1)   NOT NULL DEFAULT 0,
  `result`          INT          NOT NULL COMMENT '建议成交价',
  `range_low`       INT          NOT NULL,
  `range_high`      INT          NOT NULL,
  `confidence`      INT          NOT NULL DEFAULT 80,
  `weather_json`    TEXT,
  `breakdown_json`  TEXT         COMMENT '系数分解，便于结果复核',
  `created_at`      DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_estimates_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='AI 估价记录';

-- 订单（平台担保交易）
CREATE TABLE IF NOT EXISTS `orders` (
  `id`              VARCHAR(64)  NOT NULL,
  `product_id`      VARCHAR(64)  NOT NULL,
  `product_name`    VARCHAR(80)  NOT NULL,
  `product_image`   VARCHAR(300) NOT NULL DEFAULT '',
  `scenic`          VARCHAR(40)  NOT NULL DEFAULT '',
  `buyer_id`        INT UNSIGNED NOT NULL,
  `seller_id`       INT UNSIGNED DEFAULT NULL,
  `price`           INT          NOT NULL,
  `freight`         INT          NOT NULL DEFAULT 0,
  `fee`             INT          NOT NULL DEFAULT 0 COMMENT '平台服务费（成交价 2%）',
  `address_json`    TEXT,
  `status`          VARCHAR(16)  NOT NULL DEFAULT '待付款' COMMENT '待付款/待发货/待收货/已完成/已取消/售后中/已退款',
  `timeline`        TEXT         COMMENT '状态流转时间线 JSON',
  `tracking_no`     VARCHAR(40)  NOT NULL DEFAULT '',
  `express_company` VARCHAR(40)  NOT NULL DEFAULT '',
  `cancel_reason`   VARCHAR(120) NOT NULL DEFAULT '',
  `created_at`      DATETIME     NOT NULL,
  `updated_at`      DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_orders_buyer` (`buyer_id`),
  KEY `idx_orders_seller` (`seller_id`),
  KEY `idx_orders_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='担保交易订单';

-- 评价（双向）
CREATE TABLE IF NOT EXISTS `reviews` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id`   VARCHAR(64)  DEFAULT NULL,
  `product_id` VARCHAR(64)  NOT NULL,
  `from_user`  INT UNSIGNED NOT NULL,
  `to_user`    INT UNSIGNED DEFAULT NULL,
  `role`       VARCHAR(16)  NOT NULL DEFAULT 'buyer',
  `score`      INT          NOT NULL COMMENT '1-5 星',
  `content`    VARCHAR(400) NOT NULL DEFAULT '',
  `images`     TEXT,
  `created_at` DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_reviews_product` (`product_id`),
  KEY `idx_reviews_to` (`to_user`),
  KEY `idx_reviews_order` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='交易评价，用于信用分计算';

-- 商品问答
CREATE TABLE IF NOT EXISTS `questions` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_id`  VARCHAR(64)  NOT NULL,
  `user_id`     INT UNSIGNED DEFAULT NULL,
  `asker`       VARCHAR(40)  NOT NULL DEFAULT '游客',
  `body`        VARCHAR(300) NOT NULL,
  `answer`      VARCHAR(400) NOT NULL DEFAULT '',
  `answered_at` DATETIME     DEFAULT NULL,
  `created_at`  DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_questions_product` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='商品问答';

-- 会话列表（每对用户一条，便于消息中心展示）
CREATE TABLE IF NOT EXISTS `conversations` (
  `user_id`    INT UNSIGNED NOT NULL,
  `peer_id`    INT UNSIGNED NOT NULL,
  `product_id` VARCHAR(64)  NOT NULL DEFAULT '',
  `last_body`  VARCHAR(400) NOT NULL DEFAULT '',
  `last_at`    DATETIME     NOT NULL,
  `unread`     INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (`user_id`, `peer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='站内会话';

-- 站内消息
CREATE TABLE IF NOT EXISTS `messages` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `from_user`  INT UNSIGNED NOT NULL,
  `to_user`    INT UNSIGNED NOT NULL,
  `product_id` VARCHAR(64)  NOT NULL DEFAULT '',
  `body`       VARCHAR(400) NOT NULL,
  `created_at` DATETIME     NOT NULL,
  `read_at`    DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_messages_to` (`to_user`),
  KEY `idx_messages_from` (`from_user`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='站内消息';

-- 通知
CREATE TABLE IF NOT EXISTS `notifications` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    INT UNSIGNED NOT NULL,
  `type`       VARCHAR(24)  NOT NULL DEFAULT 'system' COMMENT 'system/order/review/audit/message/wallet/question/product',
  `title`      VARCHAR(120) NOT NULL,
  `body`       VARCHAR(300) NOT NULL DEFAULT '',
  `link`       VARCHAR(200) NOT NULL DEFAULT '',
  `read_at`    DATETIME     DEFAULT NULL,
  `created_at` DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_notifications_user` (`user_id`),
  KEY `idx_notifications_read` (`user_id`, `read_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='站内通知';

-- 举报
CREATE TABLE IF NOT EXISTS `reports` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `target_type`  VARCHAR(16)  NOT NULL COMMENT 'product / user / review / question / message',
  `target_id`    VARCHAR(64)  NOT NULL,
  `target_label` VARCHAR(80)  NOT NULL DEFAULT '',
  `reason`       VARCHAR(60)  NOT NULL,
  `detail`       VARCHAR(400) NOT NULL DEFAULT '',
  `reporter_id`  INT UNSIGNED DEFAULT NULL,
  `status`       VARCHAR(16)  NOT NULL DEFAULT '待处理' COMMENT '待处理 / 已处理 / 已驳回',
  `handle_note`  VARCHAR(300) NOT NULL DEFAULT '',
  `created_at`   DATETIME     NOT NULL,
  `handled_at`   DATETIME     DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_reports_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='举报与处置记录';

-- 行为埋点（运营看板的 PV / UV / 转化率来源）
CREATE TABLE IF NOT EXISTS `events` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`    INT UNSIGNED DEFAULT NULL,
  `visitor`    VARCHAR(40)  NOT NULL DEFAULT '' COMMENT '匿名访客标识，用于 UV 去重',
  `name`       VARCHAR(40)  NOT NULL COMMENT 'page_view / product_view / estimate / order_create ...',
  `payload`    TEXT,
  `created_at` DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_events_name` (`name`),
  KEY `idx_events_time` (`created_at`),
  KEY `idx_events_visitor` (`visitor`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='行为埋点';

-- 审计日志（后台敏感操作）
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `actor_id`   INT UNSIGNED DEFAULT NULL,
  `action`     VARCHAR(48)  NOT NULL,
  `target`     VARCHAR(80)  NOT NULL DEFAULT '',
  `detail`     VARCHAR(300) NOT NULL DEFAULT '',
  `created_at` DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_audit_actor` (`actor_id`),
  KEY `idx_audit_time` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='审计日志';
