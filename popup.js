// popup.js

document.addEventListener("DOMContentLoaded", () => {
  initPopup().catch(console.error);
});

function formatTodayDate(key) {
  const [y, m, d] = key.split("-");
  return `${d}.${m}.${y}`;
}

async function initPopup() {
  chrome.runtime.sendMessage({ type: "fitsurf_getTodaySummary" }, (response) => {
    if (!response || !response.ok) return;
    const { exercises, totals, todayKey } = response;

    const dateEl = document.getElementById("today-date");
    dateEl.textContent = formatTodayDate(todayKey);

    renderSummary(exercises, totals);
    fillManualSelect(exercises);

    const addBtn = document.getElementById("manual-add");
    const amountInput = document.getElementById("manual-amount");
    const select = document.getElementById("manual-exercise");
    const statusEl = document.getElementById("manual-status");

    addBtn.addEventListener("click", () => {
      const exId = select.value;
      const amount = Number(amountInput.value) || 0;
      if (!exId || amount <= 0) {
        statusEl.textContent = "Укажите упражнение и количество > 0.";
        statusEl.style.color = "#b91c1c";
        return;
      }
      chrome.runtime.sendMessage(
        {
          type: "fitsurf_addManualExercise",
          exerciseId: exId,
          amount
        },
        (resp) => {
          if (resp && resp.ok) {
            renderSummary(exercises, resp.totals);
            statusEl.textContent = "Запись добавлена.";
            statusEl.style.color = "#059669";
          } else {
            statusEl.textContent = "Не удалось добавить.";
            statusEl.style.color = "#b91c1c";
          }
        }
      );
    });
  });
}

function renderSummary(exercises, totals) {
  const container = document.getElementById("summary-container");
  container.innerHTML = "";

  const table = document.createElement("table");
  table.className = "summary-table";
  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  ["Упражнение", "Сегодня"].forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const ex of exercises) {
    const done = totals[ex.id] || 0;
    const tr = document.createElement("tr");
    const tdName = document.createElement("td");
    tdName.textContent = ex.name;
    const tdDone = document.createElement("td");
    tdDone.textContent = `${done}${ex.unit ? " " + ex.unit : ""}`;
    tr.appendChild(tdName);
    tr.appendChild(tdDone);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);
}

function fillManualSelect(exercises) {
  const select = document.getElementById("manual-exercise");
  select.innerHTML = "";
  for (const ex of exercises) {
    const opt = document.createElement("option");
    opt.value = ex.id;
    opt.textContent = ex.name;
    select.appendChild(opt);
  }
}
