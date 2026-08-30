(() => {
  const CATEGORIES = ["食費", "日用品", "交通", "娯楽", "医療", "衣服", "交際", "子ども", "住居", "その他"];
  const CAT_WORDS = [
    ["食費", /コンビニ|スーパー|弁当|ランチ|ご飯|ごはん|カフェ|スタバ|飲食|八百屋|魚|肉|パン|野菜|食材|マクド|牛丼|ラーメン|寿司/],
    ["日用品", /ドラッグストア|薬局|洗剤|日用|ティッシュ|トイレ|無印/],
    ["交通", /電車|バス|タクシー|駐車場|ガソリン|IC|スイカ|パスモ/],
    ["娯楽", /映画|ゲーム|本|趣味|娯楽|マンガ|漫画/],
    ["医療", /病院|診療|薬|歯科|クリニック/],
    ["衣服", /服|ユニクロ|靴|衣服/],
    ["交際", /贈|会食|プレゼント|交際/],
    ["子ども", /子供|子ども|学|保育園|幼稚園/],
    ["住居", /家賃|電気|ガス|水道|住居/],
  ];
  const DB_NAME = "kakeibo-cash";
  const DB_VER = 1;
  const LS_KEY = "kakeibo-expenses-v1";

  const $ = (id) => document.getElementById(id);
  const state = {
    expenses: [],
    shotFile: null,
    shotCat: "食費",
    manCat: "食費",
    range: "month",
    detailId: null,
    recognition: null,
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
    const bare = t.match(/(\d{2,7})/);
    if (bare) return parseInt(bare[1], 10);
    return null;
  }

  function guessCategory(text) {
    const t = nfkc(text);
    for (const [cat, re] of CAT_WORDS) {
      if (re.test(t)) return cat;
    }
    return "その他";
  }

  function memoFromSpeech(text, amount) {
    let t = nfkc(text);
    t = t.replace(/(\d+(?:\.\d+)?)万(\d+)?千?(\d*)円?/g, "");
    t = t.replace(/\d+千円/g, "").replace(/\d{1,7}円/g, "");
    t = t.replace(/\d{2,7}/g, "");
    t = t.replace(/円|現金|支払っ[たて]|使った|です|ます/g, "");
    t = t.replace(/[、。,.]+/g, " ").replace(/\s+/g, " ").trim();
    return t || (amount ? `${yen(amount)}円の支出` : "現金支出");
  }

  function parseSpeech(text) {
    const amount = parseAmount(text);
    const category = guessCategory(text);
    const memo = memoFromSpeech(text, amount);
    return { amount, category, memo, raw: nfkc(text) };
  }

  function loadExpenses() {
    try {
      state.expenses = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    } catch {
      state.expenses = [];
    }
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
      category: partial.category || "その他",
      memo: partial.memo || "",
      method: "現金",
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
        return `<button class="item${e.imageId ? " has-img" : ""}" data-id="${e.id}" type="button">
          ${img}
          <div>
            <div class="memo">${escapeHtml(e.memo || e.category)}</div>
            <div class="meta">${e.date} ${e.time} · ${escapeHtml(e.category)}</div>
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

  function renderChips(container, selected, onPick) {
    container.innerHTML = CATEGORIES.map(
      (c) => `<button type="button" class="chip${c === selected ? " on" : ""}" data-cat="${c}">${c}</button>`
    ).join("");
    container.querySelectorAll("[data-cat]").forEach((btn) => {
      btn.addEventListener("click", () => onPick(btn.getAttribute("data-cat")));
    });
  }

  function openDialog(id) {
    $(id).showModal();
  }

  function closeDialog(id) {
    if ($(id).open) $(id).close();
  }

  function updateVoicePreview() {
    const parsed = parseSpeech($("voiceText").value);
    $("voicePreview").innerHTML = parsed.amount
      ? `<b>読み取り</b>¥${yen(parsed.amount)} · ${escapeHtml(parsed.category)}<br>${escapeHtml(parsed.memo)}`
      : `<b>読み取り</b>金額がまだ取れていません。数字か「◯円」を入れてください。`;
    return parsed;
  }

  function setupVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      $("micBtn").hidden = false;
      $("micStatus").hidden = false;
      $("micStatus").textContent = "マイクボタンでも話せます";
      const rec = new SR();
      rec.lang = "ja-JP";
      rec.interimResults = true;
      rec.continuous = false;
      rec.onresult = (ev) => {
        let text = "";
        for (const res of ev.results) text += res[0].transcript;
        $("voiceText").value = text;
        updateVoicePreview();
      };
      rec.onend = () => {
        $("micBtn").classList.remove("live");
        $("micStatus").textContent = "マイクボタンでも話せます";
      };
      rec.onerror = () => {
        $("micBtn").classList.remove("live");
        $("micStatus").textContent = "音声認識が使えません。キーボードのマイクを使ってください";
      };
      state.recognition = rec;
      $("micBtn").onclick = () => {
        try {
          rec.start();
          $("micBtn").classList.add("live");
          $("micStatus").textContent = "聞いています…";
        } catch {
          rec.stop();
        }
      };
    }
    $("voiceText").addEventListener("input", updateVoicePreview);
    $("voiceSave").onclick = () => {
      const parsed = updateVoicePreview();
      if (!parsed.amount) {
        $("voiceText").focus();
        return;
      }
      addExpense({
        amount: parsed.amount,
        category: parsed.category,
        memo: parsed.memo,
        source: "voice",
        transcript: parsed.raw,
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
      if (!amount) {
        $("shotAmount").focus();
        return;
      }
      let imageId = null;
      if (state.shotFile) {
        imageId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
        await putImage(imageId, state.shotFile);
      }
      addExpense({
        amount,
        category: state.shotCat,
        memo: nfkc($("shotMemo").value) || "レシート",
        source: "screenshot",
        imageId,
      });
      state.shotFile = null;
      $("shotAmount").value = "";
      $("shotMemo").value = "";
      $("shotPreview").classList.remove("show");
      closeDialog("shotDlg");
    };
  }

  function setupManual() {
    $("manSave").onclick = () => {
      const amount = parseAmount($("manAmount").value);
      if (!amount) {
        $("manAmount").focus();
        return;
      }
      addExpense({
        date: $("manDate").value || todayISO(),
        amount,
        category: state.manCat,
        memo: nfkc($("manMemo").value) || state.manCat,
        source: "manual",
      });
      $("manAmount").value = "";
      $("manMemo").value = "";
      closeDialog("manualDlg");
    };
  }

  async function openDetail(id) {
    const item = state.expenses.find((e) => e.id === id);
    if (!item) return;
    state.detailId = id;
    $("detailBody").innerHTML = `<b>${escapeHtml(item.memo)}</b><br>¥${yen(item.amount)} · ${escapeHtml(item.category)}<br>${item.date} ${item.time} · ${sourceLabel(item.source)}${item.transcript ? `<br>音声: ${escapeHtml(item.transcript)}` : ""}`;
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

  function buildMarkdown(items) {
    const total = items.reduce((s, e) => s + Number(e.amount || 0), 0);
    const byCat = {};
    for (const e of items) {
      byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount || 0);
    }
    const catLines = Object.entries(byCat)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `- ${k}: ¥${yen(v)}`)
      .join("\n");
    const rows = items
      .slice()
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
      .map(
        (e) =>
          `| ${e.date} | ${e.time} | ${e.amount} | ${e.category} | ${e.memo.replace(/\|/g, "/")} | ${sourceLabel(e.source)} | ${e.imageId ? "あり" : ""} |`
      )
      .join("\n");
    return `# 現金支出メモ

期間の合計: **¥${yen(total)}**（${items.length}件）
支払方法: 現金

## カテゴリ内訳
${catLines || "- なし"}

## 明細
| 日付 | 時刻 | 金額 | カテゴリ | メモ | 入力 | スクショ |
|---|---|---:|---|---|---|---|
${rows || "| | | | | | | |"}

---
このファイルはスマホの「現金メモ」アプリから書き出した現金支出です。家計の現金出納に反映してください。スクショがある場合は添付画像も一緒に見て、金額・店名を照合してください。
`;
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
      $("sharePreview").value = buildMarkdown(rangeItems());
    };
    $("btnShare").onclick = () => {
      renderRange();
      openDialog("shareDlg");
    };
    $("includeImages").onchange = () => renderRange();
    $("doCopy").onclick = async () => {
      const md = buildMarkdown(rangeItems());
      try {
        await navigator.clipboard.writeText(md);
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
      const md = buildMarkdown(items);
      const files = [
        new File([md], `現金支出_${todayISO()}.md`, { type: "text/markdown" }),
      ];
      if ($("includeImages").checked) {
        let i = 1;
        for (const e of items) {
          if (!e.imageId) continue;
          const blob = await getImage(e.imageId);
          if (!blob) continue;
          const ext = (blob.type || "").includes("png") ? "png" : "jpg";
          files.push(new File([blob], `スクショ_${e.date}_${i}.${ext}`, { type: blob.type || "image/jpeg" }));
          i += 1;
        }
      }
      try {
        if (navigator.canShare && navigator.canShare({ files })) {
          await navigator.share({ files, title: "現金支出メモ" });
          return;
        }
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
      try {
        if (navigator.share) {
          await navigator.share({ title: "現金支出メモ", text: md });
          return;
        }
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
      const blob = new Blob([md], { type: "text/markdown" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `現金支出_${todayISO()}.md`;
      a.click();
    };
    state.renderRange = renderRange;
  }

  function setupInstallHint() {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
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
    updateVoicePreview();
    openDialog("voiceDlg");
    setTimeout(() => $("voiceText").focus(), 250);
  };
  $("detailDelete").onclick = async () => {
    const item = state.expenses.find((e) => e.id === state.detailId);
    if (item && item.imageId) await deleteImage(item.imageId);
    state.expenses = state.expenses.filter((e) => e.id !== state.detailId);
    saveExpenses();
    closeDialog("detailDlg");
    render();
  };

  const bindCats = (containerId, key) => {
    const paint = () =>
      renderChips($(containerId), state[key], (c) => {
        state[key] = c;
        paint();
      });
    paint();
    return paint;
  };
  $("btnShot").onclick = () => {
    state.shotFile = null;
    state.shotCat = "食費";
    $("shotAmount").value = "";
    $("shotMemo").value = "";
    $("shotPreview").classList.remove("show");
    bindCats("shotCats", "shotCat");
    openDialog("shotDlg");
  };
  $("btnManual").onclick = () => {
    state.manCat = "食費";
    $("manDate").value = todayISO();
    $("manAmount").value = "";
    $("manMemo").value = "";
    bindCats("manCats", "manCat");
    openDialog("manualDlg");
  };

  loadExpenses();
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
