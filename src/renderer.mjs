import {
  subjects,
  scales,
  criteria,
  moodNames,
  disclaimer,
  summarize,
  matrix,
} from "./analytics.mjs";
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let state,
  tab = "overview",
  selectedClass = "",
  waveId = "",
  editing = "",
  criterion = "Поход+",
  comment = "";
const titles = {
  overview: "Обзор класса",
  students: "Ученики и анкеты",
  social: "Матрица выборов",
  history: "Динамика обследований",
  settings: "База и правила",
};
async function call(action, data) {
  try {
    return await window.monitor.call(action, data);
  } catch (e) {
    const msg = e.message.replace(
      /^Error invoking remote method '[^']+': Error: /,
      "",
    );
    $("#notice").textContent = msg;
    throw Error(msg);
  }
}
async function refresh(next) {
  state = next || (await call("state"));
  const classes = [...new Set(state.students.map((s) => s.class_name))].sort(
    (a, b) => a.localeCompare(b, "ru"),
  );
  if (!classes.includes(selectedClass)) selectedClass = classes[0] || "";
  if (!state.waves.some((w) => w.id === waveId))
    waveId = state.waves[0]?.id || "";
  $("#class-select").innerHTML = classes.length
    ? classes
        .map(
          (c) =>
            `<option ${c === selectedClass ? "selected" : ""}>${esc(c)}</option>`,
        )
        .join("")
    : '<option value="">Нет классов</option>';
  $("#wave-select").innerHTML = state.waves.length
    ? state.waves
        .map(
          (w) =>
            `<option value="${esc(w.id)}" ${w.id === waveId ? "selected" : ""}>${esc(w.title)} · ${esc(w.date)}</option>`,
        )
        .join("")
    : '<option value="">Нет обследований</option>';
  render();
}
function group() {
  return state.students.filter((s) => s.class_name === selectedClass);
}
function options(values, value) {
  return (
    '<option value="">Не указано</option>' +
    values
      .map(
        ([v, t]) =>
          `<option value="${esc(v)}" ${String(value) === String(v) ? "selected" : ""}>${esc(t)}</option>`,
      )
      .join("")
  );
}
function empty() {
  return '<div class="panel empty"><span class="eyebrow">НАЧНИТЕ С КЛАССА</span><h2>Подготовьте первое обследование</h2><p class="hint">Добавьте ученика с классом и создайте обследование.<br>Ответы будут сохраняться в выбранной локальной базе.</p></div>';
}
function moodPanel(sum) {
  return `<div class="panel"><div class="panel-head"><h2>Настроение на уроках</h2><span class="pill">Распределение ответов</span></div><div class="legend"><span><i class="dot red"></i>Красный</span><span><i class="dot yellow"></i>Жёлтый</span><span><i class="dot green"></i>Зелёный</span></div>${sum.mood
    .map(
      (m) =>
        `<div class="bar-row"><span>${esc(m.subject)}</span><div class="bar" aria-label="${esc(m.subject)}: ${Object.entries(
          m.counts,
        )
          .map(([c, v]) => moodNames[c] + " " + v)
          .join(
            ", ",
          )}">${["red", "yellow", "green"].map((c) => `<i class="${c}" style="width:${m.total ? (m.counts[c] / m.total) * 100 : 0}%" title="${moodNames[c]}: ${m.counts[c]}"></i>`).join("")}</div><span class="subtle">${m.total}</span></div>`,
    )
    .join(
      "",
    )}<div class="hint">Число справа — ответы по предмету. Пропуски исключены из долей.</div></div>`;
}
function ladderPanel(sum) {
  return `<div class="panel"><div class="panel-head"><h2>Самооценка · «лесенка»</h2><span class="pill">1–${state.steps}</span></div>${sum.ladder.map((l) => `<div class="scale-row"><div class="scale-top"><span>${esc(l.scale)}</span><span>${l.mean === null ? "—" : l.mean.toFixed(1)} <span class="subtle">/ ${state.steps} · n=${l.n}</span></span></div><div class="scale-track"><div class="scale-fill" style="width:${l.mean === null ? 0 : (l.mean / state.steps) * 100}%"></div></div></div>`).join("")}<div class="tip">Показываем среднюю выбранную ступень. Шкала 1–${state.steps} предварительная: число ступеней и направление нужно сверить с бланком. Уровни «низкий / высокий» не присваиваются.</div></div>`;
}
function render() {
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $("#page-title").textContent = titles[tab];
  const students = group(),
    sum = summarize(students, state.answers, waveId),
    content = $("#content");
  if (tab === "settings") {
    renderSettings();
    return;
  }
  if (!students.length || !waveId) {
    content.innerHTML = empty();
    return;
  }
  if (tab === "overview") {
    content.innerHTML = `<div class="cards"><div class="card"><div class="label">Учеников в классе</div><div class="metric">${sum.total}</div><div class="hint">${esc(selectedClass)} класс · текущий состав</div></div><div class="card"><div class="label">Сохранено анкет</div><div class="metric">${sum.answered}<small> / ${sum.total}</small></div><div class="progress"><i style="width:${sum.total ? (sum.answered / sum.total) * 100 : 0}%"></i></div></div><div class="card"><div class="label">Обследований в базе</div><div class="metric">${state.waves.length}</div><div class="hint">История сохраняется по датам</div></div></div><div class="grid">${moodPanel(sum)}${ladderPanel(sum)}</div><div class="panel"><div class="panel-head"><h2>Справка по обследованию</h2><div class="row-actions"><button id="export-csv" class="secondary">Экспорт CSV</button><button id="export-pdf">Сохранить PDF</button></div></div><p class="hint">${esc(disclaimer)}</p><label>Комментарий специалиста для PDF (в базе не сохраняется)<textarea id="report-comment" class="comment-box" maxlength="4000" placeholder="Контекст проведения, наблюдения, рекомендации специалиста…">${esc(comment)}</textarea></label></div>`;
    $("#report-comment").oninput = (e) => (comment = e.target.value);
    $("#export-csv").onclick = () => exportFile("csv");
    $("#export-pdf").onclick = () => exportFile("pdf");
  }
  if (tab === "students") {
    content.innerHTML = `<div class="panel"><div class="panel-head"><h2>Список класса <span class="subtle">${esc(selectedClass)}</span></h2><input class="search" id="student-search" placeholder="Найти ученика" aria-label="Поиск ученика"></div><table><thead><tr><th>Ученик</th><th>Параллель</th><th>Анкета</th><th></th></tr></thead><tbody id="student-rows">${students
      .map((s, i) => {
        const a = state.answers.find(
          (a) => a.student_id === s.id && a.wave_id === waveId,
        );
        return `<tr data-name="${esc(s.name.toLowerCase())}"><td><span class="num">${String(i + 1).padStart(2, "0")}</span>${esc(s.name)}</td><td>${s.grade} класс</td><td><span class="status ${a ? "" : "missing"}">${a ? "Сохранена" : "Нет ответов"}</span></td><td><button class="secondary" data-edit="${esc(s.id)}">${a ? "Открыть анкету" : "Ввести ответы"}</button></td></tr>`;
      })
      .join(
        "",
      )}</tbody></table><p class="hint">«Сохранена» означает наличие записи, а не полную заполненность всех вопросов.</p></div>`;
    document
      .querySelectorAll("[data-edit]")
      .forEach((b) => (b.onclick = () => edit(b.dataset.edit)));
    $("#student-search").oninput = (e) =>
      document
        .querySelectorAll("#student-rows tr")
        .forEach(
          (r) =>
            (r.hidden = !r.dataset.name.includes(e.target.value.toLowerCase())),
        );
  }
  if (tab === "social") {
    const keys =
      students[0].grade === 1
        ? [...criteria.map((c) => c + "+"), "Кино-"]
        : criteria.flatMap((c) => [c + "+", c + "-"]);
    if (!keys.includes(criterion)) criterion = keys[0];
    const m = matrix(students, state.answers, waveId, criterion);
    content.innerHTML = `<div class="panel"><div class="panel-head"><h2>Кто кого выбирает</h2><span class="pill">${m.edges.length} выборов · ${m.mutualPairs} взаимных пар</span></div><div class="split"><label>Вопрос<select id="criterion">${keys.map((c) => `<option ${c === criterion ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label><p class="hint">+ кого выбрали · − кого исключили.<br>Строка — отвечающий, столбец — выбранный.</p></div><table class="matrix"><thead><tr><th>Ученик</th>${students.map((s, i) => `<th title="${esc(s.name)}">${i + 1}</th>`).join("")}<th>Выбрал</th></tr></thead><tbody>${students.map((s, i) => `<tr><td>${i + 1}. ${esc(s.name)}</td>${students.map((t) => (s.id === t.id ? '<td class="self">—</td>' : m.edges.some((e) => e.from === s.id && e.to === t.id) ? `<td class="hit ${criterion.endsWith("-") ? "negative" : ""}">1</td>` : "<td>·</td>")).join("")}<td>${m.people.find((p) => p.id === s.id).outgoing}</td></tr>`).join("")}<tr><th>Получил выборов</th>${m.people.map((p) => `<th>${p.incoming}</th>`).join("")}<th></th></tr></tbody></table><div class="tip">Ноль входящих выборов — только наблюдаемый результат этого вопроса. Он не означает диагноз или устойчивый социальный статус. Незаполненные анкеты, состав класса и условия обследования влияют на результат.</div></div>`;
    $("#criterion").onchange = (e) => {
      criterion = e.target.value;
      render();
    };
  }
  if (tab === "history") {
    content.innerHTML = `<div class="panel"><h2>Сравнение по времени · ${esc(selectedClass)}</h2><p class="hint">Каждый период считается отдельно. Сравнивайте число ответивших и состав класса; эти средние не являются парным анализом одних и тех же детей.</p><table><thead><tr><th>Обследование</th><th>Анкет</th>${scales.map((s) => `<th>${esc(s)}</th>`).join("")}</tr></thead><tbody>${state.waves
      .map((w) => {
        const x = summarize(students, state.answers, w.id);
        return `<tr><td>${esc(w.title)}<br><span class="subtle">${esc(w.date)}</span></td><td>${x.answered}/${x.total}</td>${x.ladder.map((l) => `<td>${l.mean === null ? "—" : l.mean.toFixed(2)}<br><span class="subtle">n=${l.n}</span></td>`).join("")}</tr>`;
      })
      .join("")}</tbody></table></div><div class="history-grid">${state.waves
      .slice(0, 2)
      .map((w) => {
        const x = summarize(students, state.answers, w.id);
        return `<div>${moodPanel(x)}<p class="hint">${esc(w.title)} · ${esc(w.date)}</p></div>`;
      })
      .join("")}</div>`;
  }
}
function renderSettings() {
  $("#content").innerHTML =
    `<div class="panel setting-block"><h2>Файл базы данных</h2><p class="path">${esc(state.path)}</p><p class="hint">${state.demo ? "Сейчас открыт отдельный демонстрационный файл с вымышленными данными." : "Рабочая база. Файл содержит имена и ответы учеников."} Новая база создаётся пустой; данные не передаются в интернет.</p><button id="new-db">Новая пустая база</button><button id="open-db" class="secondary">Открыть базу / копию</button><button id="backup-db" class="secondary">Сделать копию</button><div class="tip">База не зашифрована приложением. Используйте защищённую учётную запись, шифрование диска и безопасное место для копий. CSV и PDF также могут содержать персональные данные.</div></div><div class="panel setting-block"><h2>Правила обработки · версия 0.1</h2><ol class="number-list"><li>Настроение: число и доля каждого цвета по предмету. Пропуски не включаются в знаменатель. «Школа в целом» — отдельный вопрос (для 1 класса: настроение в понедельник).</li><li>Лесенка: исходная ступень и среднее по шкале, без нормативных границ. 1 — нижняя ступень, ${state.steps} — верхняя.</li><li>Социометрия: отдельные матрицы по вопросам, входящие/исходящие выборы, взаимные пары. Суммарный «рейтинг детей» не строится.</li><li>Динамика: описательные сводки каждого периода с числом ответов, без вывода о достоверности изменений.</li><li>Заключение и рекомендации пишет специалист. В приложенных анкетах нет полного ключа обработки; правила предварительные.</li></ol><label>Число ступеней (меняется только в базе без ответов)<select id="steps">${Array.from(
      { length: 8 },
      (_, i) => i + 3,
    )
      .map(
        (n) => `<option ${n === state.steps ? "selected" : ""}>${n}</option>`,
      )
      .join(
        "",
      )}</select></label><button id="save-steps" class="secondary">Сохранить шкалу</button></div>`;
  $("#new-db").onclick = newDb;
  $("#open-db").onclick = async () => {
    try {
      const s = await call("open");
      if (s) {
        comment = "";
        await refresh(s);
      }
    } catch {}
  };
  $("#backup-db").onclick = backup;
  $("#save-steps").onclick = async () => {
    try {
      await refresh(await call("steps", { steps: Number($("#steps").value) }));
      $("#notice").textContent = "Шкала сохранена";
    } catch {}
  };
}
async function backup() {
  try {
    if (await call("backup"))
      $("#notice").textContent = "Резервная копия сохранена";
  } catch {}
}
async function newDb() {
  try {
    const s = await call("new");
    if (s) {
      comment = "";
      await refresh(s);
      $("#notice").textContent =
        "Пустая рабочая база создана. Добавьте учеников и обследование.";
    }
  } catch {}
}
async function exportFile(action) {
  try {
    if (await call(action, { className: selectedClass, waveId, comment }))
      $("#notice").textContent =
        action === "pdf"
          ? "Справка PDF сохранена"
          : "CSV сохранён; файл открывается в Excel";
  } catch {}
}
function edit(id) {
  editing = id;
  const s = state.students.find((s) => s.id === id),
    a =
      state.answers.find((a) => a.student_id === id && a.wave_id === waveId)
        ?.payload || {},
    keys =
      s.grade === 1
        ? [...criteria.map((c) => c + "+"), "Кино-"]
        : criteria.flatMap((c) => [c + "+", c + "-"]);
  $("#edit-title").textContent = s.name + " · " + s.class_name;
  $("#edit-error").textContent = "";
  $("#answer-fields").innerHTML =
    `<div class="section-title">01 / Настроение</div><p class="hint">Красный — чаще плохое. Жёлтый — хорошее, не люблю отвечать у доски. Зелёный — отличное, люблю отвечать. Общий вопрос школы вводится отдельно.</p><div class="mood-fields">${subjects.map((x, i) => `<label>${esc(x === "Школа в целом" && s.grade === 1 ? "Понедельник в школе" : x)}<select name="m${i}">${options(Object.entries(moodNames), a.mood?.[x])}</select></label>`).join("")}</div><div class="section-title">02 / Лесенка · от 1 снизу до ${state.steps} сверху</div><div class="ladder-fields">${scales
      .map(
        (x, i) =>
          `<label>${esc(x)}<select name="l${i}">${options(
            Array.from({ length: state.steps }, (_, i) => [
              i + 1,
              String(i + 1),
            ]),
            a.ladder?.[x],
          )}</select></label>`,
      )
      .join(
        "",
      )}</div><div class="section-title">03 / Выборы одноклассников</div><div class="choice-fields">${keys
      .map(
        (k, i) =>
          `<label>${esc(k === "Кино-" ? "Кому не хватило билета в кино" : k.replace("+", " · выбрали").replace("-", " · не выбрали"))}<div class="choice">${Array.from(
            { length: k === "Кино-" ? 1 : 2 },
            (_, j) =>
              `<select name="c${i}_${j}" aria-label="${esc(k)} выбор ${j + 1}">${options(
                group()
                  .filter((t) => t.id !== id)
                  .map((t) => [t.id, t.name]),
                a.choices?.[k]?.[j],
              )}</select>`,
          ).join("")}</div></label>`,
      )
      .join(
        "",
      )}</div><div class="section-title">Примечание сотрудника</div><textarea name="note" maxlength="2000" class="comment-box">${esc(a.note)}</textarea>`;
  $("#answer-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target),
      payload = { mood: {}, ladder: {}, choices: {}, note: f.get("note") };
    subjects.forEach((x, i) => {
      if (f.get("m" + i)) payload.mood[x] = f.get("m" + i);
    });
    scales.forEach((x, i) => {
      if (f.get("l" + i)) payload.ladder[x] = Number(f.get("l" + i));
    });
    keys.forEach(
      (k, i) =>
        (payload.choices[k] = [
          f.get("c" + i + "_0"),
          f.get("c" + i + "_1"),
        ].filter(Boolean)),
    );
    try {
      const st = await call("answer", { studentId: editing, waveId, payload });
      $("#editor").close();
      await refresh(st);
      $("#notice").textContent = "Ответы сохранены";
    } catch (e) {
      $("#edit-error").textContent = e.message;
    }
  };
  $("#editor").showModal();
}
function simple(kind) {
  const student = kind === "student";
  $("#simple-title").textContent = student
    ? "Добавить ученика"
    : "Новое обследование";
  $("#simple-error").textContent = "";
  $("#simple-fields").innerHTML = student
    ? `<label>Имя или код ученика<input name="name" required maxlength="100" autocomplete="off"></label><label>Класс<input name="className" required maxlength="30" value="${esc(selectedClass)}" placeholder="Например, 1А"></label><label>Параллель<select name="grade">${[1, 2, 3, 4].map((n) => `<option value="${n}">${n} класс</option>`).join("")}</select></label>`
    : `<label>Название<input name="title" required maxlength="100" placeholder="Например, начало учебного года"></label><label>Дата<input name="date" type="date" required value="${new Date().toLocaleDateString("en-CA")}"></label>`;
  if (student && group().length)
    $("#simple-fields select").value = group()[0].grade;
  $("#simple-form").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const f = Object.fromEntries(new FormData(e.target));
      const st = await call(kind, f);
      if (student) selectedClass = f.className.trim();
      else
        waveId =
          st.waves.find((w) => w.title === f.title.trim() && w.date === f.date)
            ?.id || "";
      $("#simple").close();
      await refresh(st);
    } catch (e) {
      $("#simple-error").textContent = e.message;
    }
  };
  $("#simple").showModal();
}
document.querySelectorAll("[data-tab]").forEach(
  (b) =>
    (b.onclick = () => {
      tab = b.dataset.tab;
      $("#notice").textContent = "";
      render();
    }),
);
$("#class-select").onchange = (e) => {
  selectedClass = e.target.value;
  comment = "";
  render();
};
$("#wave-select").onchange = (e) => {
  waveId = e.target.value;
  comment = "";
  render();
};
$("#backup").onclick = backup;
$("#add-wave").onclick = () => simple("wave");
$("#add-student").onclick = () => simple("student");
$("#close-editor").onclick = () => $("#editor").close();
$("#simple-cancel").onclick = () => $("#simple").close();
refresh().catch((e) => ($("#content").textContent = e.message));
