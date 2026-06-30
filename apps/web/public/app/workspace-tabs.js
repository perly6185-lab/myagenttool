export function createWorkspaceTabSurface({
  els,
  getActivePage,
  getCurrentInvocationId,
  getLastState,
  getTaskWorkspaceUrl,
  onCurrentInvocationChange,
  onModeChange,
  onPageChange,
  readableStatus,
  render,
  replaceHistory,
  showTasksPage,
  showWorkspacePage,
  taskSummary,
}) {
  const workspaceTabs = [];
  let workspaceDraftTabOpen = false;

  function isDraftTabOpen() {
    return workspaceDraftTabOpen;
  }

  function showTasks() {
    workspaceDraftTabOpen = false;
    workspaceTabs.splice(0, workspaceTabs.length);
    onCurrentInvocationChange(null);
  }

  function showWorkspace({ draft = false, invocationId = null } = {}) {
    workspaceDraftTabOpen = draft && !invocationId;
    workspaceTabs.splice(0, workspaceTabs.length);
    onCurrentInvocationChange(invocationId);
  }

  function openWorkspaceTab(invocationId, { activate = true } = {}) {
    if (!invocationId) return;
    onPageChange("workspace");
    workspaceTabs.splice(0, workspaceTabs.length, { id: invocationId });
    if (activate) {
      workspaceDraftTabOpen = false;
      onCurrentInvocationChange(invocationId);
      onModeChange("run_task");
    }
  }

  function activateWorkspaceTab(invocationId) {
    if (!invocationId) return;
    onPageChange("workspace");
    workspaceDraftTabOpen = false;
    onCurrentInvocationChange(invocationId);
    onModeChange("run_task");
    replaceHistory(invocationId);
    render(getLastState());
  }

  function closeWorkspaceTab(invocationId) {
    const index = workspaceTabs.findIndex((tab) => tab.id === invocationId);
    if (index === -1) return;
    workspaceTabs.splice(index, 1);
    if (getCurrentInvocationId() === invocationId) {
      showTasksPage();
    }
    render(getLastState());
  }

  function syncWorkspaceTabs(state) {
    const invocationIds = new Set((state?.invocations ?? []).map((invocation) => invocation.id));
    for (let index = workspaceTabs.length - 1; index >= 0; index -= 1) {
      if (!invocationIds.has(workspaceTabs[index].id)) workspaceTabs.splice(index, 1);
    }
  }

  function fallbackInvocationId(state) {
    return workspaceTabs.find((tab) => state?.invocations?.some((item) => item.id === tab.id))?.id ?? null;
  }

  function applyTaskListSurface() {
    const showTaskListSurface = getActivePage() === "tasks";
    els.workspace.dataset.taskList = String(showTaskListSurface);
    els.taskListPanel.hidden = !showTaskListSurface;
    els.workspaceTabStrip.hidden = showTaskListSurface;
    els.contextPanel.hidden = showTaskListSurface;
    els.commandPanel.querySelector(".chat-header").hidden = showTaskListSurface;
    els.commandPanel.querySelector(".chat-toolbar").hidden = showTaskListSurface;
    els.approvalPanel.hidden = showTaskListSurface || els.approvalPanel.hidden;
    els.eventList.hidden = showTaskListSurface;
    els.comparePanel.hidden = showTaskListSurface || els.comparePanel.hidden;
    els.commandPanel.querySelector(".chat-composer").hidden = showTaskListSurface;
    els.commandPanel.querySelector(".chat-details").hidden = showTaskListSurface;
  }

  function renderWorkspaceTabs(state) {
    const tabs = workspaceTabs
      .map((tab) => state?.invocations?.find((invocation) => invocation.id === tab.id))
      .filter(Boolean);
    const renderedTabs = tabs.map(workspaceTabButton);
    if (workspaceDraftTabOpen) renderedTabs.push(workspaceDraftTabButton());
    els.workspaceTabStrip.replaceChildren(...renderedTabs, workspaceNewTabButton());
  }

  function workspaceTabButton(invocation) {
    const tab = document.createElement("span");
    tab.className = "workspace-tab";
    tab.dataset.active = String(invocation.id === getCurrentInvocationId());

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.workspaceTabId = invocation.id;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(invocation.id === getCurrentInvocationId()));
    const title = document.createElement("strong");
    title.textContent = taskSummary(invocation.input?.task) ?? invocation.id;
    const status = document.createElement("small");
    status.textContent = readableStatus(invocation.status);
    button.append(title, status);

    const close = document.createElement("button");
    close.type = "button";
    close.dataset.workspaceTabClose = invocation.id;
    close.setAttribute("aria-label", "关闭标签页");
    close.textContent = "×";

    tab.append(button, close);
    return tab;
  }

  function workspaceNewTabButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "workspace-tab-new";
    button.setAttribute("aria-label", "新建任务标签页");
    button.textContent = "+";
    button.addEventListener("click", () => {
      showWorkspacePage({ draft: true });
      history.replaceState(null, "", getTaskWorkspaceUrl());
      render(getLastState());
    });
    return button;
  }

  function workspaceDraftTabButton() {
    const tab = document.createElement("span");
    tab.className = "workspace-tab";
    tab.dataset.active = "true";

    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", "true");
    const title = document.createElement("strong");
    title.textContent = "新任务";
    const status = document.createElement("small");
    status.textContent = "Draft";
    button.append(title, status);

    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "关闭标签页");
    close.textContent = "×";
    close.addEventListener("click", () => {
      showTasksPage();
      render(getLastState());
    });

    tab.append(button, close);
    return tab;
  }

  return {
    activateWorkspaceTab,
    applyTaskListSurface,
    closeWorkspaceTab,
    fallbackInvocationId,
    isDraftTabOpen,
    openWorkspaceTab,
    renderWorkspaceTabs,
    showTasks,
    showWorkspace,
    syncWorkspaceTabs,
  };
}
