const stateCopy = {
  entry: {
    step: "首次进入",
    title: "选择本地使用或团队登录",
    description: "本地使用只访问这台电脑上的本地团队；团队登录会验证企业身份和成员关系。"
  },
  waiting_confirmation: {
    step: "团队登录 · 第 1 步",
    title: "请在手机上核对并确认",
    description: "登录请求已绑定当前浏览器和电脑，确认前不会在共享屏幕显示个人或团队信息。"
  },
  tenant_selection: {
    step: "团队登录 · 第 2 步",
    title: "确认要进入的团队",
    description: "只有身份服务验证且已映射为有效成员关系的团队会出现在这里。"
  },
  expired: {
    step: "登录恢复",
    title: "登录码已过期",
    description: "旧请求已经终止，刷新会创建一个全新且仍与当前浏览器绑定的请求。"
  },
  rejected: {
    step: "登录恢复",
    title: "登录未获确认",
    description: "没有创建会话，也不会根据未验证的信息自动加入团队。"
  },
  recovery: {
    step: "备用方式",
    title: "使用账号密码或申请恢复",
    description: "账号密码和管理员恢复遵循独立的限速、审计和会话撤销策略。"
  },
  signed_in: {
    step: "我的 · 身份与设备",
    title: "查看当前团队和登录设备",
    description: "角色来自服务器成员记录；更改团队或权限会重新评估会话。"
  },
  logout: {
    step: "我的 · 退出登录",
    title: "确认退出范围",
    description: "当前设备和全部设备是两个不同的撤销动作。"
  }
};

const stage = document.querySelector(".stage");
const step = document.querySelector("[data-step]");
const title = document.querySelector("[data-title]");
const description = document.querySelector("[data-description]");
const body = document.querySelector("[data-state-body]");
const tabs = [...document.querySelectorAll("[data-state]")];

function applyState(name) {
  const copy = stateCopy[name] ?? stateCopy.entry;
  const template = document.querySelector(`#state-${name}`) ?? document.querySelector("#state-entry");
  stage.dataset.currentState = name;
  step.textContent = copy.step;
  title.textContent = copy.title;
  description.textContent = copy.description;
  body.replaceChildren(template.content.cloneNode(true));
  for (const tab of tabs) tab.classList.toggle("is-active", tab.dataset.state === name);
  document.querySelector("[data-state-body] button, [data-state-body] input")?.focus({ preventScroll: true });
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-state], [data-go]");
  if (!target) return;
  applyState(target.dataset.state ?? target.dataset.go);
});

document.addEventListener("submit", (event) => event.preventDefault());
applyState("entry");
