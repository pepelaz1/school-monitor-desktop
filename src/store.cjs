const fs = require("node:fs");
class Store {
  constructor(SQL, path) {
    this.path = path;
    this.db = fs.existsSync(path)
      ? new SQL.Database(fs.readFileSync(path))
      : new SQL.Database();
    this.db.run(
      "PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS students(id TEXT PRIMARY KEY,name TEXT NOT NULL,class_name TEXT NOT NULL,grade INTEGER NOT NULL CHECK(grade BETWEEN 1 AND 4)); CREATE TABLE IF NOT EXISTS waves(id TEXT PRIMARY KEY,title TEXT NOT NULL,date TEXT NOT NULL); CREATE TABLE IF NOT EXISTS answers(wave_id TEXT NOT NULL REFERENCES waves(id),student_id TEXT NOT NULL REFERENCES students(id),payload TEXT NOT NULL,PRIMARY KEY(wave_id,student_id));",
    );
    if (!this.query("SELECT * FROM meta WHERE key='steps'").length)
      this.db.run("INSERT INTO meta VALUES ('steps','5'),('demo','0')");
  }
  query(sql, params = []) {
    const st = this.db.prepare(sql);
    try {
      st.bind(params);
      const rows = [];
      while (st.step()) rows.push(st.getAsObject());
      return rows;
    } finally {
      st.free();
    }
  }
  snapshot() {
    return {
      students: this.query("SELECT * FROM students ORDER BY class_name,name"),
      waves: this.query("SELECT * FROM waves ORDER BY date DESC"),
      answers: this.query("SELECT * FROM answers").map((a) => ({
        ...a,
        payload: JSON.parse(a.payload),
      })),
      steps: Number(
        this.query("SELECT value FROM meta WHERE key='steps'")[0].value,
      ),
      demo:
        this.query("SELECT value FROM meta WHERE key='demo'")[0]?.value === "1",
      path: this.path,
    };
  }
  bytes() {
    const bytes = this.db.export();
    // sql.js reopens the connection during export; restore connection-local PRAGMAs.
    this.db.run("PRAGMA foreign_keys=ON");
    return Buffer.from(bytes);
  }
  flush() {
    const temp = this.path + ".tmp";
    const fd = fs.openSync(temp, "w", 0o600);
    try {
      fs.writeFileSync(fd, this.bytes());
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, this.path);
  }
  seed() {
    if (
      this.query("SELECT * FROM students").length ||
      this.query("SELECT * FROM waves").length
    )
      return;
    this.db.run("UPDATE meta SET value='1' WHERE key='demo'");
    for (const [wi, date] of [
      [1, "2026-09-10"],
      [2, "2026-10-27"],
    ])
      this.db.run("INSERT INTO waves VALUES (?,?,?)", [
        "w" + wi,
        wi === 1 ? "Начало года · демо" : "Повторный замер · демо",
        date,
      ]);
    for (let cl = 0; cl < 4; cl++) {
      const grade = cl < 2 ? 1 : 2,
        cn = grade + (cl % 2 ? "Б" : "А");
      for (let i = 1; i <= 12; i++) {
        const id = "s" + cl + "-" + i;
        this.db.run("INSERT INTO students VALUES (?,?,?,?)", [
          id,
          "Демо ученик " + String(i).padStart(2, "0"),
          cn,
          grade,
        ]);
        for (let w = 1; w <= 2; w++) {
          if (i > 10 && w === 2) continue;
          const mood = {},
            ladder = {},
            choices = {};
          [
            "Математика",
            "Русский язык",
            "Чтение",
            "Английский язык",
            "Окружающий мир",
            "Информатика",
            "Музыка",
            "Физкультура",
            "Школа в целом",
          ].forEach(
            (s, n) => (mood[s] = ["red", "yellow", "green"][(i + n + w) % 3]),
          );
          [
            "Умные",
            "Добрые",
            "Красивые",
            "Со мной дружат",
            "Хорошо учатся",
          ].forEach((s, n) => (ladder[s] = 1 + ((i + n + w) % 5)));
          for (const c of ["Поход", "Олимпиада", "День рождения"]) {
            choices[c + "+"] = [
              "s" + cl + "-" + ((i % 12) + 1),
              "s" + cl + "-" + (((i + 1) % 12) + 1),
            ];
            if (grade > 1)
              choices[c + "-"] = ["s" + cl + "-" + (((i + 5) % 12) + 1)];
          }
          if (grade === 1)
            choices["Кино-"] = ["s" + cl + "-" + (((i + 5) % 12) + 1)];
          this.db.run("INSERT INTO answers VALUES (?,?,?)", [
            "w" + w,
            id,
            JSON.stringify({ mood, ladder, choices, note: "" }),
          ]);
        }
      }
    }
    this.flush();
  }
}
module.exports = { Store };
