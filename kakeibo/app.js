(() => {
  const CATEGORIES = [
    "食費（スーパー）",
    "外食・カフェ",
    "日用品",
    "交通・Suicaチャージ",
    "衣服・美容",
    "医療・健康",
    "習い事・ジム（自分）",
    "子ども・学校（教材費など）",
    "子ども・習い事・用品",
    "通信・サブスク",
    "水道光熱",
    "住居",
    "保険",
    "交際費・プレゼント",
    "趣味・娯楽",
    "旅行・帰省",
    "家具・家電",
    "事業費（立替）",
    "事業費（ビジネスカード）",
    "分割・リボの返済",
    "その他",
  ];
  const QUICK_CATS = [
    "食費（スーパー）",
    "外食・カフェ",
    "日用品",
    "交通・Suicaチャージ",
    "子ども・学校（教材費など）",
    "子ども・習い事・用品",
    "その他",
  ];
  const CAT_WORDS = [
    ["食費（スーパー）", /スーパー|ライフ|いなげや|自販機|コンビニ|食材|野菜/],
    ["外食・カフェ", /カフェ|スタバ|外食|レストラン|ランチ|マック|牛丼|ラーメン/],
    ["日用品", /ドラッグストア|薬局|洗剤|日用|ティッシュ/],
    ["交通・Suicaチャージ", /スイカ|Suica|交通|チャージ|電車|バス|タクシー|駐車場/i],
    ["子ども・習い事・用品", /スイミング|習い事|月謝/],
    ["子ども・学校（教材費など）", /学校|教材|学費/],
    ["医療・健康", /病院|診療|歯科|クリニック|薬/],
    ["衣服・美容", /服|ユニクロ|美容|髪/],
    ["交際費・プレゼント", /プレゼント|交際|贈/],
    ["趣味・娯楽", /映画|ゲーム|趣味|娯楽/],
    ["住居", /家賃|住居/],
    ["水道光熱", /電気|ガス|水道/],
  ];
  const OLD_CAT = {
    食費: "食費（スーパー）",
    交通: "交通・Suicaチャージ",
    娯楽: "趣味・娯楽",
    医療: "医療・健康",
    衣服: "衣服・美容",
    交際: "交際費・プレゼント",
    子ども: "子ども・習い事・用品",
  };
  const DB_NAME = "kakeibo-cash";
  const DB_VER = 1;
  const LS_KEY = "kakeibo-expenses-v1";

  const $ = (id) => document.getElementById(id);
  const state = {
    expenses: [],
    shotFile: null,
    voiceCat: "",
    shotCat: "",
    manCat: "",
    range: "month",
    detailId: null,
  };

  function nfkc(s) {
    return String(s || "").normalize("NFKC").trim();
  }

  function yen(n) {
    return Number(n || 0).toLocaleString("ja-JP");
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function nowHM() {
    const d = new Date();
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function monthKey(iso) {
    return String(iso || "").slice(0, 7);
  }

  function parseAmount(text) {
    const t = nfkc(text).replace(/,/g, "").replace(/[¥￥]/g, "").replace(/\s/g, "");
    const manSen = t.match(/(\d+(?:\.\d+)?)万(\d+)?千?(\d*)円?/);
    if (manSen && /万/.test(t)) {
      let n = parseFloat(manSen[1]) * 10000;
      if (manSen[2]) n += parseInt(manSen[2], 10) * 1000;
      if (manSen[3]) n += parseInt(manSen[3], 10);
      return Math.round(n);
    }
    const sen = t.match(/(\d+)千円/);
    if (sen) return parseInt(sen[1], 10) * 1000;
    const yenMatch = t.match(/(\d+)円/);
    if (yenMatch) return parseInt(yenMatch[1], 10);
    const bare = t.match(/(\d{1,7})/);
    if (bare) return parseInt(bare[1], 10);
    return null;
  }

  function guessCategory(text) {
    const t = nfkc(text);
    if (!t) return "";
    for (const [cat, re] of CAT_WORDS) {
      if (re.test(t)) return cat;
    }
    return "";
  }

  function normalizeCategory(cat) {
    if (!cat) return "";
    if (CATEGORIES.includes(cat)) return cat;
    return OLD_CAT[cat] || cat;
  }

  function itemTitle(e) {
    return e.title || e.memo || "";
  }

  function itemMemo(e) {
    return e.title ? e.memo || "" : "";
  }

  function parseQuickInput(text) {
    let s = nfkc(text).replace(/,/g, "").replace(/[¥￥]/g, " ");
    const year = new Date().getFullYear();
    let date = todayISO();
    s = s.replace(/(?:(\d{4})[-\/年])?(\d{1,2})[\/\-月](\d{1,2})日?/, (_, y, m, d) => {
      date = `${y ? parseInt(y, 10) : year}-${pad(parseInt(m, 10))}-${pad(parseInt(d, 10))}`;
      return " ";
    });
    s = s.replace(/\s+/g, " ").trim();

    let amount = null;
    let raw = "";
    let index = -1;
    const man = s.match(/(\d+(?:\.\d+)?)万(\d+)?千?(\d*)円?/);
    if (man && /万/.test(man[0])) {
      let n = parseFloat(man[1]) * 10000;
      if (man[2]) n += parseInt(man[2], 10) * 1000;
      if (man[3]) n += parseInt(man[3], 10);
      amount = Math.round(n);
      raw = man[0];
      index = man.index;
    } else {
      const withYen = s.match(/(\d+)円/);
      const nums = [...s.matchAll(/(\d{1,7})/g)];
      const hit = withYen || (nums.length ? nums[nums.length - 1] : null);
      if (hit) {
        amount = parseInt(hit[1], 10);
        raw = hit[0];
        index = hit.index;
      }
    }

    let title = "";
    let memo = "";
    if (index >= 0) {
      title = s.slice(0, index).trim();
      memo = s.slice(index + raw.length).trim();
    } else {
      title = s;
    }
    title = title.replace(/円$/g, "").trim();
    memo = memo.replace(/^円\s*/, "").trim();
    const category = guessCategory(`${title} ${memo}`);
    return { date, amount, title, memo, category, raw: nfkc(text) };
  }

  function loadExpenses() {
    try {
      state.expenses = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    } catch {
      state.expenses = [];
    }
    state.expenses = state.expenses.map((e) => {
      if (!e.title && e.memo) return { ...e, title: e.memo, memo: "" };
      return e;
    });
  }

  function saveExpenses() {
    localStorage.setItem(LS_KEY, JSON.stringify(state.expenses));
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("images")) db.createObjectStore("images");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function putImage(id, blob) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("images", "readwrite");
      tx.objectStore("images").put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getImage(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("images", "readonly");
      const req = tx.objectStore("images").get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteImage(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("images", "readwrite");
      tx.objectStore("images").delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function compressImage(file) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const max = 1600;
        let { width, height } = img;
        if (width > max || height > max) {
          const scale = max / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url);
            resolve(blob || file);
          },
          "image/jpeg",
          0.82
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(file);
      };
      img.src = url;
    });
  }

  function addExpense(partial) {
    const item = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      date: partial.date || todayISO(),
      time: partial.time || nowHM(),
      amount: Number(partial.amount) || 0,
      title: nfkc(partial.title) || "",
      category: normalizeCategory(partial.category || ""),
      memo: nfkc(partial.memo) || "",
      source: partial.source,
      transcript: partial.transcript || "",
      imageId: partial.imageId || null,
      createdAt: new Date().toISOString(),
    };
    state.expenses.unshift(item);
    saveExpenses();
    render();
    return item;
  }

  function monthItems() {
    const key = monthKey(todayISO());
    return state.expenses.filter((e) => monthKey(e.date) === key);
  }

  function rangeItems() {
    const now = new Date();
    if (state.range === "all") return state.expenses.slice();
    if (state.range === "week") {
      const start = new Date(now);
      const day = (start.getDay() + 6) % 7;
      start.setDate(start.getDate() - day);
      start.setHours(0, 0, 0, 0);
      return state.expenses.filter((e) => new Date(`${e.date}T00:00:00`) >= start);
    }
    return monthItems();
  }

  function sourceLabel(src) {
    return { voice: "音声", screenshot: "スクショ", manual: "入力" }[src] || src;
  }

  function render() {
    const items = monthItems();
    const total = items.reduce((s, e) => s + Number(e.amount || 0), 0);
    const d = new Date();
    $("monthLabel").textContent = `${d.getMonth() + 1}月の現金支出`;
    $("monthTotal").textContent = yen(total);
    $("monthCount").textContent = `${items.length}件`;

    const list = $("list");
    const recent = state.expenses.slice(0, 40);
    if (!recent.length) {
      list.innerHTML = `<div class="empty">まだ記録がありません。<br>上のボタンから追加してください。</div>`;
      return;
    }
    list.innerHTML = recent
      .map((e) => {
        const img = e.imageId ? `<img class="thumb" data-thumb="${e.imageId}" alt="" />` : "";
        const title = itemTitle(e);
        const cat = normalizeCategory(e.category);
        return `<button class="item${e.imageId ? " has-img" : ""}" data-id="${e.id}" type="button">
          ${img}
          <div>
            <div class="memo">${escapeHtml(title || "（内容なし）")}</div>
            <div class="meta">${e.date} ${e.time}${cat ? " · " + escapeHtml(cat) : ""}</div>
          </div>
          <div>
            <div class="yen">¥${yen(e.amount)}</div>
            <div class="src">${sourceLabel(e.source)}</div>
          </div>
        </button>`;
      })
      .join("");
    list.querySelectorAll("[data-id]").forEach((btn) => {
      btn.addEventListener("click", () => openDetail(btn.getAttribute("data-id")));
    });
    list.querySelectorAll("[data-thumb]").forEach(async (img) => {
      const blob = await getImage(img.getAttribute("data-thumb"));
      if (blob) img.src = URL.createObjectURL(blob);
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderCats(container, selected, onPick) {
    const rest = CATEGORIES.filter((c) => !QUICK_CATS.includes(c));
    const emptyOn = !selected;
    container.innerHTML = `
      <button type="button" class="chip${emptyOn ? " on" : ""}" data-cat="">空欄（あとで）</button>
      <div class="cats-quick">
        ${QUICK_CATS.map(
          (c) =>
            `<button type="button" class="chip big${c === selected ? " on" : ""}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`
        ).join("")}
      </div>
      <div class="cats-rest">
        ${rest
          .map(
            (c) =>
              `<button type="button" class="chip${c === selected ? " on" : ""}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`
          )
          .join("")}
      </div>`;
    container.querySelectorAll("[data-cat]").forEach((btn) => {
      btn.addEventListener("click", () => onPick(btn.getAttribute("data-cat") || ""));
    });
  }

  function bindCats(containerId, key) {
    const paint = () =>
      renderCats($(containerId), state[key], (c) => {
        state[key] = c;
        paint();
      });
    paint();
  }

  function openDialog(id) {
    $(id).showModal();
  }

  function closeDialog(id) {
    if ($(id).open) $(id).close();
  }

  function applyVoiceParse() {
    const parsed = parseQuickInput($("voiceText").value);
    $("voiceDate").value = parsed.date;
    $("voiceAmount").value = parsed.amount != null ? String(parsed.amount) : "";
    $("voiceTitle").value = parsed.title;
    $("voiceMemo").value = parsed.memo;
    state.voiceCat = parsed.category || "";
    bindCats("voiceCats", "voiceCat");
    $("voicePreview").innerHTML = parsed.amount
      ? `<b>読み取り</b>${parsed.date} · ¥${yen(parsed.amount)}<br>${escapeHtml(parsed.title || "（内容を入れてください）")}${parsed.memo ? "<br>メモ: " + escapeHtml(parsed.memo) : ""}`
      : `<b>読み取り</b>金額がまだ取れていません。「ライフ 1200」のように数字を入れてください。`;
    return parsed;
  }

  function setupVoice() {
    $("voiceText").addEventListener("input", applyVoiceParse);
    $("voiceSave").onclick = () => {
      const amount = parseAmount($("voiceAmount").value);
      const title = nfkc($("voiceTitle").value);
      if (!amount) {
        $("voiceAmount").focus();
        return;
      }
      if (!title) {
        $("voiceTitle").focus();
        return;
      }
      addExpense({
        date: $("voiceDate").value || todayISO(),
        amount,
        title,
        memo: nfkc($("voiceMemo").value),
        category: state.voiceCat,
        source: "voice",
        transcript: nfkc($("voiceText").value),
      });
      $("voiceText").value = "";
      closeDialog("voiceDlg");
    };
  }

  function setupShot() {
    const bindFile = (input, btn) => {
      btn.onclick = () => input.click();
      input.onchange = async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        state.shotFile = await compressImage(file);
        const url = URL.createObjectURL(state.shotFile);
        $("shotPreview").src = url;
        $("shotPreview").classList.add("show");
      };
    };
    bindFile($("fileCamera"), $("shotCamera"));
    bindFile($("fileAlbum"), $("shotAlbum"));
    $("shotSave").onclick = async () => {
      const amount = parseAmount($("shotAmount").value);
      const title = nfkc($("shotTitle").value);
      if (!amount) {
        $("shotAmount").focus();
        return;
      }
      if (!title) {
        $("shotTitle").focus();
        return;
      }
      let imageId = null;
      if (state.shotFile) {
        imageId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
        await putImage(imageId, state.shotFile);
      }
      addExpense({
        amount,
        title,
        memo: nfkc($("shotMemo").value),
        category: state.shotCat,
        source: "screenshot",
        imageId,
      });
      state.shotFile = null;
      $("shotAmount").value = "";
      $("shotTitle").value = "";
      $("shotMemo").value = "";
      $("shotPreview").classList.remove("show");
      closeDialog("shotDlg");
    };
  }

  function setupManual() {
    $("manSave").onclick = () => {
      const amount = parseAmount($("manAmount").value);
      const title = nfkc($("manTitle").value);
      if (!amount) {
        $("manAmount").focus();
        return;
      }
      if (!title) {
        $("manTitle").focus();
        return;
      }
      addExpense({
        date: $("manDate").value || todayISO(),
        amount,
        title,
        memo: nfkc($("manMemo").value),
        category: state.manCat,
        source: "manual",
      });
      $("manAmount").value = "";
      $("manTitle").value = "";
      $("manMemo").value = "";
      closeDialog("manualDlg");
    };
  }

  async function openDetail(id) {
    const item = state.expenses.find((e) => e.id === id);
    if (!item) return;
    state.detailId = id;
    const cat = normalizeCategory(item.category);
    $("detailBody").innerHTML = `<b>${escapeHtml(itemTitle(item))}</b><br>¥${yen(item.amount)}${cat ? " · " + escapeHtml(cat) : ""}<br>${item.date} ${item.time} · ${sourceLabel(item.source)}${itemMemo(item) ? `<br>メモ: ${escapeHtml(itemMemo(item))}` : ""}${item.transcript ? `<br>ひとこと: ${escapeHtml(item.transcript)}` : ""}`;
    const img = $("detailImg");
    img.classList.remove("show");
    img.removeAttribute("src");
    if (item.imageId) {
      const blob = await getImage(item.imageId);
      if (blob) {
        img.src = URL.createObjectURL(blob);
        img.classList.add("show");
      }
    }
    openDialog("detailDlg");
  }

  function csvEscape(v) {
    const s = String(v ?? "");
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function exportRows(items) {
    return items
      .slice()
      .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")))
      .map((e) => ({
        日付: e.date,
        金額: Math.round(Number(e.amount) || 0),
        内容: itemTitle(e),
        カテゴリ: normalizeCategory(e.category),
        メモ: itemMemo(e),
      }));
  }

  function buildCsv(items) {
    const rows = exportRows(items);
    const lines = ["日付,金額,内容,カテゴリ,メモ"];
    for (const r of rows) {
      lines.push([r.日付, String(r.金額), r.内容, r.カテゴリ, r.メモ].map(csvEscape).join(","));
    }
    return lines.join("\n") + "\n";
  }

  function csvFileName(items) {
    if (state.range === "all") return "現金_すべて.csv";
    const key = items[0] ? monthKey(items[0].date) : monthKey(todayISO());
    return `現金_${key}.csv`;
  }

  function setupShare() {
    const setRange = (range) => {
      state.range = range;
      renderRange();
    };
    const renderRange = () => {
      const labels = [
        ["month", "今月"],
        ["week", "今週"],
        ["all", "全部"],
      ];
      $("rangeChips").innerHTML = labels
        .map(
          ([id, label]) =>
            `<button type="button" class="chip${state.range === id ? " on" : ""}" data-range="${id}">${label}</button>`
        )
        .join("");
      $("rangeChips").querySelectorAll("[data-range]").forEach((btn) => {
        btn.onclick = () => setRange(btn.getAttribute("data-range"));
      });
      $("sharePreview").value = buildCsv(rangeItems());
    };
    $("btnShare").onclick = () => {
      renderRange();
      openDialog("shareDlg");
    };
    $("doCopy").onclick = async () => {
      const csv = buildCsv(rangeItems());
      try {
        await navigator.clipboard.writeText(csv);
        $("doCopy").textContent = "コピーしました";
        setTimeout(() => {
          $("doCopy").textContent = "テキストをコピー";
        }, 1500);
      } catch {
        $("sharePreview").select();
        document.execCommand("copy");
      }
    };
    $("doShare").onclick = async () => {
      const items = rangeItems();
      const csv = buildCsv(items);
      const file = new File(["\uFEFF" + csv], csvFileName(items), { type: "text/csv" });
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: file.name });
          return;
        }
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
      try {
        if (navigator.share) {
          await navigator.share({ title: file.name, text: csv });
          return;
        }
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(file);
      a.download = file.name;
      a.click();
    };
  }

  function setupInstallHint() {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
    if (!standalone) $("installHint").hidden = false;
  }

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.onclick = () => closeDialog(btn.getAttribute("data-close"));
  });
  document.querySelectorAll("dialog").forEach((dlg) => {
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) dlg.close();
    });
  });

  $("btnVoice").onclick = () => {
    $("voiceText").value = "";
    $("voiceDate").value = todayISO();
    $("voiceAmount").value = "";
    $("voiceTitle").value = "";
    $("voiceMemo").value = "";
    state.voiceCat = "";
    bindCats("voiceCats", "voiceCat");
    applyVoiceParse();
    openDialog("voiceDlg");
    setTimeout(() => $("voiceText").focus(), 250);
  };
  $("btnShot").onclick = () => {
    state.shotFile = null;
    state.shotCat = "";
    $("shotAmount").value = "";
    $("shotTitle").value = "";
    $("shotMemo").value = "";
    $("shotPreview").classList.remove("show");
    bindCats("shotCats", "shotCat");
    openDialog("shotDlg");
  };
  $("btnManual").onclick = () => {
    state.manCat = "";
    $("manDate").value = todayISO();
    $("manAmount").value = "";
    $("manTitle").value = "";
    $("manMemo").value = "";
    bindCats("manCats", "manCat");
    openDialog("manualDlg");
  };
  $("detailDelete").onclick = async () => {
    const item = state.expenses.find((e) => e.id === state.detailId);
    if (item && item.imageId) await deleteImage(item.imageId);
    state.expenses = state.expenses.filter((e) => e.id !== state.detailId);
    saveExpenses();
    closeDialog("detailDlg");
    render();
  };

  loadExpenses();
  saveExpenses();
  setupVoice();
  setupShot();
  setupManual();
  setupShare();
  setupInstallHint();
  render();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
})();
