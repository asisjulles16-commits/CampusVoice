// CampusVoice – connected to a PHP + MySQL backend (api.php)
const API_URL = "api.php";
// Local cache of what the server last sent us. Rendering code reads from here.
const DB = { users: [], ideas: [], notifications: [] };
const CATEGORIES = ["Event", "Canteen", "Library", "Facilities", "Academics", "Other"];
const STATUSES = ["Open", "Under Review", "Approved", "Rejected", "Implemented"];
const CAT_ICONS = { Event: "🎉", Canteen: "🍽️", Library: "📚", Facilities: "🏫", Academics: "🎓", Other: "✨" };
const REJECT_REASONS = [
  "Not feasible right now",
  "Budget constraints",
  "Already planned",
  "Needs more details",
  "Similar to another suggestion"
];

let currentUser = null;
let duplicateMatches = [];
let toastTimer;
let activeCat = "";
let adminPage = "overview";
let decision = null;

const $ = id => document.getElementById(id);

// ---------- BASIC HELPERS ----------
async function api(action, data = {}) {
  let res;
  try {
    res = await fetch(API_URL + "?action=" + encodeURIComponent(action), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
  } catch {
    throw new Error("Cannot reach the server. Check your connection.");
  }
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  if (res.status === 401 && !["login", "register", "me"].includes(action)) handleSessionExpired();
  if (!res.ok || !json) throw new Error(json?.error || "Server error. Please try again.");
  return json;
}
async function refresh() {
  const state = await api("state");
  DB.users = state.users;
  DB.ideas = state.ideas;
  DB.notifications = state.notifications;
}
function handleSessionExpired() {
  if (!currentUser) return;
  currentUser = null;
  $("studentApp").classList.add("hidden");
  $("adminApp").classList.add("hidden");
  $("authPage").classList.remove("hidden");
  switchAuth("login");
  $("authMessage").className = "message";
  $("authMessage").textContent = "Your session expired. Please log in again.";
}
function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}
function formatDate(value) {
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function timeAgo(value) {
  const s = Math.floor((Date.now() - new Date(value)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  if (s < 604800) return Math.floor(s / 86400) + " d ago";
  return formatDate(value);
}
function getUsers() { return DB.users; }
function getIdeas() { return DB.ideas; }
function getNotifications() { return DB.notifications; }
function isAdmin() { return currentUser?.role === "admin"; }
function displayName(userId) {
  const user = getUsers().find(u => u.id === userId);
  return user ? user.name : "Former user";
}
function statusLabel(status) { return status === "Open" ? "Pending" : status; }
function statusClass(status) { return "status-" + status.toLowerCase().replace(/\s+/g, "-"); }
function voteCount(idea, choice) { return (idea.votes || []).filter(v => v.choice === choice).length; }
function isPending(idea) { return idea.status === "Open" || idea.status === "Under Review"; }

function showToast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3000);
}
function readImageAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- ACCOUNT REGISTRATION AND LOGIN ----------
function switchAuth(mode) {
  const login = mode === "login";
  $("loginForm").classList.toggle("hidden", !login);
  $("registerForm").classList.toggle("hidden", login);
  $("loginTab").classList.toggle("active", login);
  $("registerTab").classList.toggle("active", !login);
  $("authMessage").textContent = "";
}

$("registerForm").addEventListener("submit", async event => {
  event.preventDefault();
  const name = $("regName").value.trim();
  const studentId = $("regId").value.trim();
  const email = $("regEmail").value.trim().toLowerCase();
  const password = $("regPassword").value;
  const confirm = $("regConfirm").value;
  const message = $("authMessage");
  message.className = "message";

  if (!name || !studentId || !email) { message.textContent = "Please complete all required fields."; return; }
  if (password.length < 6) { message.textContent = "Password must be at least 6 characters."; return; }
  if (password !== confirm) { message.textContent = "Passwords do not match."; return; }

  try {
    await api("register", { name, studentId, email, password });
  } catch (e) {
    message.textContent = e.message;
    return;
  }
  event.target.reset();
  $("loginId").value = email;
  switchAuth("login");
  $("authMessage").className = "message success";
  $("authMessage").textContent = "Registration successful. Please log in.";
});

$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const message = $("authMessage");
  message.className = "message";
  try {
    const { user } = await api("login", {
      identifier: $("loginId").value.trim(),
      password: $("loginPassword").value
    });
    await refresh();
    enterApp(user);
  } catch (e) {
    message.textContent = e.message;
  }
});

// Shows the student app OR the admin app, never both.
function enterApp(user) {
  currentUser = user;
  $("authPage").classList.add("hidden");
  $("studentApp").classList.toggle("hidden", isAdmin());
  $("adminApp").classList.toggle("hidden", !isAdmin());

  if (isAdmin()) {
    $("adminName").textContent = user.name;
    showAdminPage("overview");
  } else {
    $("profileName").textContent = user.name;
    $("avatar").textContent = user.name.charAt(0).toUpperCase();
    $("welcomeName").textContent = user.name.split(" ")[0];
    renderChips();
    showPage("wall");
    updateStats();
    updateNotificationCount();
  }
}

async function logout() {
  try { await api("logout"); } catch { /* ignore */ }
  currentUser = null;
  DB.users = []; DB.ideas = []; DB.notifications = [];
  $("studentApp").classList.add("hidden");
  $("adminApp").classList.add("hidden");
  $("authPage").classList.remove("hidden");
  $("loginForm").reset();
  $("registerForm").reset();
  switchAuth("login");
}

/* =====================================================
   STUDENT SIDE
   ===================================================== */
async function showPage(page) {
  if (!currentUser || isAdmin()) return;
  ["wall", "myideas", "notifications"].forEach(name => {
    $(name + "View").classList.toggle("hidden", name !== page);
  });
  document.querySelectorAll("#studentApp .nav[data-page]").forEach(b => {
    b.classList.toggle("active", b.dataset.page === page);
  });
  const titles = { wall: "Idea wall", myideas: "My activity", notifications: "Notifications" };
  $("pageTitle").textContent = titles[page];
  try { await refresh(); } catch (e) { showToast(e.message); }   // always show fresh data from the database
  if (!currentUser || isAdmin()) return;
  if (page === "wall") renderIdeas();
  if (page === "myideas") renderMyActivity();
  if (page === "notifications") renderNotifications();
  updateStats();
  updateNotificationCount();
}

// ---------- Idea posting and duplicate check ----------
function openIdeaForm() {
  $("ideaModal").classList.remove("hidden");
  $("duplicateResults").classList.add("hidden");
  duplicateMatches = [];
}
function closeIdeaForm() { $("ideaModal").classList.add("hidden"); }

function normalizeText(text) {
  return String(text || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
function similarityScore(first, second) {
  const a = new Set(normalizeText(first).split(" ").filter(w => w.length > 2));
  const b = new Set(normalizeText(second).split(" ").filter(w => w.length > 2));
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  a.forEach(w => { if (b.has(w)) overlap++; });
  return overlap / Math.max(a.size, b.size);
}
function checkDuplicates() {
  const title = $("ideaTitle").value.trim();
  const description = $("ideaDescription").value.trim();
  const category = $("ideaCategory").value;
  const box = $("duplicateResults");
  $("descCount").textContent = $("ideaDescription").value.length + "/1500";
  duplicateMatches = [];
  if (title.length < 4 || !category) { box.classList.add("hidden"); return; }

  const combined = title + " " + description;
  duplicateMatches = getIdeas()
    .filter(idea => idea.category === category)
    .map(idea => ({ idea, score: similarityScore(combined, idea.title + " " + idea.description) }))
    .filter(item => item.score >= 0.35 || normalizeText(item.idea.title) === normalizeText(title))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (!duplicateMatches.length) { box.classList.add("hidden"); return; }
  box.classList.remove("hidden");
  box.innerHTML = `
    <strong>Similar ideas found</strong>
    <p>Check these before posting. You can support an existing idea or continue with your own.</p>
    ${duplicateMatches.map(({ idea }) => `
      <div class="duplicate-item">
        <strong>${escapeHTML(idea.title)}</strong>
        <p>${escapeHTML(idea.category)} · ${voteCount(idea, "Agree")} agree</p>
        <button type="button" class="btn secondary small" onclick="supportExistingIdea('${idea.id}')">Support this instead</button>
      </div>
    `).join("")}
    <p><strong>You can still post your idea if it is different.</strong></p>
  `;
}
$("ideaTitle").addEventListener("input", checkDuplicates);
$("ideaDescription").addEventListener("input", checkDuplicates);
$("ideaCategory").addEventListener("change", checkDuplicates);

async function supportExistingIdea(ideaId) {
  const idea = getIdeas().find(i => i.id === ideaId);
  if (!idea) { showToast("That idea could not be found."); return; }
  if (idea.authorId === currentUser.id) { showToast("You cannot vote on your own idea."); return; }
  await castVote(ideaId, "Agree");
  closeIdeaForm();
  $("ideaForm").reset();
  showPage("wall");
}

$("ideaForm").addEventListener("submit", async event => {
  event.preventDefault();
  const title = $("ideaTitle").value.trim();
  const category = $("ideaCategory").value;
  const description = $("ideaDescription").value.trim();
  const anonymous = $("ideaAnonymous").checked;
  const file = $("ideaPhoto").files[0];

  if (!title || !description || !CATEGORIES.includes(category)) {
    showToast("Please complete the title, category, and description.");
    return;
  }
  let photo = "";
  if (file) {
    if (!file.type.startsWith("image/")) { showToast("Please choose an image file."); return; }
    if (file.size > 1.5 * 1024 * 1024) { showToast("Please use an image smaller than 1.5 MB."); return; }
    try { photo = await readImageAsDataURL(file); }
    catch { showToast("Unable to load the image."); return; }
  }

  try {
    await api("createIdea", { title, category, description, anonymous, photo });
  } catch (e) {
    showToast(e.message);
    return;
  }

  closeIdeaForm();
  event.target.reset();
  $("descCount").textContent = "0/1500";
  duplicateMatches = [];
  showPage("wall");
  showToast("Your idea has been posted! Admin will review it soon.");
});

// ---------- Voting ----------
async function castVote(ideaId, choice) {
  if (!["Agree", "Disagree"].includes(choice)) return;
  const idea = getIdeas().find(i => i.id === ideaId);
  if (!idea) return;
  if (idea.authorId === currentUser.id) { showToast("You cannot vote on your own idea."); return; }
  try {
    const result = await api("vote", { ideaId, choice });
    await refresh();
    showToast(result.message);
  } catch (e) {
    showToast(e.message);
    return;
  }
  renderIdeas();
  if (!$("myideasView").classList.contains("hidden")) renderMyActivity();
  updateStats();
  updateNotificationCount();
}

// ---------- Idea display ----------
function tracker(status) {
  const idx = { Open: 0, "Under Review": 1, Approved: 2, Rejected: 2, Implemented: 3 }[status] ?? 0;
  const third = status === "Rejected" ? "Rejected" : status === "Approved" || status === "Implemented" ? "Approved" : "Decision";
  const labels = ["Submitted", "In review", third, "Implemented"];
  return `<div class="tracker">${labels.map((label, i) =>
    `<div class="step ${i <= idx ? "done" : ""} ${i === 2 && status === "Rejected" ? "bad" : ""}"><i></i>${label}</div>`
  ).join("")}</div>`;
}

function ideaCard(idea) {
  const myVote = (idea.votes || []).find(v => v.userId === currentUser.id);
  const mine = idea.authorId === currentUser.id;
  const name = idea.anonymous ? (mine ? "You (anonymous)" : "Anonymous student") : displayName(idea.authorId);
  const comments = idea.comments || [];
  return `
    <article id="idea-${idea.id}" class="idea-card cat-${idea.category.toLowerCase()}">
      <div class="idea-top">
        <div>
          <div class="idea-meta">
            <span class="pill">${CAT_ICONS[idea.category] || ""} ${escapeHTML(idea.category)}</span>
            <span class="pill ${statusClass(idea.status)}">${escapeHTML(statusLabel(idea.status))}</span>
          </div>
          <h3 class="idea-title">${escapeHTML(idea.title)}</h3>
        </div>
        <span class="muted small">${timeAgo(idea.createdAt)}</span>
      </div>
      <p class="idea-meta">Posted by ${escapeHTML(name)}</p>
      <p class="idea-description">${escapeHTML(idea.description)}</p>
      ${idea.photo ? `<img class="idea-photo" src="${idea.photo}" alt="Photo attached to the idea">` : ""}
      ${mine ? tracker(idea.status) : ""}
      ${idea.status === "Approved" ? `
        <div class="feedback good"><strong>✓ Approved by admin</strong>${escapeHTML(idea.adminNote || "Your idea was approved.")}</div>` : ""}
      ${idea.status === "Rejected" ? `
        <div class="feedback bad"><strong>Reason for rejection</strong>${escapeHTML(idea.rejectionReason || "No reason provided.")}</div>` : ""}
      ${idea.status === "Implemented" ? `
        <div class="feedback done"><strong>🚀 Implemented${idea.implementedDate ? " on " + escapeHTML(idea.implementedDate) : ""}</strong>${escapeHTML(idea.adminNote || "")}</div>
        ${idea.proofPhoto ? `<img class="idea-photo" src="${idea.proofPhoto}" alt="Proof of implementation">` : ""}` : ""}
      <div class="idea-actions">
        <button class="vote-btn ${myVote?.choice === "Agree" ? "selected" : ""}" onclick="castVote('${idea.id}','Agree')">👍 Agree (${voteCount(idea, "Agree")})</button>
        <button class="vote-btn ${myVote?.choice === "Disagree" ? "selected" : ""}" onclick="castVote('${idea.id}','Disagree')">👎 Disagree (${voteCount(idea, "Disagree")})</button>
        <span class="vote-spacer"></span>
        <button class="text-button" onclick="toggleComments('${idea.id}')">💬 Comments (${comments.length})</button>
      </div>
      <div id="comments-${idea.id}" class="comment-area hidden">
        <h4>Discussion</h4>
        <div>
          ${comments.length ? comments.map(c => `
            <div class="comment">
              <strong>${escapeHTML(displayName(c.userId))}</strong>
              <p>${escapeHTML(c.text)}</p>
              <small class="muted">${formatDate(c.createdAt)}</small>
            </div>`).join("") : '<p class="muted">No comments yet. Start the discussion.</p>'}
        </div>
        <form class="comment-form" onsubmit="addComment(event,'${idea.id}')">
          <input name="comment" maxlength="500" required placeholder="Write a comment…">
          <button class="btn primary" type="submit">Comment</button>
        </form>
      </div>
    </article>`;
}

function renderChips() {
  const all = [["", "✦ All"], ...CATEGORIES.map(c => [c, CAT_ICONS[c] + " " + c])];
  $("catChips").innerHTML = all.map(([value, label]) =>
    `<button class="chip ${activeCat === value ? "active" : ""}" onclick="setCategory('${value}')">${label}</button>`
  ).join("");
}
function setCategory(value) {
  activeCat = value;
  renderChips();
  renderIdeas();
}

function renderIdeas() {
  if (!currentUser || isAdmin()) return;
  const query = normalizeText($("searchIdeas").value);
  const status = $("statusFilter").value;
  const sort = $("sortFilter").value;

  let ideas = getIdeas().filter(idea => {
    const text = normalizeText(idea.title + " " + idea.description);
    return (!query || text.includes(query)) &&
      (!activeCat || idea.category === activeCat) &&
      (!status || idea.status === status);
  });

  if (sort === "newest") {
    ideas.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } else if (sort === "top") {
    ideas.sort((a, b) => voteCount(b, "Agree") - voteCount(a, "Agree") || new Date(b.createdAt) - new Date(a.createdAt));
  } else {
    ideas.sort((a, b) => {
      const sa = voteCount(a, "Agree") - voteCount(a, "Disagree");
      const sb = voteCount(b, "Agree") - voteCount(b, "Disagree");
      return sb - sa || new Date(b.createdAt) - new Date(a.createdAt);
    });
  }
  $("ideaList").innerHTML = ideas.length
    ? ideas.map(ideaCard).join("")
    : '<div class="empty"><strong>No ideas found</strong>Try changing your filters or be the first to share an idea.</div>';
}

function renderMyActivity() {
  const all = getIdeas();
  const mine = all.filter(i => i.authorId === currentUser.id);
  const others = all.filter(i => i.authorId !== currentUser.id && (
    (i.votes || []).some(v => v.userId === currentUser.id) ||
    (i.comments || []).some(c => c.userId === currentUser.id)
  ));
  $("myActivityList").innerHTML = `
    <h2 class="sub-title">My ideas (${mine.length})</h2>
    <div class="idea-list">${mine.length ? mine.map(ideaCard).join("") :
      '<div class="empty"><strong>No ideas yet</strong>Tap "Share an idea" to post your first suggestion.</div>'}</div>
    <h2 class="sub-title">Ideas I supported or discussed (${others.length})</h2>
    <div class="idea-list">${others.length ? others.map(ideaCard).join("") :
      '<div class="empty"><strong>Nothing here yet</strong>Vote or comment on ideas to see them here.</div>'}</div>`;
}

function updateStats() {
  const ideas = getIdeas();
  $("statIdeas").textContent = ideas.length;
  $("statDone").textContent = ideas.filter(i => i.status === "Implemented").length;
  $("statVotes").textContent = ideas.reduce((sum, i) => sum + (i.votes || []).length, 0);
}

// ---------- Comments ----------
function toggleComments(ideaId) { $("comments-" + ideaId)?.classList.toggle("hidden"); }
async function addComment(event, ideaId) {
  event.preventDefault();
  const input = event.target.elements.comment;
  const text = input.value.trim();
  if (!text) return;
  try {
    await api("comment", { ideaId, text });
    await refresh();
  } catch (e) {
    showToast(e.message);
    return;
  }
  renderIdeas();
  if (!$("myideasView").classList.contains("hidden")) renderMyActivity();
  document.querySelectorAll("#comments-" + ideaId).forEach(el => el.classList.remove("hidden")); // keep thread open
  updateNotificationCount();
  showToast("Comment added.");
}

// ---------- Notifications ----------
function updateNotificationCount() {
  if (!currentUser || isAdmin()) return;
  const unread = getNotifications().filter(n => n.userId === currentUser.id && !n.read).length;
  $("notificationCount").textContent = unread || "";
}
function renderNotifications() {
  const notifications = getNotifications().filter(n => n.userId === currentUser.id);
  $("notificationList").innerHTML = notifications.length
    ? notifications.map(n => `
      <div class="notice ${n.read ? "" : "unread"}">
        <small>${n.read ? "Notification" : "New"} · ${timeAgo(n.createdAt)}</small>
        <p>${escapeHTML(n.message)}</p>
        ${n.ideaId ? `<button class="text-button" onclick="openNotifiedIdea('${n.id}')">View idea</button>` : ""}
      </div>`).join("")
    : '<div class="empty"><strong>You are all caught up</strong>Notifications will appear here when there are updates.</div>';

  // Mark as read (locally right away, and in the database).
  if (notifications.some(n => !n.read)) {
    DB.notifications.forEach(n => { if (n.userId === currentUser.id) n.read = true; });
    api("markRead").catch(() => {});
  }
  updateNotificationCount();
}
async function openNotifiedIdea(notificationId) {
  const n = getNotifications().find(item => item.id === notificationId);
  if (!n?.ideaId) return;
  await showPage("wall");
  if (!getIdeas().some(i => i.id === n.ideaId)) { showToast("This idea is no longer available."); return; }
  focusIdea(n.ideaId);
}
function focusIdea(ideaId) {
  activeCat = "";
  $("searchIdeas").value = "";
  $("statusFilter").value = "";
  renderChips();
  renderIdeas();
  const el = $("idea-" + ideaId);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.style.outline = "3px solid #6d5dfc";
  setTimeout(() => { el.style.outline = ""; }, 2000);
}

/* =====================================================
   ADMIN SIDE (separate from the student interface)
   ===================================================== */
async function showAdminPage(page) {
  if (!isAdmin()) return;
  adminPage = page;
  ["overview", "queue", "all", "students"].forEach(p => $("ap-" + p).classList.toggle("hidden", p !== page));
  document.querySelectorAll("#adminApp .nav[data-apage]").forEach(b => {
    b.classList.toggle("active", b.dataset.apage === page);
  });
  $("adminTitle").textContent = { overview: "Overview", queue: "Review queue", all: "All suggestions", students: "Students" }[page];
  try { await refresh(); } catch (e) { showToast(e.message); }
  if (isAdmin()) renderAdmin();
}
function jumpTo(page, status) {
  if (page === "all") $("allStatus").value = status || "";
  showAdminPage(page);
}
function renderAdmin() {
  if (!isAdmin()) return;
  const pending = getIdeas().filter(isPending).length;
  $("queueBadge").textContent = pending || "";
  ({ overview: renderOverview, queue: renderQueue, all: renderAll, students: renderStudents })[adminPage]();
}

function sortIdeas(list, mode) {
  const date = i => new Date(i.createdAt);
  if (mode === "oldest") list.sort((a, b) => date(a) - date(b));
  else if (mode === "votes") list.sort((a, b) => voteCount(b, "Agree") - voteCount(a, "Agree") || date(b) - date(a));
  else list.sort((a, b) => date(b) - date(a));
  return list;
}

// ---------- Overview ----------
function renderOverview() {
  const ideas = getIdeas();
  const c = s => ideas.filter(i => i.status === s).length;
  const pending = c("Open") + c("Under Review");
  const decided = c("Approved") + c("Rejected") + c("Implemented");
  const rate = decided ? Math.round((c("Approved") + c("Implemented")) / decided * 100) : 0;

  $("ovPending").textContent = pending;
  $("ovRate").textContent = rate + "%";
  $("ovMeter").style.width = rate + "%";

  $("ovStats").innerHTML = [
    ["💡", "Total suggestions", ideas.length, "all", ""],
    ["⏳", "Needs review", pending, "queue", ""],
    ["✓", "Approved", c("Approved"), "all", "Approved"],
    ["🚀", "Implemented", c("Implemented"), "all", "Implemented"],
    ["✕", "Rejected", c("Rejected"), "all", "Rejected"]
  ].map(([icon, label, n, page, st]) => `
    <button class="a-stat" onclick="jumpTo('${page}','${st}')"><span>${icon}</span><small>${label}</small><strong>${n}</strong></button>
  `).join("");

  const counts = CATEGORIES.map(cat => [cat, ideas.filter(i => i.category === cat).length]);
  const max = Math.max(1, ...counts.map(x => x[1]));
  $("ovCategories").innerHTML = counts.map(([cat, n]) => `
    <div class="bar-row cat-${cat.toLowerCase()}">
      <span>${CAT_ICONS[cat]} ${cat}</span>
      <div class="bar"><i style="width:${n / max * 100}%"></i></div>
      <strong>${n}</strong>
    </div>`).join("");

  const top = sortIdeas(ideas.filter(isPending), "votes").slice(0, 3);
  $("ovTop").innerHTML = top.length ? top.map(i => `
    <div class="mini-row">
      <div><strong>${escapeHTML(i.title)}</strong><small>${voteCount(i, "Agree")} agree · ${escapeHTML(i.category)}</small></div>
      <button class="btn secondary small" onclick="showAdminPage('queue')">Review</button>
    </div>`).join("") : '<p class="muted">Nothing waiting. Great job! 🎉</p>';

  const recent = [...ideas].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)).slice(0, 6);
  $("ovRecent").innerHTML = recent.length ? recent.map(i => `
    <div class="mini-row">
      <div><strong>${escapeHTML(i.title)}</strong><small>${timeAgo(i.updatedAt || i.createdAt)}</small></div>
      <span class="pill ${statusClass(i.status)}">${escapeHTML(statusLabel(i.status))}</span>
    </div>`).join("") : '<p class="muted">No suggestions yet. Student submissions will appear here.</p>';
}

// ---------- Queue / All ----------
function renderQueue() {
  const query = normalizeText($("queueSearch").value);
  let list = getIdeas().filter(i => isPending(i) &&
    (!query || normalizeText(i.title + " " + i.description).includes(query)));
  sortIdeas(list, $("queueSort").value);
  list.sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0)); // pinned first
  $("queueCount").textContent = `${list.length} suggestion${list.length === 1 ? "" : "s"} waiting for review`;
  $("queueList").innerHTML = list.length
    ? list.map(adminCard).join("")
    : '<div class="empty"><strong>All caught up 🎉</strong>No suggestions are waiting for review.</div>';
}

function renderAll() {
  const ideas = getIdeas();
  const query = normalizeText($("allSearch").value);
  const status = $("allStatus").value;
  const category = $("allCategory").value;
  let list = ideas.filter(i =>
    (!query || normalizeText(i.title + " " + i.description).includes(query)) &&
    (!status || i.status === status) &&
    (!category || i.category === category));
  sortIdeas(list, $("allSort").value);
  $("allCount").textContent = `Showing ${list.length} of ${ideas.length} suggestions`;
  $("allList").innerHTML = list.length
    ? list.map(adminCard).join("")
    : '<div class="empty"><strong>No suggestions found</strong>Try a different search term or filter.</div>';
}

function adminCard(idea) {
  const user = getUsers().find(u => u.id === idea.authorId);
  const comments = idea.comments || [];
  let actions = "";
  if (isPending(idea)) {
    actions = `
      <button class="btn approve" onclick="openDecision('${idea.id}','approve')">✓ Approve</button>
      <button class="btn reject" onclick="openDecision('${idea.id}','reject')">✕ Reject</button>
      ${idea.status === "Open" ? `<button class="btn warn" onclick="setStatus('${idea.id}','Under Review')">Mark under review</button>` : ""}`;
  } else if (idea.status === "Approved") {
    actions = `
      <button class="btn primary" onclick="openDecision('${idea.id}','implement')">🚀 Mark implemented</button>
      <button class="btn warn" onclick="setStatus('${idea.id}','Under Review')">Reopen</button>`;
  } else {
    actions = `<button class="btn warn" onclick="setStatus('${idea.id}','Under Review')">Reopen for review</button>`;
  }

  return `
    <article class="idea-card cat-${idea.category.toLowerCase()} ${idea.priority ? "pinned" : ""}">
      <div class="idea-top">
        <div>
          <div class="idea-meta">
            <span class="pill">${CAT_ICONS[idea.category] || ""} ${escapeHTML(idea.category)}</span>
            <span class="pill ${statusClass(idea.status)}">${escapeHTML(statusLabel(idea.status))}</span>
            ${idea.priority ? '<span class="pill" style="background:#fff6dc;color:#9a6500">★ Priority</span>' : ""}
          </div>
          <h3 class="idea-title">${escapeHTML(idea.title)}</h3>
        </div>
        <span class="muted small">${formatDate(idea.createdAt)}</span>
      </div>
      <div class="author-line">
        <span>👤 ${escapeHTML(user ? user.name : "Former user")}${user ? " · " + escapeHTML(user.studentId) : ""}</span>
        ${idea.anonymous ? '<span class="pill">Posted anonymously</span>' : ""}
      </div>
      <p class="idea-description">${escapeHTML(idea.description)}</p>
      ${idea.photo ? `<img class="idea-photo" src="${idea.photo}" alt="Student attachment">` : ""}
      <div class="idea-meta" style="margin-top:12px">
        <span>👍 ${voteCount(idea, "Agree")} agree</span>
        <span>👎 ${voteCount(idea, "Disagree")} disagree</span>
        <span>💬 ${comments.length} comments</span>
      </div>
      ${idea.status === "Approved" && idea.adminNote ? `<div class="feedback good"><strong>Message sent to student</strong>${escapeHTML(idea.adminNote)}</div>` : ""}
      ${idea.status === "Rejected" ? `<div class="feedback bad"><strong>Rejection reason</strong>${escapeHTML(idea.rejectionReason)}</div>` : ""}
      ${idea.status === "Implemented" ? `<div class="feedback done"><strong>🚀 Implemented${idea.implementedDate ? " on " + escapeHTML(idea.implementedDate) : ""}</strong>${escapeHTML(idea.adminNote || "")}</div>
        ${idea.proofPhoto ? `<img class="idea-photo" src="${idea.proofPhoto}" alt="Proof of implementation">` : ""}` : ""}

      <details class="admin-details">
        <summary>Internal note &amp; student discussion</summary>
        <div>
          <label for="note-${idea.id}">Private admin note (students cannot see this)</label>
          <textarea id="note-${idea.id}" rows="2" maxlength="600" placeholder="e.g. Talked to the library head, waiting for budget…">${escapeHTML(idea.internalNote || "")}</textarea>
          <button class="btn secondary small" style="margin-top:8px" onclick="saveNote('${idea.id}')">Save note</button>
          ${comments.length ? `<h4 style="margin:16px 0 4px">Student comments</h4>` + comments.map(c => `
            <div class="comment"><strong>${escapeHTML(displayName(c.userId))}</strong><p>${escapeHTML(c.text)}</p></div>`).join("") : ""}
        </div>
      </details>

      <div class="admin-actions">
        ${actions}
        <span class="push"></span>
        <button class="icon-btn ${idea.priority ? "on" : ""}" onclick="togglePin('${idea.id}')" title="Mark as priority">★</button>
        <button class="icon-btn danger" onclick="deleteIdea('${idea.id}')" title="Delete suggestion">🗑</button>
      </div>
    </article>`;
}

// ---------- Admin actions ----------
async function adminCall(action, data, successMessage) {
  if (!isAdmin()) return false;
  try {
    await api(action, data);
    await refresh();
  } catch (e) {
    showToast(e.message);
    return false;
  }
  renderAdmin();
  if (successMessage) showToast(successMessage);
  return true;
}

function setStatus(ideaId, status) {
  adminCall("setStatus", { ideaId, status }, "Status changed to " + statusLabel(status) + ".");
}

function openDecision(ideaId, type) {
  if (!isAdmin()) return;
  const idea = getIdeas().find(i => i.id === ideaId);
  if (!idea) return;
  decision = { ideaId, type };
  $("decisionIdea").textContent = idea.title;
  const submit = $("decisionSubmit");
  let body = "";

  if (type === "approve") {
    $("decisionTitle").textContent = "Approve suggestion";
    submit.textContent = "✓ Approve";
    submit.className = "btn primary full";
    body = `<label for="decNote">Message to the student (optional)</label>
      <textarea id="decNote" rows="3" maxlength="600" placeholder="e.g. Great idea! We will plan this next month."></textarea>`;
  } else if (type === "reject") {
    $("decisionTitle").textContent = "Reject suggestion";
    submit.textContent = "✕ Reject";
    submit.className = "btn reject full";
    body = `<label for="decNote">Reason for rejection (required)</label>
      <textarea id="decNote" rows="3" maxlength="1000" placeholder="Explain politely why this cannot be approved…"></textarea>
      <div class="reason-chips">${REJECT_REASONS.map(r => `<button type="button" onclick="setReason(this.textContent)">${r}</button>`).join("")}</div>`;
  } else {
    $("decisionTitle").textContent = "Mark as implemented";
    submit.textContent = "🚀 Save";
    submit.className = "btn primary full";
    body = `<label for="decDate">Implementation date (required)</label>
      <input id="decDate" type="date" value="${new Date().toISOString().slice(0, 10)}">
      <label for="decProof">Proof photo (optional)</label>
      <input id="decProof" type="file" accept="image/*">
      <label for="decNote">Message to the student (optional)</label>
      <textarea id="decNote" rows="2" maxlength="600" placeholder="e.g. The new schedule started this week."></textarea>`;
  }
  $("decisionBody").innerHTML = body;
  $("decisionModal").classList.remove("hidden");
  setTimeout(() => $("decNote")?.focus(), 50);
}
function setReason(text) { $("decNote").value = text; $("decNote").focus(); }
function closeDecision() { $("decisionModal").classList.add("hidden"); decision = null; }

async function submitDecision() {
  if (!isAdmin() || !decision) return;
  const { ideaId, type } = decision;
  const note = $("decNote")?.value.trim() || "";
  const payload = { ideaId, type, note };

  if (type === "reject" && !note) { showToast("Please provide a reason for rejection."); return; }
  if (type === "implement") {
    const date = $("decDate").value;
    if (!date) { showToast("Please select the implementation date."); return; }
    payload.date = date;
    const file = $("decProof").files[0];
    if (file) {
      if (!file.type.startsWith("image/")) { showToast("Proof must be an image."); return; }
      if (file.size > 1.5 * 1024 * 1024) { showToast("Please use a proof image smaller than 1.5 MB."); return; }
      try { payload.proof = await readImageAsDataURL(file); }
      catch { showToast("Unable to load the proof image."); return; }
    }
  }
  const word = { approve: "approved", reject: "rejected", implement: "implemented" }[type];
  if (await adminCall("decide", payload, "Suggestion " + word + ".")) closeDecision();
}

async function togglePin(ideaId) {
  const idea = getIdeas().find(i => i.id === ideaId);
  if (!idea) return;
  await adminCall("togglePin", { ideaId }, idea.priority ? "Priority removed." : "Marked as priority.");
}
async function saveNote(ideaId) {
  const note = $("note-" + ideaId).value.trim();
  try { await api("saveNote", { ideaId, note }); } catch (e) { showToast(e.message); return; }
  const idea = getIdeas().find(i => i.id === ideaId);
  if (idea) idea.internalNote = note;
  showToast("Note saved.");
}
async function deleteIdea(ideaId) {
  if (!confirm("Delete this suggestion permanently? This cannot be undone.")) return;
  await adminCall("deleteIdea", { ideaId }, "Suggestion deleted.");
}

// ---------- Students tab ----------
function renderStudents() {
  const ideas = getIdeas();
  const students = getUsers().filter(u => u.role !== "admin");
  $("studentGrid").innerHTML = students.length ? students.map(s => {
    const mine = ideas.filter(i => i.authorId === s.id);
    const ok = mine.filter(i => i.status === "Approved" || i.status === "Implemented").length;
    const no = mine.filter(i => i.status === "Rejected").length;
    return `
      <div class="student-card">
        <header>
          <div class="avatar">${escapeHTML(s.name.charAt(0).toUpperCase())}</div>
          <div><strong>${escapeHTML(s.name)}</strong><small>${escapeHTML(s.studentId)} · ${escapeHTML(s.email)}</small></div>
        </header>
        <div class="student-nums">
          <div><strong>${mine.length}</strong><small>Submitted</small></div>
          <div><strong>${ok}</strong><small>Approved</small></div>
          <div><strong>${no}</strong><small>Rejected</small></div>
        </div>
      </div>`;
  }).join("") : '<div class="empty"><strong>No students yet</strong>Registered students will appear here.</div>';
}

// ---------- Export ----------
function exportCSV() {
  const ideas = getIdeas();
  if (!ideas.length) { showToast("No suggestions to export yet."); return; }
  const cell = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  const rows = [["Title", "Category", "Status", "Student", "Student ID", "Agree", "Disagree", "Comments", "Submitted", "Updated"]];
  ideas.forEach(i => {
    const u = getUsers().find(x => x.id === i.authorId);
    rows.push([i.title, i.category, statusLabel(i.status), u?.name || "", u?.studentId || "",
      voteCount(i, "Agree"), voteCount(i, "Disagree"), (i.comments || []).length,
      formatDate(i.createdAt), formatDate(i.updatedAt || i.createdAt)]);
  });
  const csv = "\ufeff" + rows.map(r => r.map(cell).join(",")).join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = "campusvoice-suggestions.csv";
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("Exported to CSV.");
}

// ---------- INITIALIZATION ----------
async function initialize() {
  $("ideaModal").addEventListener("click", e => { if (e.target.id === "ideaModal") closeIdeaForm(); });
  $("decisionModal").addEventListener("click", e => { if (e.target.id === "decisionModal") closeDecision(); });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { closeIdeaForm(); closeDecision(); }
  });

  window.addEventListener("scroll", () => {
    $("toTop").classList.toggle("hidden", window.scrollY < 500 || !currentUser || isAdmin());
  });

  // Already logged in? (the server remembers the session)
  try {
    const { user } = await api("me");
    if (user) { await refresh(); enterApp(user); }
  } catch { /* stay on the login page */ }
}
initialize();
