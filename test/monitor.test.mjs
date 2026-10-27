import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import initSql from "sql.js";
import storePkg from "../src/store.cjs";
import {
  summarize,
  matrix,
  validateAnswer,
  csvCell,
} from "../src/analytics.mjs";
const pupils = [
  { id: "a", name: "A", class_name: "1А", grade: 1 },
  { id: "b", name: "B", class_name: "1А", grade: 1 },
  { id: "c", name: "C", class_name: "1А", grade: 1 },
];
test("counts ignore missing answers and unrelated classes/waves", () => {
  const rows = [
    {
      wave_id: "w",
      student_id: "a",
      payload: { mood: { Математика: "red" }, ladder: { Умные: 2 } },
    },
    {
      wave_id: "w",
      student_id: "b",
      payload: { mood: { Математика: "green" }, ladder: { Умные: 4 } },
    },
    {
      wave_id: "other",
      student_id: "c",
      payload: { mood: { Математика: "red" } },
    },
    {
      wave_id: "w",
      student_id: "foreign",
      payload: { mood: { Математика: "red" } },
    },
  ];
  const r = summarize(pupils, rows, "w");
  assert.equal(r.answered, 2);
  assert.equal(r.mood[0].total, 2);
  assert.deepEqual(r.mood[0].counts, { red: 1, yellow: 0, green: 1 });
  assert.equal(r.ladder[0].mean, 3);
  assert.equal(r.ladder[1].mean, null);
});
test("sociometry keeps questions separate and counts each mutual pair once", () => {
  const rows = [
    {
      wave_id: "w",
      student_id: "a",
      payload: { choices: { "Поход+": ["b"], "Кино-": ["c"] } },
    },
    {
      wave_id: "w",
      student_id: "b",
      payload: { choices: { "Поход+": ["a"] } },
    },
  ];
  const m = matrix(pupils, rows, "w", "Поход+");
  assert.equal(m.edges.length, 2);
  assert.equal(m.mutualPairs, 1);
  assert.equal(m.people.find((x) => x.id === "c").incoming, 0);
  assert.equal(matrix(pupils, rows, "w", "Кино-").edges.length, 1);
});
test("rejects self-selection, duplicate peers, outsiders and invalid ladder", () => {
  for (const p of [
    { choices: { "Поход+": ["a"] } },
    { choices: { "Поход+": ["b", "b"] } },
    { choices: { "Поход+": ["x"] } },
    { ladder: { Умные: 6 } },
    { ladder: { Умные: 1.5 } },
    { mood: { Математика: "blue" } },
  ])
    assert.throws(() => validateAnswer(p, pupils[0], pupils, 5));
});
test("grade 1 has cinema exclusion; grade 2 has per-question exclusions", () => {
  const a = validateAnswer(
    { choices: { "Кино-": ["b"], "Поход-": ["c"] } },
    pupils[0],
    pupils,
    5,
  );
  assert.deepEqual(a.choices["Кино-"], ["b"]);
  assert.equal(a.choices["Поход-"], undefined);
  const grade2 = { ...pupils[0], grade: 2 };
  assert.throws(() =>
    validateAnswer(
      { choices: { "Поход+": ["b"], "Поход-": ["b"] } },
      grade2,
      pupils,
      5,
    ),
  );
  const b = validateAnswer(
    { choices: { "Поход-": ["c"], "Кино-": ["b"] } },
    grade2,
    pupils,
    5,
  );
  assert.deepEqual(b.choices["Поход-"], ["c"]);
  assert.equal(b.choices["Кино-"], undefined);
});
test("blank questionnaire remains missing values rather than zero scores", () => {
  const p = validateAnswer({ ladder: { Умные: "" } }, pupils[0], pupils, 5);
  assert.deepEqual(p.ladder, {});
  assert.deepEqual(p.mood, {});
});
test("CSV values quote delimiters/newlines and neutralize spreadsheet formulas", () => {
  assert.equal(csvCell('a;"b\nc'), '"a;""b\nc"');
  assert.equal(csvCell("=SUM(A1)"), '"\'=SUM(A1)"');
});
test("SQLite persists edits, supports one answer per student/wave, preserves demo marker", async () => {
  const SQL = await initSql(),
    dir = mkdtempSync(join(tmpdir(), "school-monitor-")),
    p = join(dir, "test.sqlite");
  try {
    const a = new storePkg.Store(SQL, p);
    a.seed();
    let snap = a.snapshot();
    assert.equal(snap.students.length, 48);
    assert.equal(snap.waves.length, 2);
    assert.equal(snap.answers.length, 88);
    assert.equal(snap.demo, true);
    const student = snap.students[0],
      payload = validateAnswer(
        { mood: { Математика: "green" }, ladder: { Умные: 5 } },
        student,
        snap.students.filter((s) => s.class_name === student.class_name),
        5,
      );
    a.db.run("UPDATE answers SET payload=? WHERE wave_id=? AND student_id=?", [
      JSON.stringify(payload),
      "w2",
      student.id,
    ]);
    a.flush();
    const b = new storePkg.Store(SQL, p);
    assert.equal(
      b
        .snapshot()
        .answers.find((x) => x.wave_id === "w2" && x.student_id === student.id)
        .payload.ladder.Умные,
      5,
    );
    assert.throws(() =>
      b.db.run("INSERT INTO answers VALUES (?,?,?)", ["w2", student.id, "{}"]),
    );
    assert.throws(() =>
      b.db.run("INSERT INTO answers VALUES (?,?,?)", ["bad", "bad", "{}"]),
    );
    const empty = new storePkg.Store(SQL, join(dir, "empty.sqlite"));
    empty.flush();
    assert.equal(empty.snapshot().demo, false);
    assert.equal(empty.snapshot().students.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
