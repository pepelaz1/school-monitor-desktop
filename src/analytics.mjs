export const subjects = [
  "Математика",
  "Русский язык",
  "Чтение",
  "Английский язык",
  "Окружающий мир",
  "Информатика",
  "Музыка",
  "Физкультура",
  "Школа в целом",
];
export const scales = [
  "Умные",
  "Добрые",
  "Красивые",
  "Со мной дружат",
  "Хорошо учатся",
];
export const criteria = ["Поход", "Олимпиада", "День рождения"];
export const moodNames = {
  red: "Чаще плохое",
  yellow: "Хорошее, но не люблю отвечать",
  green: "Отличное, люблю отвечать",
};
export const disclaimer =
  "Описательная обработка ответов. Пороги, диагнозы и нормативная интерпретация не применяются. Ключи методик и итоговые формулировки должен подтвердить психолог.";
export function validateAnswer(payload, student, classmates, steps) {
  if (!payload || typeof payload !== "object")
    throw Error("Некорректные ответы");
  const mood = {};
  for (const s of subjects) {
    const v = payload.mood?.[s];
    if (v && !moodNames[v]) throw Error("Неизвестный цвет");
    if (v) mood[s] = v;
  }
  const ladder = {};
  for (const s of scales) {
    const v = payload.ladder?.[s];
    if (v !== "" && v != null) {
      if (!Number.isInteger(Number(v)) || Number(v) < 1 || Number(v) > steps)
        throw Error("Ступень вне диапазона");
      ladder[s] = Number(v);
    }
  }
  const allowed = new Set(
    classmates.filter((x) => x.id !== student.id).map((x) => x.id),
  );
  const choices = {};
  const keys =
    student.grade === 1
      ? [...criteria.map((x) => x + "+"), "Кино-"]
      : criteria.flatMap((x) => [x + "+", x + "-"]);
  for (const k of keys) {
    const arr = payload.choices?.[k] || [];
    if (
      !Array.isArray(arr) ||
      arr.length > (k === "Кино-" ? 1 : 2) ||
      new Set(arr).size !== arr.length ||
      arr.some((x) => !allowed.has(x))
    )
      throw Error("Выберите разных одноклассников, кроме самого ученика");
    choices[k] = arr;
  }
  for (const c of criteria)
    if (
      (choices[c + "+"] || []).some((x) => (choices[c + "-"] || []).includes(x))
    )
      throw Error(
        "Один человек не может быть выбран и исключён в одном вопросе",
      );
  const note = String(payload.note || "").trim();
  if (note.length > 2000) throw Error("Примечание слишком длинное");
  return { mood, ladder, choices, note };
}
export function summarize(students, answers, waveId) {
  const ids = new Set(students.map((s) => s.id));
  const rows = answers.filter(
    (a) => a.wave_id === waveId && ids.has(a.student_id),
  );
  const mood = subjects.map((subject) => {
    const counts = { red: 0, yellow: 0, green: 0 };
    for (const a of rows) {
      const v = a.payload.mood?.[subject];
      if (v in counts) counts[v]++;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return { subject, counts, total };
  });
  const ladder = scales.map((scale) => {
    const values = rows
      .map((a) => a.payload.ladder?.[scale])
      .filter(Number.isFinite);
    return {
      scale,
      n: values.length,
      mean: values.length
        ? values.reduce((a, b) => a + b, 0) / values.length
        : null,
    };
  });
  return { answered: rows.length, total: students.length, mood, ladder };
}
export function matrix(students, answers, waveId, criterion) {
  const ids = new Set(students.map((s) => s.id)),
    edges = [];
  for (const a of answers.filter(
    (a) => a.wave_id === waveId && ids.has(a.student_id),
  ))
    for (const to of a.payload.choices?.[criterion] || [])
      if (ids.has(to) && to !== a.student_id)
        edges.push({ from: a.student_id, to });
  const links = new Set(edges.map((e) => e.from + ">" + e.to));
  return {
    edges,
    people: students.map((s) => ({
      ...s,
      incoming: edges.filter((e) => e.to === s.id).length,
      outgoing: edges.filter((e) => e.from === s.id).length,
    })),
    mutualPairs: edges.filter(
      (e) => links.has(e.to + ">" + e.from) && e.from < e.to,
    ).length,
  };
}
export function csvCell(x) {
  let s = String(x ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
