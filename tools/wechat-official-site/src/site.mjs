export const SITE = Object.freeze({
  site: "wechat_official",
  displayName: "微信公众号",
  homeUrl: "https://mp.weixin.qq.com/",
  hosts: ["mp.weixin.qq.com"],
  loginMarkers: [
    ".weui-desktop-account__nickname",
    ".weui-desktop-account",
    "a[href*='cgi-bin/settingpage']",
    "a[href*='cgi-bin/home']",
  ],
  draftEntrySelectors: [
    "a[href*='appmsg_edit']",
    "a:has-text('图文消息')",
    "button:has-text('图文消息')",
  ],
  editor: {
    title: ["textarea[placeholder*='标题']", "input[placeholder*='标题']", "#title"],
    author: ["input[placeholder*='作者']", "#author"],
    digest: ["textarea[placeholder*='摘要']", "#js_description"],
    body: [".ProseMirror[contenteditable='true']", "[contenteditable='true'][data-placeholder*='正文']", "#ueditor_0", ".edui-body-container"],
    save: ["button:has-text('保存为草稿')", "button:has-text('保存草稿')", "a:has-text('保存为草稿')"],
    saved: ["text=已保存", "text=保存成功", ".weui-desktop-toast"],
  },
});
