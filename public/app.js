import { createApi, json } from "./api.js";
import { $, esc, formatTime, timeAgo, openModal, closeModal, showToast, installDialogAccessibility } from "./ui.js";
import { reportsMarkup, peopleMarkup, auditMarkup } from "./moderation.js";

let token = localStorage.getItem("flackle_token");
let me = null;
let socket = null;
let staffData = null;
let staffTab = "reports";
const api = createApi(() => token);
const state = {
  servers: [], channels: [], users: [], friends: [], notifications: [],
  staffRole: "member", currentServer: null, currentChannel: null, currentDM: null,
};

installDialogAccessibility();

function setActiveView(type = "none", id = "") {
  socket?.emit("setActiveView", { type, id });
}

function setNav(id) {
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.id === id));
  closeMobileNav();
}

function openMobileNav() {
  $("sidebar").classList.add("mobile-open");
  $("sidebarBackdrop").classList.remove("hidden");
  $("mobileMenu").setAttribute("aria-expanded", "true");
}

function closeMobileNav() {
  $("sidebar").classList.remove("mobile-open");
  $("sidebarBackdrop").classList.add("hidden");
  $("mobileMenu").setAttribute("aria-expanded", "false");
}

function updateBadges() {
  const count = state.notifications.filter((notification) => !notification.read).length;
  $("notificationBadge").textContent = count;
  $("notificationBadge").classList.toggle("hidden", !count);
  $("topBadge").classList.toggle("hidden", !count);
}

function renderRail() {
  $("serverRail").innerHTML = state.servers.map((server) => `
    <button class="server-icon ${state.currentServer?.id === server.id ? "active" : ""}" data-server="${server.id}" title="${esc(server.name)}">${esc(server.name.slice(0, 2).toUpperCase())}</button>
  `).join("");
}

function renderChannels() {
  const channels = state.channels.filter((channel) => channel.serverId === state.currentServer?.id);
  $("serverName").textContent = state.currentServer?.name || "Server";
  $("channels").innerHTML = channels.map((channel) => `
    <button class="channel ${state.currentChannel?.id === channel.id ? "active" : ""}" data-channel="${channel.id}"><span aria-hidden="true">#</span>${esc(channel.name)}</button>
  `).join("");
}

function renderMembers() {
  if (!state.currentServer) return;
  $("members").innerHTML = state.currentServer.members.map((membership) => {
    const user = state.users.find((candidate) => candidate.id === membership.userId);
    return user ? `<button class="member" data-profile="${user.id}"><div class="avatar">${esc(user.username[0].toUpperCase())}</div><div><b>${esc(user.username)}</b><small>${esc(membership.role)}</small></div></button>` : "";
  }).join("");
}

function friendUsers() {
  return state.friends
    .map((friendship) => friendship.a === me.id ? friendship.b : friendship.a)
    .map((id) => state.users.find((user) => user.id === id))
    .filter(Boolean);
}

function renderFriends() {
  const users = friendUsers();
  $("friendsList").innerHTML = users.length ? users.map((user) => `
    <div class="friend">
      <button class="profile-button" data-profile="${user.id}"><div class="avatar">${esc(user.username[0].toUpperCase())}</div><div class="friend-info"><b>${esc(user.username)}</b><small>${esc(user.status)}</small></div></button>
      <div class="friend-actions"><button data-dm="${user.id}">Message</button><button data-profile="${user.id}">Profile</button></div>
    </div>
  `).join("") : `<p class="empty">No friends yet. Add someone to start chatting.</p>`;
}

function useHomeLayout() {
  state.currentServer = null;
  state.currentChannel = null;
  state.currentDM = null;
  $("serverNav").classList.add("hidden");
  $("homeNav").classList.remove("hidden");
  $("homeBtn").classList.add("active");
  $("memberPanel").classList.add("hidden");
  $("chatView").classList.add("hidden");
  setActiveView();
  renderRail();
}

function showHome() {
  useHomeLayout();
  $("panelView").classList.add("hidden");
  $("homeView").classList.remove("hidden");
  $("topIcon").textContent = "F";
  $("topTitle").textContent = "Friends";
  $("topAddFriend").classList.remove("hidden");
  setNav("friendsBtn");
  renderFriends();
}

function showPanel(title, icon = "R") {
  useHomeLayout();
  $("homeView").classList.add("hidden");
  $("panelView").classList.remove("hidden");
  $("topIcon").textContent = icon;
  $("topTitle").textContent = title;
  $("topAddFriend").classList.add("hidden");
  $("panelHeader").innerHTML = `<h1>${esc(title)}</h1>`;
}

function showServerUI() {
  $("homeView").classList.add("hidden");
  $("panelView").classList.add("hidden");
  $("chatView").classList.remove("hidden");
  $("memberPanel").classList.remove("hidden");
  $("homeNav").classList.add("hidden");
  $("serverNav").classList.remove("hidden");
  $("homeBtn").classList.remove("active");
  $("topAddFriend").classList.add("hidden");
  closeMobileNav();
  renderChannels();
  renderMembers();
  renderRail();
}

async function selectServer(server) {
  if (!server) return;
  state.currentServer = server;
  state.currentDM = null;
  showServerUI();
  const channel = state.channels.find((candidate) => candidate.serverId === server.id);
  if (channel) await selectChannel(channel);
}

async function selectChannel(channel) {
  if (!channel) return;
  state.currentChannel = channel;
  state.currentDM = null;
  renderChannels();
  $("topIcon").textContent = "#";
  $("topTitle").textContent = channel.name;
  $("messageInput").placeholder = `Message #${channel.name}`;
  socket?.emit("joinChannel", channel.id);
  setActiveView("channel", channel.id);
  try {
    renderMessages(await api(`/api/channels/${channel.id}/messages`));
  } catch (error) {
    showToast(error.message);
  }
}

async function openDM(id) {
  const user = state.users.find((candidate) => candidate.id === id);
  if (!user) return;
  state.currentDM = id;
  state.currentChannel = null;
  state.currentServer = null;
  $("homeView").classList.add("hidden");
  $("panelView").classList.add("hidden");
  $("chatView").classList.remove("hidden");
  $("memberPanel").classList.add("hidden");
  $("homeNav").classList.remove("hidden");
  $("serverNav").classList.add("hidden");
  $("homeBtn").classList.add("active");
  $("topIcon").textContent = "@";
  $("topTitle").textContent = user.username;
  $("topAddFriend").classList.add("hidden");
  $("messageInput").placeholder = `Message @${user.username}`;
  closeMobileNav();
  socket?.emit("joinDM", id);
  setActiveView("dm", id);
  try {
    renderMessages(await api(`/api/dms/${id}`));
  } catch (error) {
    renderMessages([]);
    showToast(error.message);
  }
}

function messageMarkup(message) {
  const mine = message.userId === me.id;
  return `<div class="message" data-message="${message.id}">
    <button class="avatar" data-profile="${message.userId}" aria-label="View ${esc(message.author.username)}'s profile">${esc(message.author.username[0].toUpperCase())}</button>
    <div class="message-body"><div class="message-head"><button data-profile="${message.userId}">${esc(message.author.username)}</button><span class="time">${formatTime(message.createdAt)}</span>${mine ? "" : `<button class="report-message" data-report="${message.id}">Report</button>`}</div><div class="content">${esc(message.content)}</div></div>
  </div>`;
}

function renderMessages(messages) {
  $("messages").innerHTML = messages.map(messageMarkup).join("");
  $("messages").scrollTop = $("messages").scrollHeight;
}

function appendMessage(message) {
  $("messages").insertAdjacentHTML("beforeend", messageMarkup(message));
  $("messages").scrollTop = $("messages").scrollHeight;
}

async function showProfile(id) {
  try {
    const { user, mutualServers } = await api(`/api/users/${id}`);
    const canMessage = id !== me.id && state.friends.some((friendship) => friendship.a === id || friendship.b === id);
    openModal("User Profile", `<div class="profile-card"><div class="profile-hero"><div class="avatar large">${esc(user.username[0].toUpperCase())}</div><div><h3>${esc(user.username)} ${user.globalRole !== "member" ? `<span class="role-chip">${esc(user.globalRole.toUpperCase())}</span>` : ""}</h3><span class="status ${user.status}">${esc(user.status)}</span></div></div><div class="profile-section"><b>ABOUT ME</b><p>${esc(user.bio || "No bio yet.")}</p></div><div class="profile-section"><b>MEMBER SINCE</b><p>${new Date(user.createdAt).toLocaleDateString()}</p></div><div class="profile-section"><b>MUTUAL SERVERS</b><p>${mutualServers.map((server) => esc(server.name)).join(", ") || "None"}</p></div>${canMessage ? `<button class="action" data-dm="${id}">Message</button>` : ""}</div>`);
  } catch (error) {
    showToast(error.message);
  }
}

async function showRecent() {
  showPanel("Recent Messages", "R");
  setNav("recentBtn");
  try {
    const { conversations } = await api("/api/recent");
    $("panelList").innerHTML = conversations.length ? conversations.map(({ user, message }) => `
      <button class="recent-row" data-dm="${user.id}"><div class="avatar">${esc(user.username[0].toUpperCase())}</div><div><b>${esc(user.username)}</b><p>${message.userId === me.id ? "You: " : ""}${esc(message.content)}</p></div><time>${timeAgo(message.createdAt)}</time></button>
    `).join("") : `<div class="empty-state"><b>No recent messages</b><p>Your direct message conversations will appear here.</p></div>`;
  } catch (error) {
    showToast(error.message);
  }
}

function notificationMarkup(notification) {
  return `<div class="notification-row ${notification.read ? "" : "unread"}"><button class="notification-open" data-notification="${notification.id}" data-user="${notification.fromUserId || ""}" data-channel="${notification.channelId || ""}" data-server="${notification.serverId || ""}"><span class="notification-icon">${notification.type === "dm" ? "@" : "#"}</span><div><b>${esc(notification.text)}</b><p>${timeAgo(notification.createdAt)}</p></div></button>${notification.read ? "" : `<button class="mark-read" data-mark-read="${notification.id}">Mark read</button>`}</div>`;
}

function renderNotifications() {
  $("panelList").innerHTML = state.notifications.length
    ? state.notifications.map(notificationMarkup).join("")
    : `<div class="empty-state"><b>You're all caught up</b><p>Mentions and direct messages will appear here.</p></div>`;
}

function showNotifications() {
  showPanel("Notifications", "N");
  setNav("notificationsBtn");
  $("panelHeader").innerHTML = `<div class="panel-heading"><div><h1>Notifications</h1><p>Mentions and direct messages</p></div><div><button id="browserNotifications" class="secondary-small">Browser alerts</button><button id="markAllRead" class="secondary-small">Mark all read</button></div></div>`;
  renderNotifications();
}

async function loadStaff() {
  staffData = await api("/api/staff/overview");
  renderStaffTab();
}

function renderStaffTab() {
  $("panelHeader").innerHTML = `<h1>Staff Center</h1><p>Review reports, manage access, and inspect moderator activity.</p><div class="staff-tabs"><button data-staff-tab="reports" class="${staffTab === "reports" ? "active" : ""}">Reports</button><button data-staff-tab="people" class="${staffTab === "people" ? "active" : ""}">People</button><button data-staff-tab="audit" class="${staffTab === "audit" ? "active" : ""}">Audit log</button></div>`;
  if (!staffData) return;
  if (staffTab === "reports") $("panelList").innerHTML = reportsMarkup(staffData.reports);
  if (staffTab === "people") $("panelList").innerHTML = peopleMarkup(staffData.users, staffData.viewerRole);
  if (staffTab === "audit") $("panelList").innerHTML = auditMarkup(staffData.actions);
}

async function showStaff() {
  showPanel("Staff Center", "S");
  setNav("staffBtn");
  $("panelList").innerHTML = `<p class="empty">Loading staff data…</p>`;
  try {
    await loadStaff();
  } catch (error) {
    showToast(error.message);
  }
}

function openBanDialog(userId, username) {
  openModal("Ban Account", `<p class="muted">Choose how long <b>${esc(username)}</b> should lose access.</p><label for="banDuration">DURATION</label><select id="banDuration"><option value="1h">1 hour</option><option value="1d">1 day</option><option value="7d">7 days</option><option value="permanent">Permanent</option></select><label for="banReason">REASON</label><textarea id="banReason" maxlength="300" placeholder="Explain the policy violation"></textarea><button class="action danger" data-confirm-ban="${userId}">Ban account</button>`);
}

function connect() {
  socket = io({ auth: { token } });
  socket.on("connect", () => {
    if (state.currentDM) setActiveView("dm", state.currentDM);
    else if (state.currentChannel) setActiveView("channel", state.currentChannel.id);
    else setActiveView();
  });
  socket.on("message", (message) => { if (message.channelId === state.currentChannel?.id) appendMessage(message); });
  socket.on("dm", (message) => { if (state.currentDM && message.dmWith?.includes(state.currentDM)) appendMessage(message); });
  socket.on("notification", (notification) => {
    state.notifications.unshift(notification);
    updateBadges();
    showToast(notification.text);
    if (document.hidden && localStorage.getItem("flackle_browser_notifications") === "on" && Notification.permission === "granted") {
      new Notification("Flackle", { body: notification.text });
    }
  });
  socket.on("banned", ({ reason }) => {
    localStorage.removeItem("flackle_token");
    alert(`Your account was banned: ${reason}`);
    location.reload();
  });
  socket.on("roleChanged", async ({ role }) => {
    state.staffRole = role;
    showToast(`Your role is now ${role}`);
    await bootstrap();
  });
  socket.on("channelCreated", (channel) => {
    if (!state.channels.some((candidate) => candidate.id === channel.id)) state.channels.push(channel);
    renderChannels();
  });
  socket.on("serverUpdated", (server) => {
    const index = state.servers.findIndex((candidate) => candidate.id === server.id);
    if (index >= 0) state.servers[index] = server;
    if (state.currentServer?.id === server.id) state.currentServer = server;
    renderRail();
    renderChannels();
  });
  socket.on("typing", ({ username }) => {
    $("typing").textContent = `${username} is typing…`;
    clearTimeout(window.typeTimer);
    window.typeTimer = setTimeout(() => { $("typing").textContent = ""; }, 1500);
  });
  socket.on("disconnect", async (reason) => {
    if (reason !== "io server disconnect") return;
    try { await api("/api/me"); } catch { localStorage.removeItem("flackle_token"); location.reload(); }
  });
}

async function bootstrap() {
  const data = await api("/api/bootstrap");
  Object.assign(state, data);
  $("meName").textContent = me.username;
  $("meAvatar").textContent = me.username[0].toUpperCase();
  $("staffBtn").classList.toggle("hidden", !["owner", "staff"].includes(state.staffRole));
  updateBadges();
  renderRail();
  showHome();
}

$("homeBtn").addEventListener("click", showHome);
$("friendsBtn").addEventListener("click", showHome);
$("recentBtn").addEventListener("click", showRecent);
$("notificationsBtn").addEventListener("click", showNotifications);
$("topNotifications").addEventListener("click", showNotifications);
$("staffBtn").addEventListener("click", showStaff);
$("meAvatar").addEventListener("click", () => showProfile(me.id));
$("mobileMenu").addEventListener("click", () => $("sidebar").classList.contains("mobile-open") ? closeMobileNav() : openMobileNav());
$("sidebarBackdrop").addEventListener("click", closeMobileNav);

$("serverRail").addEventListener("click", (event) => {
  const button = event.target.closest("[data-server]");
  if (button) selectServer(state.servers.find((server) => server.id === button.dataset.server));
});
$("channels").addEventListener("click", (event) => {
  const button = event.target.closest("[data-channel]");
  if (button) selectChannel(state.channels.find((channel) => channel.id === button.dataset.channel));
});

$("addServer").addEventListener("click", () => openModal("Create a Server", `<p class="muted">Give your new community a name.</p><label for="serverInput">SERVER NAME</label><input id="serverInput" maxlength="40" placeholder="My server"><button class="action" id="makeServer">Create Server</button>`));
$("addChannel").addEventListener("click", () => state.currentServer && openModal("Create a Channel", `<label for="channelInput">CHANNEL NAME</label><input id="channelInput" maxlength="30" placeholder="general"><button class="action" id="makeChannel">Create Channel</button>`));
$("serverMenu").addEventListener("click", () => {
  const server = state.currentServer;
  const role = server?.members.find((membership) => membership.userId === me.id)?.role;
  if (!["owner", "admin"].includes(role)) return showToast("Only server admins can change settings.");
  openModal("Server Settings", `<label for="serverSettingsName">SERVER NAME</label><input id="serverSettingsName" maxlength="40" value="${esc(server.name)}"><label for="serverDescription">DESCRIPTION</label><textarea id="serverDescription" maxlength="240" placeholder="What is this server about?">${esc(server.description || "")}</textarea><button class="action" id="saveServerSettings">Save Changes</button>`);
});

const addFriendDialog = () => openModal("Add Friend", `<p class="muted">Enter their exact Flackle username.</p><label for="friendInput">USERNAME</label><input id="friendInput" placeholder="username"><button class="action" id="makeFriend">Add Friend</button>`);
$("topAddFriend").addEventListener("click", addFriendDialog);
$("addFriend").addEventListener("click", addFriendDialog);
$("discover").addEventListener("click", async () => {
  const { servers } = await api("/api/servers/discover");
  openModal("Discover Servers", servers.map((server) => `<div class="discover-item"><div><b>${esc(server.name)}</b><small>${server.members} members</small></div><button data-join="${server.id}">Join</button></div>`).join("") || "No servers available.");
});
$("settings").addEventListener("click", () => openModal("User Settings", `<label for="bioInput">ABOUT ME</label><textarea id="bioInput" maxlength="190" placeholder="Tell people about yourself">${esc(me.bio || "")}</textarea><label class="toggle-row"><input type="checkbox" id="browserToggle" ${localStorage.getItem("flackle_browser_notifications") === "on" ? "checked" : ""}> Browser notifications</label><button class="action" id="saveProfile">Save Settings</button><button class="secondary" id="settingsLogout">Log out</button>`));
const searchDialog = () => openModal("Find People", `<label for="searchInput">USERNAME</label><input id="searchInput" placeholder="Search users"><button class="action" id="searchUsers">Search</button><div id="searchResults"></div>`);
$("quickSearch").addEventListener("click", searchDialog);
$("topSearch").addEventListener("click", searchDialog);

$("panelHeader").addEventListener("click", async (event) => {
  const tab = event.target.closest("[data-staff-tab]");
  if (tab) { staffTab = tab.dataset.staffTab; renderStaffTab(); }
  if (event.target.id === "markAllRead") {
    await api("/api/notifications/read-all", { method: "POST" });
    state.notifications.forEach((notification) => { notification.read = true; });
    updateBadges(); renderNotifications();
  }
  if (event.target.id === "browserNotifications") {
    if (!("Notification" in window)) return showToast("Browser notifications are not supported here.");
    const permission = await Notification.requestPermission();
    localStorage.setItem("flackle_browser_notifications", permission === "granted" ? "on" : "off");
    showToast(permission === "granted" ? "Browser alerts enabled" : "Browser alerts were not enabled");
  }
});

$("panelList").addEventListener("click", async (event) => {
  try {
    const notificationButton = event.target.closest("[data-notification]");
    if (notificationButton) {
      await markNotificationRead(notificationButton.dataset.notification);
      if (notificationButton.dataset.user) return openDM(notificationButton.dataset.user);
      const server = state.servers.find((item) => item.id === notificationButton.dataset.server);
      const channel = state.channels.find((item) => item.id === notificationButton.dataset.channel);
      if (server && channel) { state.currentServer = server; showServerUI(); selectChannel(channel); }
    }
    const markRead = event.target.closest("[data-mark-read]");
    if (markRead) { await markNotificationRead(markRead.dataset.markRead); renderNotifications(); }
    const statusButton = event.target.closest("[data-report-status]");
    if (statusButton) {
      await api(`/api/staff/reports/${statusButton.dataset.reportId}`, json({ status: statusButton.dataset.reportStatus }, "PATCH"));
      await loadStaff(); showToast(`Report ${statusButton.dataset.reportStatus}`);
    }
    const saveReport = event.target.closest("[data-save-report]");
    if (saveReport) {
      const id = saveReport.dataset.saveReport;
      await api(`/api/staff/reports/${id}`, json({ notes: document.querySelector(`[data-notes-input="${id}"]`).value }, "PATCH"));
      await loadStaff(); showToast("Staff notes saved");
    }
    const ban = event.target.closest("[data-ban]");
    if (ban) openBanDialog(ban.dataset.ban, ban.dataset.name);
    const unban = event.target.closest("[data-unban]");
    if (unban) { await api(`/api/staff/users/${unban.dataset.unban}/unban`, { method: "POST" }); await loadStaff(); showToast("Account unbanned"); }
    const role = event.target.closest("[data-role]");
    if (role) { await api(`/api/staff/users/${role.dataset.userId}/role`, json({ role: role.dataset.role }, "PATCH")); await loadStaff(); showToast("Staff role updated"); }
  } catch (error) {
    showToast(error.message);
  }
});

async function markNotificationRead(id) {
  const notification = state.notifications.find((item) => item.id === id);
  if (notification && !notification.read) {
    await api(`/api/notifications/${id}/read`, { method: "PATCH" });
    notification.read = true;
    updateBadges();
  }
}

document.addEventListener("click", (event) => {
  const profile = event.target.closest("[data-profile]");
  const dm = event.target.closest("[data-dm]");
  const report = event.target.closest("[data-report]");
  if (profile) showProfile(profile.dataset.profile);
  if (dm) { closeModal(); openDM(dm.dataset.dm); }
  if (report) openModal("Report Message", `<p class="muted">Reports include nearby messages so staff can understand the context.</p><label for="reportCategory">CATEGORY</label><select id="reportCategory"><option value="spam">Spam</option><option value="harassment">Harassment</option><option value="hate">Hate speech</option><option value="sexual">Sexual content</option><option value="other">Other</option></select><label for="reportReason">WHAT HAPPENED?</label><textarea id="reportReason" maxlength="300" placeholder="Add details for the staff team"></textarea><button class="action danger" data-submit-report="${report.dataset.report}">Submit Report</button>`);
});

$("modal").addEventListener("click", async (event) => {
  try {
    if (event.target.id === "makeServer") {
      const data = await api("/api/servers", json({ name: $("serverInput").value }));
      state.servers.push(data.server); state.channels.push(data.channel); closeModal(); selectServer(data.server);
    }
    if (event.target.id === "makeChannel") {
      const data = await api(`/api/servers/${state.currentServer.id}/channels`, json({ name: $("channelInput").value }));
      if (!state.channels.some((channel) => channel.id === data.channel.id)) state.channels.push(data.channel);
      closeModal(); renderChannels();
    }
    if (event.target.id === "makeFriend") {
      const data = await api("/api/friends", json({ username: $("friendInput").value }));
      if (!state.friends.some((friendship) => friendship.a === data.user.id || friendship.b === data.user.id)) state.friends.push({ a: me.id, b: data.user.id, status: "accepted" });
      if (!state.users.some((user) => user.id === data.user.id)) state.users.push(data.user);
      closeModal(); renderFriends();
    }
    if (event.target.id === "saveServerSettings") {
      const data = await api(`/api/servers/${state.currentServer.id}`, json({ name: $("serverSettingsName").value, description: $("serverDescription").value }, "PATCH"));
      state.servers[state.servers.findIndex((server) => server.id === data.server.id)] = data.server;
      state.currentServer = data.server; closeModal(); renderRail(); renderChannels(); showToast("Server settings saved");
    }
    if (event.target.id === "saveProfile") {
      const data = await api("/api/me", json({ bio: $("bioInput").value }, "PATCH"));
      me = data.user;
      localStorage.setItem("flackle_browser_notifications", $("browserToggle").checked ? "on" : "off");
      closeModal(); showToast("Settings saved");
    }
    if (event.target.dataset.join) { await api(`/api/servers/${event.target.dataset.join}/join`, { method: "POST" }); await bootstrap(); closeModal(); }
    if (event.target.id === "settingsLogout") $("logout").click();
    if (event.target.id === "searchUsers") {
      const query = $("searchInput").value.toLowerCase();
      const users = state.users.filter((user) => user.username.toLowerCase().includes(query) && user.id !== me.id);
      $("searchResults").innerHTML = users.map((user) => `<div class="discover-item"><button class="user-result" data-profile="${user.id}"><div class="avatar">${esc(user.username[0].toUpperCase())}</div><b>${esc(user.username)}</b></button><button data-addsearch="${user.id}">Add</button></div>`).join("") || `<p class="empty">No users found.</p>`;
    }
    if (event.target.dataset.addsearch) {
      const user = state.users.find((candidate) => candidate.id === event.target.dataset.addsearch);
      await api("/api/friends", json({ username: user.username })); showToast("Friend added");
    }
    if (event.target.dataset.submitReport) {
      await api(`/api/messages/${event.target.dataset.submitReport}/report`, json({ category: $("reportCategory").value, reason: $("reportReason").value }));
      closeModal(); showToast("Message sent to staff for review");
    }
    if (event.target.dataset.confirmBan) {
      await api(`/api/staff/users/${event.target.dataset.confirmBan}/ban`, json({ duration: $("banDuration").value, reason: $("banReason").value }));
      closeModal(); await loadStaff(); showToast("Account banned");
    }
  } catch (error) {
    showToast(error.message);
  }
});

$("composer").addEventListener("submit", (event) => {
  event.preventDefault();
  const content = $("messageInput").value.trim();
  if (!content) return;
  if (state.currentDM) socket.emit("sendDM", { userId: state.currentDM, content });
  else if (state.currentChannel) socket.emit("sendMessage", { channelId: state.currentChannel.id, content });
  $("messageInput").value = "";
});
$("messageInput").addEventListener("input", () => state.currentChannel && socket?.emit("typing", { channelId: state.currentChannel.id }));
$("logout").addEventListener("click", () => { localStorage.removeItem("flackle_token"); location.reload(); });

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((item) => { item.classList.remove("active"); item.setAttribute("aria-selected", "false"); });
  tab.classList.add("active"); tab.setAttribute("aria-selected", "true");
  $("authForm").dataset.mode = tab.dataset.mode;
  $("password").autocomplete = tab.dataset.mode === "login" ? "current-password" : "new-password";
}));

$("authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const mode = $("authForm").dataset.mode || "login";
  try {
    const response = await fetch(`/api/auth/${mode}`, json({ username: $("username").value, password: $("password").value }));
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    token = data.token; localStorage.setItem("flackle_token", token); await start();
  } catch (error) {
    $("authError").textContent = error.message;
  }
});

async function start() {
  if (!token) return;
  try {
    me = (await api("/api/me")).user;
    $("auth").classList.add("hidden"); $("app").classList.remove("hidden");
    await bootstrap(); connect();
  } catch {
    localStorage.removeItem("flackle_token"); token = null;
  }
}

start();
