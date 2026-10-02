/*
  站点字典的统一出口。
  utils/site-data.js 是从 Web 版原样复制的，它把字典挂在 globalThis.ZhijiabaoData 上、
  不通过 module.exports 导出，所以这里补一层封装，页面 require 本文件即可。
*/
require("./site-data.js");

module.exports = globalThis.ZhijiabaoData;
