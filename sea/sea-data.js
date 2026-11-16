"use strict";

const seaData = {
  layers: [
    { id: "operations", label: "Операции", question: "Что делаем сейчас?" },
    { id: "rules", label: "Правила", question: "Как действуем в похожих случаях?" },
    { id: "method", label: "Методология", question: "Как проверяем вывод?" },
    { id: "values", label: "Ценности", question: "Что хотим сохранить?" },
  ],
  groups: [
    { id: "finance", label: "Финансы", symbol: "₽" },
  ],
  nodes: [
    { id: "op.press", layer: "operations", group: "finance", title: "Покупать ли термопресс?",
      surface: { title: "Колтуши", caption: "Покупать ли термопресс?" },
      financeLink: "../dashboard/index.html", versions: [
        { id: "press.2026-11-14", date: "2026-11-14", position: "Пока отложить.", reason: "Свободный остаток цеха пока неизвестен. На одной партии покупка требует на 60 000 ₽ больше, чем подряд, до учёта своего нанесения и перепродажи.", source: "Рабочая оценка по «Колтушам»" },
      ] },
    { id: "rule.purchase", layer: "rules", group: "finance", title: "Правило закупок для цеха", versions: [
      { id: "purchase.2026-11-14", date: "2026-11-14", position: "Сначала сверить деньги к дате платежа.", reason: "До закупки проверить остаток, обязательства и реальные альтернативы. Это рабочее предложение по кейсу с прессом." },
    ] },
    { id: "method.cash", layer: "method", group: "finance", title: "Проверка денег и выгоды", versions: [
      { id: "cash.2026-11-14", date: "2026-11-14", position: "Считать кассу и выгоду отдельно.", reason: "Остаток и платежи проверяем по датам. Покупку и подряд сравниваем на одинаковом объёме заказов." },
    ] },
    { id: "value.resilience", layer: "values", group: "finance", title: "Финансовая устойчивость", versions: [
      { id: "resilience.2026-11-14", date: "2026-11-14", position: "Сохранять деньги на ближайшие обязательства.", reason: "Рабочий принцип для обсуждения. Размер и горизонт защищённого запаса пока не согласованы.", source: "Рабочая формулировка · без мандата" },
    ],
    scenarioVersion: { id: "resilience.demo.2026-11-15", date: "2026-11-15",
      position: "В демонстрации защищаем обязательства на 30 дней.",
      reason: "В сценарии добавили проверку запаса на 30 дней. Новое ограничение требует перепроверить доступный бюджет на пресс.",
      source: "Демонстрационное изменение · без мандата" } },
  ],
  links: [
    { id: "basis.reserve.cash", from: "value.resilience", to: "method.cash", label: "Задаёт границу запаса", kind: "basis" },
    { id: "basis.cash.purchase", from: "method.cash", to: "rule.purchase", label: "Определяет проверку закупки", kind: "basis" },
    { id: "basis.purchase.press", from: "rule.purchase", to: "op.press", label: "Задаёт условия покупки", kind: "basis" },
  ],
  scenario: { foundation: "value.resilience", storageKey: "decision-sea.demo.reserve.v1" },
};
