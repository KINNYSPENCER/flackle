const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { Server } = require("socket.io");
const { createStore } = require("./lib/store");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || "flackle-dev-secret";
const DATA = path.join(__dirname, "data");
const UPLOADS = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOADS, { recursive: true });

const store = createStore(DATA);
const db = store.data;
const save = store.save;
const upload = multer({ dest: UPLOADS, limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(UPLOADS));
app.use(express.static(path.join(__dirname, "public")));

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const now = () => new Date().toISOString();
const channelFor = (id) => db.channels.find((channel) => channel.id === id);
const member = (community, userId) => community?.members.find((item) => item.userId === userId);
const isOwner = (user) => user?.globalRole === "owner";
const isStaff = (user) => isOwner(user) || user?.globalRole === "staff";
const canManage = (community, user) => community?.ownerId === user.id || member(community, user.id)?.role === "admin";

function isBanned(user) {
  if (!user?.bannedUntil) return false;
  if (user.bannedUntil === "permanent") return true;
  if (new Date(user.bannedUntil) > new Date()) return true;
  user.bannedUntil = null;
  user.banReason = null;
  user.bannedAt = null;
  save();
  return false;
}

function publicUser(user) {
  if (!user) return { id: "unknown", username: "Unknown", status: "offline", globalRole: "member" };
  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar || null,
    status: user.status || "offline",
    createdAt: user.createdAt,
    bio: user.bio || "",
    globalRole: user.globalRole || "member",
    banned: isBanned(user),
    bannedUntil: user.bannedUntil || null,
  };
}

function messageView(message) {
  return { ...message, author: publicUser(db.users.find((user) => user.id === message.userId)) };
}

function token(user) {
  return jwt.sign({ id: user.id }, SECRET, { expiresIn: "7d" });
}

function auth(req, res, next) {
  try {
    const payload = jwt.verify((req.headers.authorization || "").replace("Bearer ", ""), SECRET);
    req.user = db.users.find((user) => user.id === payload.id);
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (isBanned(req.user)) return res.status(403).json({ error: `This account is banned: ${req.user.banReason || "Community guidelines violation"}` });
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

function staffOnly(req, res, next) {
  if (!isStaff(req.user)) return res.status(403).json({ error: "Staff access required." });
  next();
}

function ownerOnly(req, res, next) {
  if (!isOwner(req.user)) return res.status(403).json({ error: "Owner access required." });
  next();
}

function audit(actorId, action, targetUserId, details = {}) {
  db.moderationActions.push({ id: uid(), actorId, action, targetUserId: targetUserId || null, details, createdAt: now() });
}

function addNotification(userId, type, text, details = {}) {
  const notification = { id: uid(), userId, type, text, read: false, createdAt: now(), ...details };
  db.notifications.push(notification);
  io.to(`user:${userId}`).emit("notification", notification);
}

function isActivelyViewing(userId, type, id) {
  return [...io.sockets.sockets.values()].some((socket) =>
    socket.user?.id === userId && socket.activeView?.type === type && socket.activeView?.id === id
  );
}

function exactMention(content, username) {
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])@${escaped}(?=$|[^A-Za-z0-9_])`, "i").test(content);
}

function reportContext(message) {
  const conversation = db.messages.filter((candidate) =>
    message.channelId
      ? candidate.channelId === message.channelId
      : candidate.dmWith?.length === 2 && message.dmWith?.every((id) => candidate.dmWith.includes(id))
  );
  const index = conversation.findIndex((candidate) => candidate.id === message.id);
  return conversation.slice(Math.max(0, index - 2), index + 3).map(messageView);
}

app.get("/api/health", (req, res) => res.json({ ok: true, name: "Flackle" }));

app.post("/api/auth/register", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (username.length < 3 || username.length > 24 || password.length < 6) {
    return res.status(400).json({ error: "Username must be 3-24 characters and password at least 6 characters." });
  }
  if (db.users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: "Username already exists." });
  }
  const user = {
    id: uid(),
    username,
    password: await bcrypt.hash(password, 10),
    createdAt: now(),
    status: "online",
    bio: "",
    globalRole: db.users.length ? "member" : "owner",
    bannedUntil: null,
  };
  db.users.push(user);
  if (isOwner(user)) audit(user.id, "owner_initialized", user.id);
  save();
  res.json({ token: token(user), user: publicUser(user) });
});

app.post("/api/auth/login", async (req, res) => {
  const user = db.users.find((candidate) => candidate.username.toLowerCase() === String(req.body.username || "").toLowerCase());
  if (!user || !(await bcrypt.compare(String(req.body.password || ""), user.password))) {
    return res.status(401).json({ error: "Invalid username or password." });
  }
  if (isBanned(user)) return res.status(403).json({ error: `This account is banned: ${user.banReason}` });
  user.status = "online";
  save();
  res.json({ token: token(user), user: publicUser(user) });
});

app.get("/api/me", auth, (req, res) => res.json({ user: publicUser(req.user) }));
app.patch("/api/me", auth, (req, res) => {
  req.user.bio = String(req.body.bio || "").trim().slice(0, 190);
  save();
  res.json({ user: publicUser(req.user) });
});

app.get("/api/users/:id", auth, (req, res) => {
  const user = db.users.find((candidate) => candidate.id === req.params.id);
  if (!user) return res.status(404).json({ error: "User not found." });
  const mutualServers = db.servers
    .filter((community) => member(community, req.user.id) && member(community, user.id))
    .map((community) => ({ id: community.id, name: community.name }));
  res.json({ user: publicUser(user), mutualServers });
});

app.get("/api/bootstrap", auth, (req, res) => {
  const servers = db.servers.filter((community) => member(community, req.user.id));
  const channels = db.channels.filter((channel) => servers.some((community) => community.id === channel.serverId));
  res.json({
    servers,
    channels,
    users: db.users.filter((user) => !isBanned(user)).map(publicUser),
    friends: db.friendships.filter((friendship) => friendship.a === req.user.id || friendship.b === req.user.id),
    notifications: db.notifications.filter((notification) => notification.userId === req.user.id).slice(-50).reverse(),
    staffRole: req.user.globalRole || "member",
  });
});

app.get("/api/recent", auth, (req, res) => {
  const latest = new Map();
  for (const message of db.messages) {
    if (!message.dmWith?.includes(req.user.id)) continue;
    const otherId = message.dmWith.find((id) => id !== req.user.id);
    const previous = latest.get(otherId);
    if (otherId && (!previous || previous.createdAt < message.createdAt)) latest.set(otherId, message);
  }
  const conversations = [...latest.entries()]
    .map(([userId, message]) => ({ user: publicUser(db.users.find((user) => user.id === userId)), message: messageView(message) }))
    .filter(({ user }) => user.id !== "unknown" && !user.banned)
    .sort((a, b) => b.message.createdAt.localeCompare(a.message.createdAt));
  res.json({ conversations });
});

app.patch("/api/notifications/:id/read", auth, (req, res) => {
  const notification = db.notifications.find((item) => item.id === req.params.id && item.userId === req.user.id);
  if (!notification) return res.status(404).json({ error: "Notification not found." });
  notification.read = true;
  save();
  res.json({ notification });
});

app.post("/api/notifications/read-all", auth, (req, res) => {
  db.notifications.filter((item) => item.userId === req.user.id).forEach((item) => { item.read = true; });
  save();
  res.json({ ok: true });
});

app.get("/api/channels/:id/messages", auth, (req, res) => {
  const channel = channelFor(req.params.id);
  const community = channel && db.servers.find((item) => item.id === channel.serverId);
  if (!channel || !community || !member(community, req.user.id)) return res.status(403).json({ error: "Forbidden" });
  res.json(db.messages.filter((message) => message.channelId === channel.id).slice(-100).map(messageView));
});

app.post("/api/servers", auth, (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: "Server name required." });
  const community = { id: uid(), name, description: "", ownerId: req.user.id, icon: null, members: [{ userId: req.user.id, role: "owner" }], createdAt: now() };
  const channel = { id: uid(), serverId: community.id, name: "general", type: "text", createdAt: now() };
  db.servers.push(community);
  db.channels.push(channel);
  save();
  res.json({ server: community, channel });
});

app.patch("/api/servers/:id", auth, (req, res) => {
  const community = db.servers.find((item) => item.id === req.params.id);
  if (!community || !canManage(community, req.user)) return res.status(403).json({ error: "Admin permission required." });
  const name = String(req.body.name || "").trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: "Server name required." });
  community.name = name;
  community.description = String(req.body.description || "").trim().slice(0, 240);
  save();
  io.emit("serverUpdated", community);
  res.json({ server: community });
});

app.post("/api/servers/:id/channels", auth, (req, res) => {
  const community = db.servers.find((item) => item.id === req.params.id);
  if (!community || !canManage(community, req.user)) return res.status(403).json({ error: "Admin permission required." });
  const name = String(req.body.name || "").trim().toLowerCase().replace(/[^a-z0-9-_ ]/g, "").slice(0, 30);
  if (!name) return res.status(400).json({ error: "Channel name required." });
  const channel = { id: uid(), serverId: community.id, name, type: "text", createdAt: now() };
  db.channels.push(channel);
  save();
  io.emit("channelCreated", channel);
  res.json({ channel });
});

app.post("/api/servers/:id/join", auth, (req, res) => {
  const community = db.servers.find((item) => item.id === req.params.id);
  if (!community) return res.status(404).json({ error: "Server not found." });
  if (!member(community, req.user.id)) community.members.push({ userId: req.user.id, role: "member" });
  save();
  res.json({ server: community });
});

app.post("/api/servers/:id/kick", auth, (req, res) => {
  const community = db.servers.find((item) => item.id === req.params.id);
  if (!community || !canManage(community, req.user)) return res.status(403).json({ error: "Admin permission required." });
  if (community.ownerId === req.body.userId) return res.status(400).json({ error: "The server owner cannot be kicked." });
  community.members = community.members.filter((item) => item.userId !== req.body.userId);
  save();
  res.json({ ok: true });
});

app.get("/api/servers/discover", auth, (req, res) => {
  res.json({ servers: db.servers.map((community) => ({ ...community, members: community.members.length })) });
});

app.post("/api/friends", auth, (req, res) => {
  const other = db.users.find((user) => user.username.toLowerCase() === String(req.body.username || "").toLowerCase() && !isBanned(user));
  if (!other || other.id === req.user.id) return res.status(404).json({ error: "User not found." });
  if (!db.friendships.some((item) => (item.a === req.user.id && item.b === other.id) || (item.b === req.user.id && item.a === other.id))) {
    db.friendships.push({ id: uid(), a: req.user.id, b: other.id, status: "accepted" });
  }
  save();
  res.json({ user: publicUser(other) });
});

app.get("/api/dms/:userId", auth, (req, res) => {
  const isFriend = db.friendships.some((item) =>
    (item.a === req.user.id && item.b === req.params.userId) || (item.b === req.user.id && item.a === req.params.userId)
  );
  if (!isFriend) return res.status(403).json({ error: "Not friends." });
  res.json(db.messages.filter((message) => message.dmWith?.includes(req.user.id) && message.dmWith.includes(req.params.userId)).slice(-100).map(messageView));
});

app.post("/api/messages/:id/report", auth, (req, res) => {
  const message = db.messages.find((item) => item.id === req.params.id);
  if (!message) return res.status(404).json({ error: "Message not found." });
  const channel = message.channelId && channelFor(message.channelId);
  const community = channel && db.servers.find((item) => item.id === channel.serverId);
  const canView = message.dmWith?.includes(req.user.id) || (community && member(community, req.user.id));
  if (!canView) return res.status(403).json({ error: "Forbidden" });
  if (message.userId === req.user.id) return res.status(400).json({ error: "You cannot report your own message." });
  if (db.reports.some((item) => item.messageId === message.id && item.reporterId === req.user.id && item.status === "open")) {
    return res.status(409).json({ error: "You already reported this message." });
  }
  const report = {
    id: uid(),
    messageId: message.id,
    reporterId: req.user.id,
    reportedUserId: message.userId,
    category: ["spam", "harassment", "hate", "sexual", "other"].includes(req.body.category) ? req.body.category : "other",
    reason: String(req.body.reason || "").trim().slice(0, 300),
    notes: "",
    status: "open",
    createdAt: now(),
  };
  db.reports.push(report);
  save();
  res.json({ report });
});

app.get("/api/staff/overview", auth, staffOnly, (req, res) => {
  const reports = db.reports.slice().reverse().map((report) => {
    const message = db.messages.find((item) => item.id === report.messageId);
    return {
      ...report,
      message: message ? messageView(message) : null,
      context: message ? reportContext(message) : [],
      reporter: publicUser(db.users.find((user) => user.id === report.reporterId)),
      reportedUser: publicUser(db.users.find((user) => user.id === report.reportedUserId)),
    };
  });
  const users = db.users.map(publicUser).sort((a, b) => a.username.localeCompare(b.username));
  const actions = db.moderationActions.slice(-100).reverse().map((action) => ({
    ...action,
    actor: publicUser(db.users.find((user) => user.id === action.actorId)),
    target: publicUser(db.users.find((user) => user.id === action.targetUserId)),
  }));
  res.json({ reports, users, actions, viewerRole: req.user.globalRole });
});

app.patch("/api/staff/reports/:id", auth, staffOnly, (req, res) => {
  const report = db.reports.find((item) => item.id === req.params.id);
  if (!report) return res.status(404).json({ error: "Report not found." });
  if (["open", "resolved", "dismissed"].includes(req.body.status)) report.status = req.body.status;
  if (typeof req.body.notes === "string") report.notes = req.body.notes.trim().slice(0, 1000);
  report.reviewedAt = now();
  report.reviewedBy = req.user.id;
  audit(req.user.id, "report_updated", report.reportedUserId, { reportId: report.id, status: report.status });
  save();
  res.json({ report });
});

app.patch("/api/staff/users/:id/role", auth, ownerOnly, (req, res) => {
  const user = db.users.find((item) => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: "User not found." });
  if (isOwner(user)) return res.status(400).json({ error: "The owner role cannot be changed." });
  if (!["staff", "member"].includes(req.body.role)) return res.status(400).json({ error: "Invalid role." });
  user.globalRole = req.body.role;
  audit(req.user.id, "role_changed", user.id, { role: user.globalRole });
  save();
  io.to(`user:${user.id}`).emit("roleChanged", { role: user.globalRole });
  res.json({ user: publicUser(user) });
});

app.post("/api/staff/users/:id/ban", auth, staffOnly, (req, res) => {
  const user = db.users.find((item) => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: "User not found." });
  if (user.id === req.user.id || isOwner(user) || (isStaff(user) && !isOwner(req.user))) {
    return res.status(403).json({ error: "You cannot ban this account." });
  }
  const durations = { "1h": 3600000, "1d": 86400000, "7d": 604800000 };
  const duration = req.body.duration || "permanent";
  user.bannedUntil = duration === "permanent" ? "permanent" : new Date(Date.now() + (durations[duration] || durations["1d"])).toISOString();
  user.banReason = String(req.body.reason || "Community guidelines violation").trim().slice(0, 300);
  user.bannedAt = now();
  user.status = "offline";
  audit(req.user.id, "user_banned", user.id, { duration, reason: user.banReason });
  save();
  io.to(`user:${user.id}`).emit("banned", { reason: user.banReason, until: user.bannedUntil });
  io.in(`user:${user.id}`).disconnectSockets(true);
  res.json({ user: publicUser(user) });
});

app.post("/api/staff/users/:id/unban", auth, staffOnly, (req, res) => {
  const user = db.users.find((item) => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: "User not found." });
  user.bannedUntil = null;
  user.banReason = null;
  user.bannedAt = null;
  audit(req.user.id, "user_unbanned", user.id);
  save();
  res.json({ user: publicUser(user) });
});

app.post("/api/upload", auth, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file." });
  res.json({ url: `/uploads/${req.file.filename}`, name: req.file.originalname, size: req.file.size });
});

io.use((socket, next) => {
  try {
    const payload = jwt.verify(socket.handshake.auth?.token || "", SECRET);
    socket.user = db.users.find((user) => user.id === payload.id);
    if (!socket.user || isBanned(socket.user)) return next(new Error("Unauthorized"));
    next();
  } catch {
    next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  socket.user.status = "online";
  socket.join(`user:${socket.user.id}`);
  save();

  socket.use((_, next) => {
    const current = db.users.find((user) => user.id === socket.user.id);
    if (!current || isBanned(current)) return next(new Error("Account banned"));
    socket.user = current;
    next();
  });

  socket.on("setActiveView", (view) => {
    const type = ["channel", "dm", "none"].includes(view?.type) ? view.type : "none";
    socket.activeView = { type, id: String(view?.id || "") };
  });

  socket.on("joinChannel", (id) => {
    const channel = channelFor(id);
    const community = channel && db.servers.find((item) => item.id === channel.serverId);
    if (community && member(community, socket.user.id)) socket.join(`channel:${id}`);
  });

  socket.on("joinDM", (id) => {
    const isFriend = db.friendships.some((item) =>
      (item.a === socket.user.id && item.b === id) || (item.b === socket.user.id && item.a === id)
    );
    if (isFriend) socket.join(`dm:${[socket.user.id, id].sort().join(":")}`);
  });

  socket.on("typing", (data) => {
    const channel = channelFor(data.channelId);
    const community = channel && db.servers.find((item) => item.id === channel.serverId);
    if (community && member(community, socket.user.id)) {
      socket.to(`channel:${channel.id}`).emit("typing", { username: socket.user.username });
    }
  });

  socket.on("sendMessage", (data) => {
    const text = String(data.content || "").trim().slice(0, 4000);
    const channel = channelFor(data.channelId);
    const community = channel && db.servers.find((item) => item.id === channel.serverId);
    if (!text || !community || !member(community, socket.user.id)) return;
    const message = { id: uid(), channelId: channel.id, userId: socket.user.id, content: text, createdAt: now(), dmWith: null };
    db.messages.push(message);
    for (const user of db.users) {
      if (user.id !== socket.user.id && member(community, user.id) && exactMention(text, user.username) && !isActivelyViewing(user.id, "channel", channel.id)) {
        addNotification(user.id, "mention", `${socket.user.username} mentioned you in #${channel.name}`, { messageId: message.id, channelId: channel.id, serverId: community.id });
      }
    }
    save();
    io.to(`channel:${channel.id}`).emit("message", messageView(message));
  });

  socket.on("sendDM", (data) => {
    const otherId = String(data.userId || "");
    const text = String(data.content || "").trim().slice(0, 4000);
    const other = db.users.find((user) => user.id === otherId);
    const isFriend = db.friendships.some((item) =>
      (item.a === socket.user.id && item.b === otherId) || (item.b === socket.user.id && item.a === otherId)
    );
    if (!text || !other || isBanned(other) || !isFriend) return;
    const message = { id: uid(), channelId: null, userId: socket.user.id, content: text, createdAt: now(), dmWith: [socket.user.id, otherId] };
    db.messages.push(message);
    if (!isActivelyViewing(otherId, "dm", socket.user.id)) {
      addNotification(otherId, "dm", `${socket.user.username} sent you a message`, { messageId: message.id, fromUserId: socket.user.id });
    }
    save();
    io.to(`dm:${[socket.user.id, otherId].sort().join(":")}`).emit("dm", messageView(message));
  });

  socket.on("disconnect", () => {
    const user = db.users.find((item) => item.id === socket.user.id);
    if (user && ![...io.sockets.sockets.values()].some((candidate) => candidate.user?.id === user.id)) {
      user.status = "offline";
      save();
    }
  });
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
server.listen(PORT, () => console.log(`Flackle running at http://localhost:${PORT}`));
