import { esc, timeAgo } from "./ui.js";

export function reportsMarkup(reports) {
  if (!reports.length) return empty("No reports", "There are no reported messages to review.");
  return reports.map((report) => `
    <article class="report-card ${report.status}">
      <div class="report-top"><div><span class="status-pill">${esc(report.status)}</span><b> ${esc(report.category)} report against ${esc(report.reportedUser.username)}</b></div><time>${timeAgo(report.createdAt)}</time></div>
      <blockquote>${esc(report.message?.content || "Message unavailable")}</blockquote>
      <details><summary>Conversation context</summary><div class="report-context">${report.context.map((message) => `<p class="${message.id === report.messageId ? "reported" : ""}"><b>${esc(message.author.username)}:</b> ${esc(message.content)}</p>`).join("")}</div></details>
      <p><b>Reporter statement:</b> ${esc(report.reason || "No additional details")}</p>
      <label for="notes-${report.id}">PRIVATE STAFF NOTES</label><textarea id="notes-${report.id}" data-notes-input="${report.id}" maxlength="1000">${esc(report.notes || "")}</textarea>
      <div class="report-actions">
        <button data-save-report="${report.id}">Save notes</button>
        ${report.status === "open" ? `<button data-report-status="dismissed" data-report-id="${report.id}">Dismiss</button><button data-report-status="resolved" data-report-id="${report.id}">Resolve</button><button class="danger" data-ban="${report.reportedUserId}" data-name="${esc(report.reportedUser.username)}">Ban account</button>` : ""}
      </div>
    </article>`).join("");
}

export function peopleMarkup(users, viewerRole) {
  return `<div class="people-list">${users.map((user) => `
    <div class="person-row">
      <div class="avatar">${esc(user.username[0].toUpperCase())}</div>
      <div><b>${esc(user.username)}</b><p>${esc(user.globalRole)}${user.banned ? ` · banned ${user.bannedUntil === "permanent" ? "permanently" : `until ${new Date(user.bannedUntil).toLocaleString()}`}` : ""}</p></div>
      <div class="person-actions">
        ${user.banned ? `<button data-unban="${user.id}">Unban</button>` : user.globalRole !== "owner" ? `<button class="danger" data-ban="${user.id}" data-name="${esc(user.username)}">Ban</button>` : ""}
        ${viewerRole === "owner" && user.globalRole !== "owner" ? `<button data-role="${user.globalRole === "staff" ? "member" : "staff"}" data-user-id="${user.id}">${user.globalRole === "staff" ? "Remove staff" : "Make staff"}</button>` : ""}
      </div>
    </div>`).join("")}</div>`;
}

export function auditMarkup(actions) {
  if (!actions.length) return empty("No staff actions", "Moderation activity will be recorded here.");
  return actions.map((action) => `<div class="audit-row"><div><b>${esc(action.actor.username)}</b> ${esc(action.action.replaceAll("_", " "))} <b>${esc(action.target.username)}</b></div><time>${new Date(action.createdAt).toLocaleString()}</time></div>`).join("");
}

function empty(title, description) {
  return `<div class="empty-state"><b>${esc(title)}</b><p>${esc(description)}</p></div>`;
}
