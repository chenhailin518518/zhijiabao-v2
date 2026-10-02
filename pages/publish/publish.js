const { ready, Store } = require("../../utils/boot.js");
const D = require("../../utils/data.js");
const P = require("../../utils/pricing.js");
const Upload = require("../../utils/upload.js");
const ui = require("../../utils/ui.js");

Page({
  data: {
    theme: "light",
    mode: "offline",
    fromEstimate: false,

    scenicRange: [],
    categoryRange: [],
    conditionRange: [],
    tagRange: [],
    scenicIndex: 0,
    categoryIndex: 0,
    conditionIndex: 1,
    tagIndex: 0,

    form: {
      name: "",
      price: "",
      original: "",
      freight: "",
      description: ""
    },
    images: [],

    /* 估价跳过来时的建议价，用于一键填入 */
    suggested: null,
    maxImages: D.UPLOAD.maxCount,
    uploadHint: D.uploadHint(),
    submitting: false
  },

  async onLoad(query) {
    this.setData({
      theme: getApp().getTheme(),
      fromEstimate: query.from === "estimate",
      scenicRange: D.SCENICS.map((s) => s.id),
      categoryRange: D.CATEGORIES,
      conditionRange: D.CONDITIONS.map((c) => `${c.value} · ${c.desc}`),
      tagRange: D.TAGS
    });
    const mode = await ready();
    this.setData({ mode });

    const me = await Store.api("/api/auth/me");
    if (!me.user) {
      wx.redirectTo({ url: "/pages/login/login?redirect=publish" });
      return;
    }

    /* 从估价页「按此价发布」带过来的预填数据 */
    const prefill = getApp().globalData.publishPrefill;
    if (prefill) {
      getApp().globalData.publishPrefill = null;
      const scenicIndex = Math.max(0, this.data.scenicRange.indexOf(prefill.scenic));
      const categoryIndex = Math.max(0, this.data.categoryRange.indexOf(prefill.category));
      const conditionIndex = Math.max(0, D.CONDITIONS.findIndex((c) => c.value === prefill.condition));
      this.setData({
        scenicIndex,
        categoryIndex,
        conditionIndex,
        form: {
          name: prefill.name || "",
          price: String(prefill.price || ""),
          original: String(prefill.original || ""),
          freight: "",
          description: prefill.description || ""
        },
        images: prefill.photo ? [prefill.photo] : [],
        suggested: {
          priceText: ui.money(prefill.price),
          name: prefill.name
        }
      });
    }
  },

  onShow() {
    this.setData({ theme: getApp().getTheme() });
  },

  onInput(e) {
    this.setData({ [`form.${e.currentTarget.dataset.key}`]: e.detail.value });
  },

  onScenicChange(e) {
    this.setData({ scenicIndex: Number(e.detail.value) });
  },
  onCategoryChange(e) {
    this.setData({ categoryIndex: Number(e.detail.value) });
  },
  onConditionChange(e) {
    this.setData({ conditionIndex: Number(e.detail.value) });
  },
  onTagChange(e) {
    this.setData({ tagIndex: Number(e.detail.value) });
  },

  async addImages() {
    if (this.data.images.length >= D.UPLOAD.maxCount) {
      ui.toast(`最多上传 ${D.UPLOAD.maxCount} 张图片`);
      return;
    }
    try {
      const paths = await Upload.pickToPaths(D.UPLOAD.maxCount - this.data.images.length);
      this.setData({ images: this.data.images.concat(paths) });
    } catch (err) {
      /* 用户主动取消不提示，否则一个「图片处理失败」的 toast 会莫名其妙地弹出来 */
      if (!err.cancelled) ui.fail(err, "图片处理失败");
    }
  },

  removeImage(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const images = this.data.images.slice();
    images.splice(idx, 1);
    this.setData({ images });
  },

  previewImage(e) {
    wx.previewImage({
      current: this.data.images[Number(e.currentTarget.dataset.index)],
      urls: this.data.images
    });
  },

  async submit() {
    if (this.data.submitting) return;

    const payload = {
      name: this.data.form.name,
      scenic: this.data.scenicRange[this.data.scenicIndex],
      category: this.data.categoryRange[this.data.categoryIndex],
      condition: D.CONDITIONS[this.data.conditionIndex].value,
      tag: this.data.tagRange[this.data.tagIndex],
      price: this.data.form.price,
      original: this.data.form.original,
      freight: this.data.form.freight,
      description: this.data.form.description,
      images: this.data.images
    };

    /* 校验规则与 Web 版共用一套（含敏感词过滤） */
    const check = P.validateProduct(payload);
    if (!check.valid) {
      ui.toast(check.errors[0].message);
      return;
    }

    this.setData({ submitting: true });
    try {
      const res = await Store.api("/api/products", { method: "POST", body: check.value });
      const id = res.product ? res.product.id : res.id;
      ui.ok("已提交，等待平台审核");
      setTimeout(() => {
        if (id) wx.redirectTo({ url: `/pages/product/product?id=${id}` });
        else wx.switchTab({ url: "/pages/market/market" });
      }, 900);
    } catch (err) {
      ui.fail(err, "发布失败");
    } finally {
      this.setData({ submitting: false });
    }
  }
});
