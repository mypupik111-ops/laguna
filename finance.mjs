import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const dayMs = 86400000;
const epoch = 25569;
const validTypes = new Set(["income", "expense", "refund", "transfer", "opening"]);
const validStatuses = new Set(["active", "superseded", "void"]);
const sums = ["income", "expense", "refund", "transfer"];

export function dateSerial(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Укажите дату в формате ГГГГ-ММ-ДД");
  }
  const time = Date.parse(date + "T00:00:00Z");
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) {
    throw new Error("Некорректная дата: " + date);
  }
  return time / dayMs + epoch;
}

function isDateSerial(value) {
  return Number.isInteger(value) && value >= 1 && value <= 2958465;
}

function isoDate(value) {
  return new Date((value - epoch) * dayMs).toISOString().slice(0, 10);
}

function add(a, b) {
  const total = a + b;
  if (!Number.isSafeInteger(total)) throw new Error("Итог выходит за пределы точного расчёта");
  return total;
}

export function rublesToKopecks(input) {
  const text = String(input).trim();
  const match = /^(-?)(\d+)(?:[.,](\d{1,2}))?$/.exec(text);
  if (!match) throw new Error("Некорректная сумма в рублях: " + text);
  const value = BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"));
  const cents = Number(match[1] ? -value : value);
  if (!Number.isSafeInteger(cents)) throw new Error("Сумма выходит за пределы точного расчёта");
  return cents;
}

export function readLedger(rows) {
  if (!Array.isArray(rows)) throw new Error("Ожидается массив строк журнала");
  const history = new Map();
  const keys = new Map();
  const openingAccounts = new Set();
  const active = [];
  for (const [index, row] of rows.entries()) {
    if (!Array.isArray(row)) throw new Error("Ожидается массив ячеек в каждой строке");
    if (row.every((value) => value === "" || value === null || value === undefined)) continue;
    const [id, version, status, date, type, amount, from = "", to = "",
      category = "", memo = "", key = "", recorded = ""] = row.map((value) => value ?? "");
    const error = (message) => { throw new Error("Строка " + (index + 2) + ": " + message); };
    if (![id, from, to, category, memo, key, recorded].every((value) =>
      typeof value === "string" && value.trim() === value)) error("некорректное текстовое поле");
    if (!id || !recorded || !Number.isSafeInteger(version) || version < 1
      || !validStatuses.has(status) || !isDateSerial(date) || !validTypes.has(type)
      || !Number.isSafeInteger(amount) || amount < 0 || (amount === 0 && type !== "opening")) {
      error("некорректный ID, версия, статус, дата, тип, сумма или время записи");
    }
    const oneAccount = Boolean(from) !== Boolean(to);
    const validAccounts = {
      income: !from && Boolean(to), refund: !from && Boolean(to),
      expense: Boolean(from) && !to, transfer: Boolean(from && to && from !== to), opening: oneAccount,
    };
    if (!validAccounts[type]) error("счета не соответствуют типу операции");
    if (["expense", "refund", "income"].includes(type) && !category) error("отсутствует категория");
    if (key) {
      if (keys.has(key) && keys.get(key) !== id) error("повтор ключа источника " + key);
      keys.set(key, id);
    }
    const operation = { id, version, status, date, type, amount, from, to, category, memo, key };
    const versions = history.get(id) ?? [];
    versions.push(operation);
    history.set(id, versions);
    if (status !== "active") continue;
    if (type === "opening") {
      const account = from || to;
      if (openingAccounts.has(account)) error("повтор начального остатка по счёту " + account);
      openingAccounts.add(account);
    }
    active.push(operation);
  }
  for (const [id, versions] of history) {
    versions.sort((a, b) => a.version - b.version);
    if (versions.some((row, index) =>
      row.version !== index + 1 || (index < versions.length - 1 && row.status !== "superseded"))
      || versions.at(-1).status === "superseded") {
      throw new Error("Нарушена история версий операции " + id);
    }
  }
  return { active, history };
}

export function report(rows, from, to, { account = "", category = "" } = {}) {
  if (!isDateSerial(from) || !isDateSerial(to) || from > to) throw new Error("Некорректный период");
  const { active } = readLedger(rows);
  const period = active.filter((row) => row.type !== "opening" && row.date >= from && row.date <= to);
  const allTotals = summarize(period);
  const selected = period.filter((row) => (!account || row.from === account || row.to === account)
    && (!category || row.category === category));
  const totals = summarize(selected);
  const accounts = new Map();
  const openingDates = new Map(active.filter((row) => row.type === "opening" && row.date <= to)
    .map((row) => [row.from || row.to, row.date]));
  for (const row of active) {
    if (row.date > to) continue;
    if (row.from && row.date >= (openingDates.get(row.from) ?? 0)) {
      accounts.set(row.from, add(accounts.get(row.from) ?? 0, -row.amount));
    }
    if (row.to && row.date >= (openingDates.get(row.to) ?? 0)) {
      accounts.set(row.to, add(accounts.get(row.to) ?? 0, row.amount));
    }
  }
  const byCategory = new Map();
  for (const row of selected) {
    if (row.type !== "expense" && row.type !== "refund") continue;
    byCategory.set(row.category, add(byCategory.get(row.category) ?? 0,
      row.type === "refund" ? -row.amount : row.amount));
  }
  const categoryTotal = [...byCategory.values()].reduce(add, 0);
  if (categoryTotal !== totals.netExpense) throw new Error("Итог по категориям не сходится");
  verifySelection(active, selected, from, to, account, category, totals);
  return {
    from, to, account, category, totals, allTotals, selected, byCategory,
    accounts: [...accounts].map(([name, amount]) => ({
      name, amount, hasOpening: (openingDates.get(name) ?? Infinity) <= to,
    })),
  };
}

function verifySelection(active, selected, from, to, account, category, totals) {
  const ids = [];
  for (const type of sums) {
    const matching = active.filter((row) => row.type === type && from <= row.date && to >= row.date
      && (!category || category === row.category) && (!account || [row.from, row.to].includes(account)));
    const total = matching.reduce((sum, row) => sum + BigInt(row.amount), 0n);
    if (total !== BigInt(totals[type])) throw new Error("Расхождение в срезе: " + type);
    ids.push(...matching.map((row) => row.id));
  }
  if (JSON.stringify(ids.sort()) !== JSON.stringify(selected.map((row) => row.id).sort())) {
    throw new Error("Набор операций в срезе не сходится");
  }
}

function summarize(rows) {
  const totals = { income: 0, expense: 0, refund: 0, transfer: 0 };
  for (const row of rows) totals[row.type] = add(totals[row.type], row.amount);
  totals.netExpense = add(totals.expense, -totals.refund);
  totals.net = add(totals.income, -totals.netExpense);
  totals.count = rows.length;
  return totals;
}

export function verifySummary(rows, snapshot) {
  if (!snapshot || !Array.isArray(snapshot.values) || snapshot.values.length !== 7) {
    throw new Error("Нужны даты и семь рассчитанных значений из «Сводка»!B2:B11");
  }
  const { allTotals: total } = report(rows, snapshot.from, snapshot.to);
  const expected = [total.income, total.expense, total.refund, total.netExpense,
    total.net, total.transfer, total.count];
  for (const [index, value] of snapshot.values.entries()) {
    const scaled = index === 6 ? value : value * 100;
    // Формулы Sheets возвращают числа с плавающей точкой в рублях.
    if (!Number.isFinite(value) || Math.abs(scaled - expected[index]) > 0.0001) {
      throw new Error("Расхождение со «Сводка»!B" + (5 + index)
        + ": расчёт в копейках/штуках " + expected[index] + ", в таблице " + value);
    }
  }
}

export function reconcileBalance(rows, account, date, bankRubles) {
  if (!account) throw new Error("Укажите счёт для сверки");
  const through = dateSerial(date);
  const { accounts } = report(rows, through, through);
  const found = accounts.find((row) => row.name === account);
  if (!found?.hasOpening) throw new Error("На дату сверки у счёта нет начального остатка");
  const bank = rublesToKopecks(bankRubles);
  return { bank, ledger: found.amount, difference: add(found.amount, -bank) };
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g,
  (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const rubles = (amount) => {
  const absolute = BigInt(Math.abs(amount));
  const rub = new Intl.NumberFormat("ru-RU").format(absolute / 100n);
  return (amount < 0 ? "−" : "") + rub + "," + String(absolute % 100n).padStart(2, "0") + " ₽";
};
const dateLabel = (date) => isoDate(date).split("-").reverse().join(".");
const types = { income: "Доход", expense: "Расход", refund: "Возврат", transfer: "Перевод" };
const table = (headers, rows) => `<div class="table"><table><thead><tr>${headers.map(
  (cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map(
  (row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;

export function renderHtml(data, title = "Личные финансы") {
  const { totals, selected } = data;
  const cards = [["Доходы", totals.income], ["Расходы с учётом возвратов", totals.netExpense],
    ["Чистый поток", totals.net]].map(([label, amount]) =>
    `<div><span>${label}</span><strong>${rubles(amount)}</strong></div>`).join("");
  const categoryRows = [...data.byCategory].sort((a, b) => b[1] - a[1])
    .map(([name, value]) => [name, rubles(value)]);
  const details = [...selected].sort((a, b) => b.date - a.date || a.id.localeCompare(b.id)).map(
    (row) => [dateLabel(row.date), types[row.type], row.memo || row.category || "—",
      [row.from, row.to].filter(Boolean).join(" → "), rubles(row.amount), row.id]);
  const accountRows = data.accounts.filter((row) => !data.account || row.name === data.account)
    .map((row) => [row.name, rubles(row.amount), row.hasOpening ? "Начальный остаток задан" : "Движение по журналу"]);
  const filters = [data.account, data.category].filter(Boolean).map(escapeHtml);
  return `<!doctype html>
<html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{font-family:Inter,system-ui,sans-serif;color:#162625;background:#f3f6f4}
body{max-width:1050px;margin:auto;padding:clamp(20px,5vw,64px)}
h1{font-size:clamp(2rem,6vw,4rem);line-height:1.05;margin:.4rem 0 1rem}
h2{margin:2rem 0 .7rem}p{color:#4b615d;line-height:1.6}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin:28px 0}
.cards div,.table{background:white;border:1px solid #dce5df;border-radius:12px}
.cards div{padding:20px;display:grid;gap:12px}.cards strong{font-size:1.6rem}
.table{overflow:auto}table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:12px 14px;border-bottom:1px solid #e4ebe7;white-space:nowrap}
th{background:#edf4ef}tr:last-child td{border-bottom:0}
</style>
<main>
<h1>${escapeHtml(title)}</h1>
<p>${dateLabel(data.from)} – ${dateLabel(data.to)} · ${totals.count} оп. ${filters.length ? "· " + filters.join(" · ") : ""}</p>
<div class="cards">${cards}</div>
<p>Возвраты ${rubles(totals.refund)} · Переводы между своими счетами ${rubles(totals.transfer)}</p>
${categoryRows.length ? '<h2>Расходы по категориям</h2>' + table(["Категория", "Сумма с учётом возвратов"], categoryRows) : ""}
${details.length ? '<h2>Операции</h2>' + table(["Дата", "Тип", "Описание", "Счёт", "Сумма", "ID"], details) : "<p>За выбранный период в журнале нет операций.</p>"}
${accountRows.length && !data.category ? '<h2>По счетам на конец периода</h2>' + table(["Счёт", "По журналу", "Основание"], accountRows) : ""}
</main></html>`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output] = process.argv.slice(2);
  if (!input) throw new Error("Использование: node finance.mjs snapshot.json [report.html]");
  const source = JSON.parse((await readFile(input, "utf8")).replace(/^\uFEFF/, ""));
  verifySummary(source.rows, source.summary);
  const options = source.report ?? {};
  const from = options.from ? dateSerial(options.from) : source.summary.from;
  const to = options.to ? dateSerial(options.to) : source.summary.to;
  const data = report(source.rows, from, to, options);
  if (output) await writeFile(output, renderHtml(data, options.title), "utf8");
  console.log(JSON.stringify({ verifiedSummary: true, from: isoDate(from), to: isoDate(to), totalsInKopecks: data.totals }));
}
