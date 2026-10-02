/*
  举报面板的页面侧逻辑。

  为什么不做成 actionSheet：wx.showActionSheet 的 itemList 最多 6 项，
  而举报理由有 7 项（与 Web 版一致）。砍掉一项会丢掉「站外交易」这类平台最在意的理由，
  所以改成页面内浮层，标记在 templates/report-sheet.wxml，样式在 app.wxss。
  各页面只要把 reportBlank() 合进 data，再把 reportMethods(Store) 合进 Page 即可。
*/

function blank() {
  return {
    reportVisible: false,
    reportReason: "",
    reportDetail: "",
    reportTarget: null,
    reportReasons: []
  };
}

function methods(Store, reasons) {
  return {
    /* 打开面板：target 形如 { type: "user" | "product", id, label } */
    openReport(target) {
      this.setData({
        reportVisible: true,
        reportReason: "",
        reportDetail: "",
        reportTarget: target,
        reportReasons: reasons
      });
    },

    closeReport() {
      this.setData({ reportVisible: false, reportReason: "", reportDetail: "", reportTarget: null });
    },

    /* 浮层内部点击不应关闭面板 */
    noop() {},

    pickReportReason(e) {
      this.setData({ reportReason: e.currentTarget.dataset.reason });
    },

    onReportDetail(e) {
      this.setData({ reportDetail: e.detail.value });
    },

    async submitReport() {
      const { reportReason, reportDetail, reportTarget } = this.data;
      if (!reportTarget) return;
      if (!reportReason) {
        wx.showToast({ title: "请选择举报理由", icon: "none" });
        return;
      }
      try {
        const res = await Store.api("/api/reports", {
          method: "POST",
          body: {
            targetType: reportTarget.type,
            targetId: reportTarget.id,
            targetLabel: reportTarget.label,
            reason: reportReason,
            detail: reportDetail
          }
        });
        wx.showToast({ title: res.message || "举报已提交", icon: "none", duration: 2400 });
        this.closeReport();
      } catch (err) {
        wx.showToast({ title: (err && err.message) || "举报提交失败", icon: "none", duration: 2400 });
      }
    }
  };
}

module.exports = { blank, methods };
