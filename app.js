const { DEFAULT_THEME } = require("./utils/config.js");
const ui = require("./utils/ui.js");

/*
  tabBar 是原生控件，不受 WXSS 影响，切主题时必须单独同步，
  否则暗色内容配一条白色底栏，看起来像没切干净。
*/
const TABBAR_STYLE = {
  light: { color: "#728087", selectedColor: "#244853", backgroundColor: "#ffffff", borderStyle: "black" },
  dark: { color: "#8fa3a0", selectedColor: "#d3a86d", backgroundColor: "#16262b", borderStyle: "white" }
};

App({
  globalData: {
    theme: DEFAULT_THEME,
    mode: "checking"
  },

  onLaunch() {
    this.globalData.theme = ui.getTheme() || DEFAULT_THEME;
    this.applyTabBar(this.globalData.theme);
  },

  /* 主题是全局状态，页面切换回来后要能拿到最新值 */
  getTheme() {
    return this.globalData.theme || DEFAULT_THEME;
  },

  setTheme(theme) {
    this.globalData.theme = theme;
    ui.setTheme(theme);
    this.applyTabBar(theme);
  },

  applyTabBar(theme) {
    if (!wx.setTabBarStyle) return;
    wx.setTabBarStyle({
      ...(TABBAR_STYLE[theme] || TABBAR_STYLE.light),
      fail: () => { /* 非 tabBar 页面等场景调用失败不影响使用 */ }
    });
  }
});
