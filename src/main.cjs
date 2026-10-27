const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("node:path"),
  fs = require("node:fs"),
  { randomUUID } = require("node:crypto");
const initSql = require("sql.js"),
  { Store } = require("./store.cjs");
app.setName("SchoolMonitor");
let win, store, SQL, analytics;
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
function remember() {
  fs.writeFileSync(
    path.join(app.getPath("userData"), "workspace.json"),
    JSON.stringify({ path: store.path }),
    { mode: 0o600 },
  );
}
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function report(data) {
  const st = store.snapshot(),
    students = st.students.filter((s) => s.class_name === data.className),
    w = st.waves.find((w) => w.id === data.waveId);
  if (!w || !students.length) throw Error("Выберите класс и обследование");
  const summary = analytics.summarize(students, st.answers, w.id);
  return { st, students, w, summary };
}
app.whenReady().then(async () => {
  SQL = await initSql();
  analytics = await import("./analytics.mjs");
  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  try {
    const prior = JSON.parse(
      fs.readFileSync(path.join(dir, "workspace.json"), "utf8"),
    );
    if (fs.existsSync(prior.path)) {
      store = new Store(SQL, prior.path);
      store.snapshot();
    }
  } catch {
    store = null;
  }
  if (!store) {
    store = new Store(SQL, path.join(dir, "demo.sqlite"));
    store.seed();
  }
  win = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 950,
    minHeight: 650,
    backgroundColor: "#f2f5f9",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, "index.html"));
});
ipcMain.handle("monitor", async (event, action, data = {}) => {
  if (event.sender !== win.webContents) throw Error("Invalid sender");
  if (action === "state") return store.snapshot();
  if (action === "student") {
    const name = String(data.name || "").trim(),
      cn = String(data.className || "").trim(),
      grade = Number(data.grade);
    if (
      !name ||
      name.length > 100 ||
      !cn ||
      cn.length > 30 ||
      ![1, 2, 3, 4].includes(grade)
    )
      throw Error("Проверьте имя, класс и параллель");
    const same = store.query("SELECT * FROM students WHERE class_name=?", [cn]);
    if (same.some((s) => s.grade !== grade))
      throw Error("В одном классе должна быть одна параллель");
    if (same.some((s) => s.name.toLowerCase() === name.toLowerCase()))
      throw Error("Такой ученик уже есть");
    store.db.run("INSERT INTO students VALUES (?,?,?,?)", [
      randomUUID(),
      name,
      cn,
      grade,
    ]);
    store.flush();
    return store.snapshot();
  }
  if (action === "wave") {
    const title = String(data.title || "").trim(),
      date = String(data.date || "");
    if (
      !title ||
      title.length > 100 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date))
    )
      throw Error("Укажите название и дату");
    store.db.run("INSERT INTO waves VALUES (?,?,?)", [
      randomUUID(),
      title,
      date,
    ]);
    store.flush();
    return store.snapshot();
  }
  if (action === "answer") {
    const st = store.snapshot(),
      s = st.students.find((s) => s.id === data.studentId);
    if (!s || !st.waves.some((w) => w.id === data.waveId))
      throw Error("Ученик или обследование не найдены");
    const payload = analytics.validateAnswer(
      data.payload,
      s,
      st.students.filter((x) => x.class_name === s.class_name),
      st.steps,
    );
    store.db.run(
      "INSERT INTO answers VALUES (?,?,?) ON CONFLICT(wave_id,student_id) DO UPDATE SET payload=excluded.payload",
      [data.waveId, s.id, JSON.stringify(payload)],
    );
    store.flush();
    return store.snapshot();
  }
  if (action === "steps") {
    const n = Number(data.steps);
    if (!Number.isInteger(n) || n < 3 || n > 10)
      throw Error("Допустимо от 3 до 10 ступеней");
    if (store.query("SELECT * FROM answers").length)
      throw Error(
        "Число ступеней можно менять только до ввода ответов. Создайте отдельную базу для другой шкалы.",
      );
    store.db.run("UPDATE meta SET value=? WHERE key='steps'", [String(n)]);
    store.flush();
    return store.snapshot();
  }
  if (action === "new") {
    const r = await dialog.showSaveDialog(win, {
      title: "Создать пустую рабочую базу",
      defaultPath: path.join(app.getPath("documents"), "school-monitor.sqlite"),
      filters: [{ name: "SQLite", extensions: ["sqlite"] }],
    });
    if (r.canceled) return null;
    if (path.resolve(r.filePath) === path.resolve(store.path))
      throw Error("Выберите другое имя базы");
    if (fs.existsSync(r.filePath))
      throw Error(
        "Файл уже существует. Выберите новое имя — перезапись базы запрещена.",
      );
    const next = new Store(SQL, r.filePath);
    next.flush();
    store = next;
    remember();
    return store.snapshot();
  }
  if (action === "open") {
    const r = await dialog.showOpenDialog(win, {
      filters: [{ name: "SQLite", extensions: ["sqlite"] }],
      properties: ["openFile"],
    });
    if (r.canceled) return null;
    const p = r.filePaths[0];
    if (fs.statSync(p).size > 50 * 1024 * 1024)
      throw Error("Файл больше 50 МБ");
    const probe = new SQL.Database(fs.readFileSync(p));
    try {
      const check =
        probe
          .exec("SELECT name FROM sqlite_master WHERE type='table'")[0]
          ?.values.flat() || [];
      if (
        !["meta", "students", "waves", "answers"].every((t) =>
          check.includes(t),
        )
      )
        throw Error("Это не база Школьного мониторинга");
      probe.exec("SELECT grade FROM students LIMIT 1");
    } finally {
      probe.close();
    }
    const next = new Store(SQL, p);
    next.snapshot();
    store = next;
    remember();
    return store.snapshot();
  }
  if (action === "backup") {
    const r = await dialog.showSaveDialog(win, {
      defaultPath:
        "monitor-backup-" + new Date().toISOString().slice(0, 10) + ".sqlite",
      filters: [{ name: "SQLite", extensions: ["sqlite"] }],
    });
    if (r.canceled) return false;
    if (path.resolve(r.filePath) === path.resolve(store.path))
      throw Error("Копия должна иметь другое имя");
    fs.writeFileSync(r.filePath, store.bytes(), {
      mode: 0o600,
    });
    return true;
  }
  if (action === "csv") {
    const { st, students, w } = report(data);
    const rows = [
      [
        "Обследование",
        "Дата",
        "Класс",
        "Ученик",
        ...analytics.subjects,
        ...analytics.scales,
        "Примечание",
      ],
    ];
    for (const s of students) {
      const a =
        st.answers.find((a) => a.wave_id === w.id && a.student_id === s.id)
          ?.payload || {};
      rows.push([
        w.title,
        w.date,
        s.class_name,
        s.name,
        ...analytics.subjects.map(
          (x) => analytics.moodNames[a.mood?.[x]] || "",
        ),
        ...analytics.scales.map((x) => a.ladder?.[x] ?? ""),
        a.note || "",
      ]);
    }
    const r = await dialog.showSaveDialog(win, {
      defaultPath: "monitor.csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (r.canceled) return false;
    fs.writeFileSync(
      r.filePath,
      "\ufeff" +
        rows.map((r) => r.map(analytics.csvCell).join(";")).join("\r\n"),
      { mode: 0o600 },
    );
    return true;
  }
  if (action === "pdf") {
    const { st, students, w, summary } = report(data);
    let html =
      '<html lang="ru"><meta charset="utf-8"><title>Школьный мониторинг — справка</title><style>body{font:12px Arial;color:#173c3e;padding:24px}h1{font-size:25px}table{border-collapse:collapse;width:100%;margin:15px 0}td,th{border:1px solid #bbb;padding:7px;text-align:left}small{color:#667}h2{margin-top:25px;break-after:avoid}thead{display:table-header-group}tr{break-inside:avoid}</style><h1>Мониторинг · ' +
      esc(data.className) +
      "</h1><p>" +
      esc(w.title) +
      " · " +
      esc(w.date) +
      "</p><p>Ответы: " +
      summary.answered +
      " из " +
      summary.total +
      ". " +
      (st.demo ? "СИНТЕТИЧЕСКИЕ ДЕМОДАННЫЕ" : "") +
      "</p><p>" +
      esc(analytics.disclaimer) +
      "</p><h2>Настроение</h2><table><tr><th>Предмет</th><th>Красный</th><th>Жёлтый</th><th>Зелёный</th><th>Ответов</th></tr>" +
      summary.mood
        .map(
          (m) =>
            "<tr><td>" +
            esc(m.subject) +
            "</td>" +
            ["red", "yellow", "green"]
              .map(
                (c) =>
                  "<td>" +
                  m.counts[c] +
                  " (" +
                  (m.total ? Math.round((m.counts[c] / m.total) * 100) : 0) +
                  "%)</td>",
              )
              .join("") +
            "<td>" +
            m.total +
            "</td></tr>",
        )
        .join("") +
      "</table><h2>Лесенка</h2><p>Шкала 1–" +
      st.steps +
      ", снизу вверх. Число ступеней предварительное, сверить с бланком.</p><table><tr><th>Шкала</th><th>Среднее</th><th>Ответов</th></tr>" +
      summary.ladder
        .map(
          (l) =>
            "<tr><td>" +
            esc(l.scale) +
            "</td><td>" +
            (l.mean === null ? "—" : l.mean.toFixed(2)) +
            "</td><td>" +
            l.n +
            "</td></tr>",
        )
        .join("") +
      "</table><h2>Выборы одноклассников</h2><p>Число входящих выборов по отдельным вопросам. Не является оценкой личности или статусным диагнозом.</p>";
    const keys =
      students[0].grade === 1
        ? [...analytics.criteria.map((c) => c + "+"), "Кино-"]
        : analytics.criteria.flatMap((c) => [c + "+", c + "-"]);
    html +=
      "<table><tr><th>Ученик</th>" +
      keys.map((k) => "<th>" + esc(k) + "</th>").join("") +
      "</tr>" +
      students
        .map(
          (s) =>
            "<tr><td>" +
            esc(s.name) +
            "</td>" +
            keys
              .map(
                (k) =>
                  "<td>" +
                  analytics
                    .matrix(students, st.answers, w.id, k)
                    .people.find((p) => p.id === s.id).incoming +
                  "</td>",
              )
              .join("") +
            "</tr>",
        )
        .join("") +
      "</table><h2>Заключение специалиста</h2><p>" +
      esc(
        data.comment || "Не заполнено. Интерпретация выполняется психологом.",
      ) +
      "</p><small>Сформировано " +
      esc(new Date().toLocaleDateString("ru-RU")) +
      ". Состав класса и число заполненных анкет учитывать при сравнении периодов.</small></html>";
    const r = await dialog.showSaveDialog(win, {
      defaultPath: "monitor-report.pdf",
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (r.canceled) return false;
    const preview = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, nodeIntegration: false },
    });
    try {
      await preview.loadURL(
        "data:text/html;charset=utf-8," + encodeURIComponent(html),
      );
      fs.writeFileSync(
        r.filePath,
        await preview.webContents.printToPDF({
          pageSize: "A4",
          printBackground: true,
        }),
        { mode: 0o600 },
      );
    } finally {
      preview.destroy();
    }
    return true;
  }
  throw Error("Неизвестная операция");
});
app.on("window-all-closed", () => app.quit());
