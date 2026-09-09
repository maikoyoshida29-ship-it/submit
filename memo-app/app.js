(() => {
  "use strict";

  const STORAGE_KEY = "kanmem-v1";
  const TAB_IDS = ["shopping", "planned", "todo", "other"];
  const THEME = { shopping: "#E07656", planned: "#C47B3A", todo: "#3A6B8C", other: "#5B8A6E" };
  const PLACEHOLDER = {
    shopping: "買うものを入力",
    planned: "何を買う予定？",
    todo: "やることを入力",
    other: "メモを入力",
  };
  const EMPTY = {
    shopping: { mark: "🛒", title: "買うものはまだありません", hint: "下の欄に入力するか、マイクで話してください。買い物は「、」で区切るとまとめて追加できます。" },
    planned: { mark: "💰", title: "買う予定はまだありません", hint: "品名と金額を入れて、なる早・いつか・日付からいつごろ買うかを選べます。" },
    todo: { mark: "✅", title: "やることはまだありません", hint: "リマインドを付けると、時間になったとき通知します。" },
    other: { mark: "📝", title: "メモはまだありません", hint: "思いついたことを、音声でも文字でも残せます。" },
  };

  const els = {
    app: document.getElementById("app"),
    list: document.getElementById("list"),
    tabs: document.querySelectorAll(".tab"),
    form: document.getElementById("addForm"),
    input: document.getElementById("textInput"),
    micBtn: document.getElementById("micBtn"),
    remindBar: document.getElementById("remindBar"),
    remindChip: document.getElementById("remindChip"),
    remindChipLabel: document.getElementById("remindChipLabel"),
    remindClear: document.getElementById("remindClear"),
    plannedBar: document.getElementById("plannedBar"),
    whenRow: document.getElementById("whenRow"),
    plannedDate: document.getElementById("plannedDate"),
    amountInput: document.getElementById("amountInput"),
    plannedOverlay: document.getElementById("plannedOverlay"),
    plannedItemText: document.getElementById("plannedItemText"),
    plannedEditAmount: document.getElementById("plannedEditAmount"),
    plannedEditWhen: document.getElementById("plannedEditWhen"),
    plannedEditDate: document.getElementById("plannedEditDate"),
    plannedEditSave: document.getElementById("plannedEditSave"),
    plannedEditCancel: document.getElementById("plannedEditCancel"),
    listenOverlay: document.getElementById("listenOverlay"),
    listenText: document.getElementById("listenText"),
    listenCancel: document.getElementById("listenCancel"),
    sheetOverlay: document.getElementById("sheetOverlay"),
    sheetItemText: document.getElementById("sheetItemText"),
    sheetDateTime: document.getElementById("sheetDateTime"),
    sheetSave: document.getElementById("sheetSave"),
    sheetCancel: document.getElementById("sheetCancel"),
    sheetRemove: document.getElementById("sheetRemove"),
    installOverlay: document.getElementById("installOverlay"),
    installHintBtn: document.getElementById("installHintBtn"),
    installClose: document.getElementById("installClose"),
    toast: document.getElementById("toast"),
    theme: document.querySelector('meta[name="theme-color"]'),
  };

  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  const timers = new Map();
  let recognition = null;
  let listening = false;
  let toastTimer = 0;
  let sheetTarget = null;
  let plannedEditId = null;
  let plannedEditWhenType = "someday";
  let composerWhen = "someday";

  const state = load();

  function uid() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  }

  function load() {
    const fallback = { tab: "shopping", items: { shopping: [], planned: [], todo: [], other: [] }, composerRemindAt: null };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const data = JSON.parse(raw);
      return {
        tab: TAB_IDS.includes(data.tab) ? data.tab : "shopping",
        items: {
          shopping: Array.isArray(data.items?.shopping) ? data.items.shopping : [],
          planned: Array.isArray(data.items?.planned) ? data.items.planned : [],
          todo: Array.isArray(data.items?.todo) ? data.items.todo : [],
          other: Array.isArray(data.items?.other) ? data.items.other : [],
        },
        composerRemindAt: data.composerRemindAt || null,
      };
    } catch {
      return fallback;
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function todayDate() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function toLocalInput(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatRemind(ts) {
    const d = new Date(ts);
    const now = new Date();
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = Math.round((target - today) / 86400000);
    if (diff === 0) return `今日 ${time}`;
    if (diff === 1) return `明日 ${time}`;
    if (diff === -1) return `昨日 ${time}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
  }

  function formatYen(n) {
    return `¥${Math.round(n).toLocaleString("ja-JP")}`;
  }

  function parseYen(str) {
    if (str == null) return null;
    const raw = String(str).trim();
    if (!raw) return null;
    const cleaned = raw.replace(/,/g, "").replace(/\s/g, "").replace(/円/g, "");
    const man = cleaned.match(/^(\d+(?:\.\d+)?)万$/);
    if (man) return Math.round(parseFloat(man[1]) * 10000);
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n);
  }

  function extractFromText(raw) {
    let text = raw.trim();
    let amount = null;
    const man = text.match(/(\d+(?:\.\d+)?)\s*万\s*円?/);
    if (man) {
      amount = Math.round(parseFloat(man[1]) * 10000);
      text = text.replace(man[0], " ").replace(/\s+/g, " ").trim();
      return { text, amount };
    }
    const yen = text.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*円/);
    if (yen) {
      amount = parseInt(yen[1].replace(/,/g, ""), 10);
      text = text.replace(yen[0], " ").replace(/\s+/g, " ").trim();
    }
    return { text, amount };
  }

  function formatWhen(item) {
    if (item.whenType === "asap") return "なる早";
    if (item.whenType === "date" && item.whenDate) {
      const [y, m, d] = item.whenDate.split("-").map(Number);
      const label = `${m}/${d}ごろ`;
      return isPastDate(item.whenDate) ? `予定日過ぎ · ${label}` : label;
    }
    return "いつか";
  }

  function isPastDate(iso) {
    return Boolean(iso) && iso < todayDate();
  }

  function whenRank(item) {
    if (item.whenType === "asap") return 0;
    if (item.whenType === "date") return 1;
    return 2;
  }

  function quickTime(kind) {
    const d = new Date();
    if (kind === "1h") return d.getTime() + 60 * 60 * 1000;
    if (kind === "tonight") {
      d.setHours(20, 0, 0, 0);
      if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
      return d.getTime();
    }
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.getTime();
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      els.toast.hidden = true;
    }, 2800);
  }

  function setWhenButtons(row, type) {
    row.querySelectorAll(".when-btn").forEach((btn) => {
      btn.classList.toggle("is-on", btn.dataset.when === type);
    });
  }

  function syncComposerWhen() {
    setWhenButtons(els.whenRow, composerWhen);
    els.plannedDate.hidden = composerWhen !== "date";
    els.app.dataset.when = composerWhen;
    if (composerWhen === "date" && !els.plannedDate.value) els.plannedDate.value = todayDate();
  }

  function currentComposerWhen() {
    if (composerWhen === "date") {
      return { whenType: "date", whenDate: els.plannedDate.value || todayDate() };
    }
    return { whenType: composerWhen, whenDate: null };
  }

  function setTab(tab) {
    state.tab = tab;
    els.app.dataset.tab = tab;
    if (els.theme) els.theme.setAttribute("content", THEME[tab]);
    els.tabs.forEach((btn) => {
      const on = btn.dataset.tab === tab;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    els.remindBar.hidden = tab !== "todo";
    els.plannedBar.hidden = tab !== "planned";
    els.input.placeholder = PLACEHOLDER[tab];
    if (tab === "planned") syncComposerWhen();
    save();
    render();
  }

  function sorted(tab) {
    const items = state.items[tab].slice();
    if (tab === "planned") {
      items.sort((a, b) =>
        Number(a.done) - Number(b.done)
        || whenRank(a) - whenRank(b)
        || String(a.whenDate || "9999-99-99").localeCompare(String(b.whenDate || "9999-99-99"))
        || b.createdAt - a.createdAt
      );
      return items;
    }
    items.sort((a, b) => Number(a.done) - Number(b.done) || b.createdAt - a.createdAt);
    return items;
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function plannedTotalHtml(items) {
    const open = items.filter((item) => !item.done);
    const done = items.filter((item) => item.done);
    const sum = (list) => list.reduce((total, item) => total + (Number(item.amount) || 0), 0);
    const openSum = sum(open);
    const doneSum = sum(done);
    const missing = open.some((item) => item.amount == null);
    return `
      <div class="total-card">
        <div>
          <span class="total-label">未購入の合計</span>
          ${doneSum ? `<p class="total-sub">購入済み ${escapeHtml(formatYen(doneSum))}</p>` : ""}
          ${missing ? `<p class="total-sub">金額未入力あり</p>` : ""}
        </div>
        <strong class="total-value">${escapeHtml(formatYen(openSum))}</strong>
      </div>`;
  }

  function render() {
    const tab = state.tab;
    const items = sorted(tab);
    const openCount = items.filter((item) => !item.done).length;
    const doneCount = items.filter((item) => item.done).length;

    if (!items.length) {
      const empty = EMPTY[tab];
      const total = tab === "planned" ? plannedTotalHtml([]) : "";
      els.list.innerHTML = `
        ${total}
        <div class="empty">
          <div class="empty-mark">${empty.mark}</div>
          <h2>${empty.title}</h2>
          <p>${empty.hint}</p>
        </div>`;
      updateRemindChip();
      return;
    }

    const rows = items
      .map((item) => {
        const overdueTodo = tab === "todo" && item.remindAt && !item.done && item.remindAt <= Date.now();
        const overduePlan = tab === "planned" && !item.done && item.whenType === "date" && isPastDate(item.whenDate);
        let meta = "";
        if (tab === "todo" && item.remindAt) {
          meta = `<p class="item-meta${overdueTodo ? " is-overdue" : ""}">${overdueTodo ? "期限切れ · " : ""}${escapeHtml(formatRemind(item.remindAt))}</p>`;
        } else if (tab === "planned") {
          meta = `<p class="item-meta${overduePlan ? " is-overdue" : ""}">${escapeHtml(formatWhen(item))}</p>`;
        }
        const amount = tab === "planned"
          ? `<p class="item-amount">${item.amount == null ? "金額未入力" : escapeHtml(formatYen(item.amount))}</p>`
          : "";
        const bell = tab === "todo"
          ? `<button type="button" class="mini-btn${item.remindAt ? " is-on" : ""}" data-act="remind" data-id="${item.id}" aria-label="リマインド">${item.remindAt ? "🔔" : "🔕"}</button>`
          : "";
        const edit = tab === "planned"
          ? `<button type="button" class="mini-btn is-on" data-act="edit-planned" data-id="${item.id}" aria-label="金額と時期を編集">¥</button>`
          : "";
        return `
          <article class="item${item.done ? " is-done" : ""}" data-id="${item.id}">
            <button type="button" class="check" data-act="toggle" data-id="${item.id}" aria-label="${item.done ? "未完了に戻す" : "完了する"}">
              <span class="check-dot"></span>
            </button>
            <div class="item-body">
              <p class="item-text">${escapeHtml(item.text)}</p>
              ${amount}
              ${meta}
            </div>
            <div class="item-actions">
              ${bell}
              ${edit}
              <button type="button" class="mini-btn" data-act="delete" data-id="${item.id}" aria-label="削除">🗑</button>
            </div>
          </article>`;
      })
      .join("");

    const clear = doneCount
      ? `<button type="button" class="linkish" id="clearDone">完了した${doneCount}件を消す</button>`
      : `<span></span>`;
    const total = tab === "planned" ? plannedTotalHtml(items) : "";

    els.list.innerHTML = `
      ${total}
      <div class="meta-row">
        <span>${openCount}件</span>
        ${clear}
      </div>
      <div class="card">${rows}</div>`;
    updateRemindChip();
  }

  function updateRemindChip() {
    if (state.composerRemindAt) {
      els.remindChipLabel.textContent = formatRemind(state.composerRemindAt);
      els.remindClear.hidden = false;
    } else {
      els.remindChipLabel.textContent = "リマインドを付ける";
      els.remindClear.hidden = true;
    }
  }

  function addItems(texts, extra = {}) {
    const tab = state.tab;
    const cleaned = texts.map((t) => t.trim()).filter(Boolean);
    if (!cleaned.length) return;
    for (const text of cleaned) {
      const item = {
        id: uid(),
        text,
        done: false,
        createdAt: Date.now(),
        remindAt: tab === "todo" ? extra.remindAt || null : null,
        notifiedAt: null,
      };
      if (tab === "planned") {
        item.amount = extra.amount ?? null;
        item.whenType = extra.whenType || "someday";
        item.whenDate = extra.whenType === "date" ? extra.whenDate || todayDate() : null;
      }
      state.items[tab].push(item);
    }
    if (tab === "todo") state.composerRemindAt = null;
    if (tab === "planned") els.amountInput.value = "";
    save();
    scheduleReminders();
    render();
    if (navigator.vibrate) navigator.vibrate(12);
    showToast(cleaned.length > 1 ? `${cleaned.length}件追加しました` : "追加しました");
  }

  function findItem(id) {
    for (const tab of Object.keys(state.items)) {
      const item = state.items[tab].find((entry) => entry.id === id);
      if (item) return { tab, item };
    }
    return null;
  }

  function toggleItem(id) {
    const found = findItem(id);
    if (!found) return;
    found.item.done = !found.item.done;
    save();
    scheduleReminders();
    render();
  }

  function deleteItem(id) {
    const found = findItem(id);
    if (!found) return;
    state.items[found.tab] = state.items[found.tab].filter((entry) => entry.id !== id);
    save();
    scheduleReminders();
    render();
    showToast("削除しました");
  }

  function clearDone() {
    const tab = state.tab;
    state.items[tab] = state.items[tab].filter((item) => !item.done);
    save();
    render();
  }

  function openPlannedEdit(item) {
    plannedEditId = item.id;
    plannedEditWhenType = item.whenType || "someday";
    els.plannedItemText.textContent = item.text;
    els.plannedEditAmount.value = item.amount == null ? "" : String(item.amount);
    els.plannedEditDate.value = item.whenDate || todayDate();
    els.plannedEditDate.hidden = plannedEditWhenType !== "date";
    setWhenButtons(els.plannedEditWhen, plannedEditWhenType);
    els.plannedOverlay.hidden = false;
  }

  function closePlannedEdit() {
    plannedEditId = null;
    els.plannedOverlay.hidden = true;
  }

  function savePlannedEdit() {
    const found = findItem(plannedEditId);
    if (!found) return;
    found.item.amount = parseYen(els.plannedEditAmount.value);
    found.item.whenType = plannedEditWhenType;
    found.item.whenDate = plannedEditWhenType === "date" ? els.plannedEditDate.value || todayDate() : null;
    save();
    render();
    closePlannedEdit();
    showToast("保存しました");
  }

  async function ensureNotifyPermission() {
    if (!("Notification" in window)) {
      showToast("このブラウザは通知に対応していません");
      return false;
    }
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") {
      showToast("通知がブロックされています。設定から許可してください");
      return false;
    }
    const result = await Notification.requestPermission();
    return result === "granted";
  }

  async function notify(title, body, tag) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const payload = { type: "NOTIFY", title, body, tag, tab: "todo" };
    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage(payload);
      return;
    }
    const ready = navigator.serviceWorker ? await navigator.serviceWorker.ready.catch(() => null) : null;
    if (ready) {
      ready.active?.postMessage(payload);
      return;
    }
    new Notification(title, { body, tag, lang: "ja" });
  }

  function onReminder(id) {
    const found = findItem(id);
    if (!found || found.item.done) return;
    found.item.notifiedAt = Date.now();
    save();
    notify("やることの時間です", found.item.text, id);
    showToast(`リマインド: ${found.item.text}`);
    render();
  }

  function scheduleReminders() {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    const now = Date.now();
    for (const item of state.items.todo) {
      if (item.done || !item.remindAt) continue;
      if (item.remindAt <= now) {
        if (!item.notifiedAt) onReminder(item.id);
        continue;
      }
      const delay = item.remindAt - now;
      if (delay > 2147483647) {
        timers.set(item.id, window.setTimeout(scheduleReminders, 2147483647));
      } else {
        timers.set(item.id, window.setTimeout(() => onReminder(item.id), delay));
      }
    }
  }

  function splitVoice(text) {
    if (state.tab !== "shopping") return [text.trim()].filter(Boolean);
    return text.split(/[、,，\n]+/).map((part) => part.trim()).filter(Boolean);
  }

  function submitComposer(rawText) {
    const text = rawText.trim();
    if (!text) return false;
    if (state.tab === "planned") {
      const parsed = extractFromText(text);
      const amount = parseYen(els.amountInput.value);
      addItems([parsed.text || text], {
        amount: amount ?? parsed.amount,
        ...currentComposerWhen(),
      });
      return true;
    }
    addItems(
      state.tab === "shopping" ? splitVoice(text) : [text],
      { remindAt: state.tab === "todo" ? state.composerRemindAt : null }
    );
    return true;
  }

  function openSheet(item) {
    sheetTarget = item ? { kind: "item", id: item.id } : { kind: "composer" };
    const current = item?.remindAt || state.composerRemindAt || Date.now() + 60 * 60 * 1000;
    els.sheetItemText.textContent = item ? item.text : "新しく追加するやること";
    els.sheetDateTime.value = toLocalInput(current);
    els.sheetOverlay.hidden = false;
  }

  function closeSheet() {
    sheetTarget = null;
    els.sheetOverlay.hidden = true;
  }

  async function applyRemindAt(ts) {
    if (!sheetTarget) return;
    if (ts && ts <= Date.now()) {
      showToast("未来の日時を選んでください");
      return;
    }
    if (ts) {
      const ok = await ensureNotifyPermission();
      if (!ok) showToast("アプリを開いているときに、画面でもお知らせします");
    }
    if (sheetTarget.kind === "composer") {
      state.composerRemindAt = ts;
      save();
      updateRemindChip();
    } else {
      const found = findItem(sheetTarget.id);
      if (found) {
        found.item.remindAt = ts;
        found.item.notifiedAt = null;
        save();
        scheduleReminders();
        render();
      }
    }
    closeSheet();
    if (ts) showToast(`${formatRemind(ts)} に通知します`);
    else showToast("リマインドを解除しました");
  }

  function startListen() {
    if (!Speech) {
      showToast("このブラウザでは音声入力に対応していません");
      return;
    }
    if (listening) {
      stopListen();
      return;
    }
    recognition = new Speech();
    recognition.lang = "ja-JP";
    recognition.interimResults = true;
    recognition.continuous = false;
    listening = true;
    els.micBtn.classList.add("is-on");
    els.listenOverlay.hidden = false;
    els.listenText.textContent = "話してください";
    recognition.onresult = (event) => {
      let transcript = "";
      for (const result of event.results) transcript += result[0].transcript;
      els.listenText.textContent = transcript || "話してください";
      const last = event.results[event.results.length - 1];
      if (last.isFinal) {
        const text = transcript.trim();
        stopListen();
        if (!text) return;
        if (state.tab === "planned") {
          const parsed = extractFromText(text);
          els.input.value = parsed.text || text;
          if (parsed.amount != null) els.amountInput.value = String(parsed.amount);
          els.amountInput.focus();
          showToast("金額を確認して追加してください");
          return;
        }
        els.input.value = text;
        submitComposer(text);
        els.input.value = "";
      }
    };
    recognition.onerror = () => {
      stopListen();
      showToast("音声を認識できませんでした");
    };
    recognition.onend = () => {
      if (listening) stopListen();
    };
    try {
      recognition.start();
    } catch {
      stopListen();
    }
  }

  function stopListen() {
    listening = false;
    els.micBtn.classList.remove("is-on");
    els.listenOverlay.hidden = true;
    try {
      recognition?.stop();
    } catch {
      /* ignore */
    }
    recognition = null;
  }

  els.tabs.forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
  });

  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!submitComposer(els.input.value)) return;
    els.input.value = "";
    els.input.focus();
  });

  els.list.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-act]");
    if (btn) {
      const { act, id } = btn.dataset;
      if (act === "toggle") toggleItem(id);
      if (act === "delete") deleteItem(id);
      if (act === "remind") {
        const found = findItem(id);
        if (found) openSheet(found.item);
      }
      if (act === "edit-planned") {
        const found = findItem(id);
        if (found) openPlannedEdit(found.item);
      }
      return;
    }
    if (event.target.id === "clearDone") clearDone();
  });

  els.whenRow.addEventListener("click", (event) => {
    const btn = event.target.closest(".when-btn");
    if (!btn) return;
    composerWhen = btn.dataset.when;
    syncComposerWhen();
    if (composerWhen === "date") els.plannedDate.focus();
  });

  els.plannedEditWhen.addEventListener("click", (event) => {
    const btn = event.target.closest(".when-btn");
    if (!btn) return;
    plannedEditWhenType = btn.dataset.when;
    setWhenButtons(els.plannedEditWhen, plannedEditWhenType);
    els.plannedEditDate.hidden = plannedEditWhenType !== "date";
    if (plannedEditWhenType === "date" && !els.plannedEditDate.value) els.plannedEditDate.value = todayDate();
  });

  els.micBtn.addEventListener("click", startListen);
  els.listenCancel.addEventListener("click", stopListen);
  els.remindChip.addEventListener("click", () => openSheet(null));
  els.remindClear.addEventListener("click", () => {
    state.composerRemindAt = null;
    save();
    updateRemindChip();
  });

  els.sheetOverlay.addEventListener("click", (event) => {
    if (event.target === els.sheetOverlay) closeSheet();
  });
  els.sheetCancel.addEventListener("click", closeSheet);
  els.sheetSave.addEventListener("click", () => {
    const value = els.sheetDateTime.value;
    applyRemindAt(value ? new Date(value).getTime() : null);
  });
  els.sheetRemove.addEventListener("click", () => applyRemindAt(null));
  els.sheetOverlay.querySelectorAll("[data-quick]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ts = quickTime(btn.dataset.quick);
      els.sheetDateTime.value = toLocalInput(ts);
    });
  });

  els.plannedEditSave.addEventListener("click", savePlannedEdit);
  els.plannedEditCancel.addEventListener("click", closePlannedEdit);
  els.plannedOverlay.addEventListener("click", (event) => {
    if (event.target === els.plannedOverlay) closePlannedEdit();
  });

  els.installHintBtn.addEventListener("click", () => {
    els.installOverlay.hidden = false;
  });
  els.installClose.addEventListener("click", () => {
    els.installOverlay.hidden = true;
  });
  els.installOverlay.addEventListener("click", (event) => {
    if (event.target === els.installOverlay) els.installOverlay.hidden = true;
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") scheduleReminders();
  });

  if (navigator.serviceWorker) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "OPEN_TAB") setTab(event.data.tab || "todo");
    });
  }

  if (!Speech) {
    els.micBtn.disabled = true;
    els.micBtn.title = "このブラウザでは音声入力に対応していません";
  }

  const params = new URLSearchParams(location.search);
  if (TAB_IDS.includes(params.get("tab"))) state.tab = params.get("tab");

  setTab(state.tab);
  scheduleReminders();
})();
