/*
  智价宝小程序 · 图片处理

  两条路径：
    在线模式（API_BASE 已配置）——压到长边 UPLOAD.maxEdge 后走 wx.uploadFile 上传，拿服务端 URL
    本地演示模式 —— 直接 wx.getFileSystemManager().saveFile 落盘到小程序本地文件系统，
                     返回 wxfile:// 永久路径，重启后依然能显示

  为什么本地模式不直接存 tempFilePath：临时文件在小程序退出后会被清理，
  商品图会变成空白；也不把 base64 塞进本地存储，图稍大就会撞到 10MB 的存储上限。
*/
const D = require("./data.js");
const { API_BASE } = require("./config.js");
const Cloud = require("./cloud.js");
const CloudMedia = require("./cloud-media.js");
const MediaCloud = require("./media-cloud.js");

/*
  把 wx 隐私接口的失败回调翻成「能照着做」的中文。

  为什么必须有这一步：wx 的 fail 回调给的是普通对象 {errMsg, errno}，不是 Error。
  以前直接 fail: reject 把它抛出去，上层 catch 到的 e.message 是 undefined，
  于是「选图失败」在页面上表现为毫无反应 —— 点了没动静，也看不到原因。

  错误码和文案出处：小程序隐私协议开发指南「五、常见错误说明」。
*/
function toError(err) {
  const raw = (err && err.errMsg) || "";
  const errno = err && err.errno;
  const e = new Error();

  /* 用户自己点了取消，不是错误，页面不该弹提示 */
  if (/cancel/i.test(raw)) {
    e.cancelled = true;
    e.message = "";
    return e;
  }

  /* 112：后台《用户隐私保护指引》没有声明这个隐私类型，接口被平台直接禁用 */
  if (errno === 112 || /api scope is not declared/i.test(raw)) {
    e.message = "尚未声明「收集您选中的照片或视频信息」";
    e.hint =
      "微信平台拦截了本次调用（错误码 112）。\n\n" +
      "在小程序后台声明「收集您选中的照片或视频信息」后即可恢复。声明提交后约 5 分钟生效。\n\n" +
      "入口按小程序状态选用：\n" +
      "已发布上线的：左下角头像 → 账号设置 → 服务内容声明 → 用户隐私保护指引 → 去完善。\n" +
      "尚未发布的：管理 → 版本管理 → 提交代码审核，在提审页面底部的「用户隐私保护指引设置」中" +
      "选择「采集用户隐私」并填写。\n\n" +
      "未发布的小程序没有现网版本，第一个入口不会显示、或配置后也不生效。";
    return e;
  }

  /* 提审时勾了「未采集隐私」或漏声明协议，平台会回收隐私接口权限 */
  if (/appid privacy api banned/i.test(raw)) {
    e.message = "隐私接口调用权限已被微信平台回收";
    e.hint =
      "提审时勾选「未采集隐私」，或未声明《用户隐私保护指引》，均会导致该结果。\n\n" +
      "补完隐私指引后重新提审即可恢复。";
    return e;
  }

  /* 103 / 104：用户把官方隐私弹窗点掉了 */
  if (errno === 103 || errno === 104 || /privacy/i.test(raw)) {
    e.message = "需先同意隐私协议后方可选择图片";
    e.hint = "请再次点击选图，并在弹出的隐私提示中选择「同意」即可继续。";
    return e;
  }

  e.message = raw || "图片选择失败";
  return e;
}

function compress(src, quality = 82) {
  return new Promise((resolve) => {
    wx.compressImage({
      src,
      quality,
      success: (res) => resolve(res.tempFilePath),
      /* 压缩失败就用原图，不阻断流程 */
      fail: () => resolve(src)
    });
  });
}

function saveLocal(tempFilePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().saveFile({
      tempFilePath,
      success: (res) => resolve(res.savedFilePath),
      fail: (err) => reject(new Error((err && err.errMsg) || "图片保存失败"))
    });
  });
}

function uploadToServer(filePath) {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${API_BASE}/api/uploads`,
      filePath,
      name: "file",
      timeout: 20000,
      success: (res) => {
        let data = res.data;
        if (typeof data === "string") {
          try { data = JSON.parse(data); } catch (e) { return reject(new Error("上传服务返回内容格式异常，请稍后重试")); }
        }
        if (res.statusCode >= 300 || (data && data.ok === false)) {
          return reject(new Error((data && data.message) || `图片上传失败（错误码 ${res.statusCode}），请稍后重试`));
        }
        resolve(data.url);
      },
      fail: (err) => reject(new Error((err && err.errMsg) || "上传失败"))
    });
  });
}

/* =========================
   云服务模式的图片
   =========================
   选图那一步走的还是本地落盘（saveLocal），和演示模式完全一样。
   这样挑完图立刻就能在页面上看见 —— 上传是网络动作，放在选图里会让
   发布页出现几秒白框，现场演示很难看。

   真正上传发生在写入云端的那一刻（utils/cloud-api.js 调 toCloud），
   数据库里存下来的是对象键，不是本机的 wxfile:// 路径 ——
   本机路径只在这台手机上有效，换台手机就是白图。
*/
function readFileBuffer(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      success: (res) => resolve(res.data),
      fail: (err) => reject(new Error((err && err.errMsg) || "读取图片失败"))
    });
  });
}

function extOf(filePath) {
  const m = /\.([A-Za-z0-9]{2,5})$/.exec(String(filePath || ""));
  const ext = m ? m[1].toLowerCase() : "jpg";
  return /^(jpe?g|png|gif|webp|bmp)$/.test(ext) ? (ext === "jpeg" ? "jpg" : ext) : "jpg";
}

/* 小程序里没有 file.type，存储层拿不到类型，必须显式给 */
function mimeOf(ext) {
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "bmp") return "image/bmp";
  return "image/jpeg";
}

async function uploadToCloud(filePath) {
  const cloud = Cloud.getCloud();
  if (!cloud) throw new Error(Cloud.cloudError() || "云服务不可用");

  const res = await cloud.auth.getSession();
  const session = res && res.data;
  if (!session || !session.user) throw new Error("请先登录再上传图片");

  const ext = extOf(filePath);

  /*
    先试外部图床（腾讯云 CloudBase 云存储）。
    成的图直接返回可显示的地址，不必再签发临时链接；不成返回空串，往下走自带存储。
    见 utils/media-cloud.js。
  */
  const hosted = await MediaCloud.upload(filePath, { uid: String(session.user.id), ext });
  if (hosted) return hosted;

  /* 存储层要走 ArrayBuffer：小程序的 wx.request 不支持直接发本地临时文件路径 */
  const buffer = await readFileBuffer(filePath);
  const key = cloud.storage.userPath(
    String(session.user.id),
    `products/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.${ext}`
  );

  const up = await cloud.storage.upload(key, buffer, {
    contentType: mimeOf(ext),
    cacheControl: "3600"
  });
  if (up && up.error) throw new Error(up.error.message || "图片上传失败");

  /* 登记进显示缓存：这张图本机已经有一份，不必再去签发临时地址 */
  CloudMedia.set(key, filePath);
  return key;
}

/*
  把商品图数组里的本机路径换成云端对象键，已经是对照得的键原样带过。
  估价页那种「仅留档」的图走的是同一个函数，行为一致。
*/
async function toCloud(paths) {
  const list = Array.isArray(paths) ? paths : (paths ? [paths] : []);
  const out = [];
  for (const raw of list) {
    const path = String(raw || "").trim();
    if (!path) continue;
    /* 本机临时文件 / 已落盘的本地文件才需要上传 */
    if (Upload.isLocal(path)) {
      out.push(await uploadToCloud(path));
      continue;
    }
    /* 云端对象键、云存储文件标识（cloud://）、包内静态图（assets/img/...）、完整 http 地址，都原样保留 */
    out.push(path);
  }
  return out;
}

const Upload = {
  /* 选图 -> 压缩 -> 落地，返回可直接存进商品记录的路径数组 */
  async pickToPaths(count = D.UPLOAD.maxCount) {
    const remain = Math.max(1, Math.min(count, D.UPLOAD.maxCount));
    const res = await new Promise((resolve, reject) => {
      wx.chooseMedia({
        count: remain,
        mediaType: ["image"],
        sizeType: ["compressed"],
        success: resolve,
        fail: (err) => reject(toError(err))
      });
    });
    const files = (res.tempFiles || []).slice(0, remain);
    const paths = [];
    for (const file of files) {
      if (file.size && file.size > D.UPLOAD.maxOriginalBytes) {
        throw new Error(`单张原图不得超过 ${D.formatMb(D.UPLOAD.maxOriginalBytes)}`);
      }
      const compressed = await compress(file.tempFilePath, Math.round(D.UPLOAD.quality * 100));
      paths.push(API_BASE ? await uploadToServer(compressed) : await saveLocal(compressed));
    }
    return paths;
  },

  /* 单张版本，估价页的实拍图用 */
  async pickOne() {
    const paths = await this.pickToPaths(1);
    return paths[0] || "";
  },

  /* 写入云端前把本机路径换成对象键，见文件上方说明 */
  toCloud,

  /* 是否是需要替换展示路径的本地文件 */
  isLocal(path) {
    return /^wxfile:\/\//.test(path || "") || /^http:\/\/tmp/.test(path || "");
  }
};

module.exports = Upload;
