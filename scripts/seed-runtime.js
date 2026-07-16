const CONFIG = require("../src/config");
const { openDatabase, seedDatabase } = require("../src/db");

const db = openDatabase(CONFIG.dbPath);
const seeded = seedDatabase(db);

console.log(seeded ? "Runtime database seeded." : "Runtime database already initialized.");
console.log(CONFIG.dbPath);
