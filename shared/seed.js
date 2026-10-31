
const db = require("./database");
const bcrypt = require("bcryptjs");

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users
    (nim, name, username, password_hash, role)
  VALUES (?, ?, ?, ?, ?)
`);

const users = [
  [null, "Administrator", "admin", "Admin123!", "admin"],
  [null, "Dosen Informatika A", "dosen1", "Dosen123!", "dosen"],
  [null, "Dosen Informatika B", "dosen2", "Dosen123!", "dosen"],
  ["247006111001", "Mahasiswa A", "mhs1", "Mhs12345!", "mahasiswa"],
  ["247006111002", "Mahasiswa B", "mhs2", "Mhs12345!", "mahasiswa"],
  ["247006111003", "Mahasiswa C", "mhs3", "Mhs12345!", "mahasiswa"],
];

const insertDevice = db.prepare(`
  INSERT OR IGNORE INTO devices
    (user_id, device_id, device_name)
  VALUES (?, ?, ?)
`);

const insertClass = db.prepare(`
  INSERT INTO classes (class_name, lecturer_id)
  SELECT ?, id
  FROM users
  WHERE username = ?
    AND NOT EXISTS (
      SELECT 1 FROM classes WHERE class_name = ?
    )
`);

const insertGrade = db.prepare(`
  INSERT OR IGNORE INTO grades (student_id, class_id, score)
  VALUES (?, ?, ?)
`);

const seed = db.transaction(() => {
  // Membuat akun demo dengan password yang di-hash.
  for (const [nim, name, username, password, role] of users) {
    const passwordHash = hashPassword(password);

    const existing = db.prepare(
    "SELECT id FROM users WHERE username = ?"
    ).get(username);

    if (existing) {
    db.prepare(`
        UPDATE users
        SET nim = ?, name = ?, password_hash = ?, role = ?
        WHERE username = ?
    `).run(nim, name, passwordHash, role, username);
    } else {
    insertUser.run(nim, name, username, passwordHash, role);
    }
  }

  // Mendaftarkan perangkat demo untuk setiap akun.
  const devices = [
    ["admin", "device-admin-001", "Admin Laptop"],
    ["dosen1", "device-dosen1-001", "Laptop Dosen A"],
    ["dosen2", "device-dosen2-001", "Laptop Dosen B"],
    ["mhs1", "device-mhs1-001", "Laptop Mahasiswa A"],
    ["mhs2", "device-mhs2-001", "Laptop Mahasiswa B"],
    ["mhs3", "device-mhs3-001", "Laptop Mahasiswa C"],
  ];

  for (const [username, deviceId, deviceName] of devices) {
    const user = db.prepare(
      "SELECT id FROM users WHERE username = ?"
    ).get(username);

    if (!user) {
      throw new Error(
        `Akun '${username}' tidak ditemukan di database.`
      );
    }

    insertDevice.run(user.id, deviceId, deviceName);
  }

  // Membuat kelas demo dengan dosen pengampu berbeda.
  insertClass.run(
    "Keamanan Informasi A",
    "dosen1",
    "Keamanan Informasi A"
  );

  insertClass.run(
    "Keamanan Informasi B",
    "dosen2",
    "Keamanan Informasi B"
  );

  // Mengisi nilai awal setiap mahasiswa pada setiap kelas.
  const classes = db.prepare(
    "SELECT id, class_name FROM classes"
  ).all();

  const students = db.prepare(
    "SELECT id, username FROM users WHERE role = 'mahasiswa'"
  ).all();

  for (const student of students) {
    for (const kelas of classes) {
      insertGrade.run(
        student.id,
        kelas.id,
        75 + ((student.id + kelas.id) % 20)
      );
    }
  }
});

try {
  seed();

  console.log("Seed data berhasil dibuat.\n");

  console.log("Akun pengguna:");
  console.table(
    db.prepare(
      "SELECT username, role, nim FROM users ORDER BY id"
    ).all()
  );

  console.log("Kelas:");
  console.table(
    db.prepare(`
      SELECT
        classes.id,
        classes.class_name,
        users.username AS dosen
      FROM classes
      JOIN users ON users.id = classes.lecturer_id
      ORDER BY classes.id
    `).all()
  );

  console.log("Jumlah perangkat:", 
    db.prepare("SELECT COUNT(*) AS total FROM devices").get().total
  );

  console.log("Jumlah nilai:", 
    db.prepare("SELECT COUNT(*) AS total FROM grades").get().total
  );
} catch (error) {
  console.error("Seed gagal:", error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
