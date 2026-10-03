// options.js

let currentConfig = {
  exercises: [],
  settings: null,
  sites: []
};

document.addEventListener("DOMContentLoaded", () => {
  initOptions().catch(console.error);
});

async function initOptions() {
  chrome.runtime.sendMessage({ type: "fitsurf_getConfig" }, (resp) => {
    if (!resp || !resp.ok) return;
    currentConfig.exercises = resp.exercises || [];
    currentConfig.settings = resp.settings || {};
    currentConfig.sites = resp.sites || [];

    fillGlobalSettings();
    renderExercises();
    renderSites();

    bindButtons();
    refreshStats();
  });
}

function bindButtons() {
  document.getElementById("save-global").addEventListener("click", saveGlobalSettings);

  document.getElementById("ex-save").addEventListener("click", saveExerciseFromForm);
  document.getElementById("ex-delete").addEventListener("click", deleteExerciseById);

  document.getElementById("site-save").addEventListener("click", saveSiteFromForm);
  document.getElementById("site-delete").addEventListener("click", deleteSiteById);
  document.getElementById("btn-add-current-site").addEventListener("click", addCurrentSitePattern);

  document.getElementById("btn-export").addEventListener("click", doExport);
  document.getElementById("btn-import").addEventListener("click", doImport);

  document.getElementById("btn-stats-refresh").addEventListener("click", refreshStats);
}

function fillGlobalSettings() {
  const s = currentConfig.settings || {};
  document.getElementById("global-cooldown").value = s.globalCooldownMinutes ?? 30;
  document.getElementById("global-max-interval").value = s.globalMaxIntervalMinutes ?? 90;
  document.getElementById("default-notification-type").value =
    s.defaultNotificationType || "blocking";
  document.getElementById("pause-media").checked = !!s.pauseMedia;
}

function renderExercises() {
  const tbody = document.querySelector("#exercises-table tbody");
  tbody.innerHTML = "";
  for (const ex of currentConfig.exercises) {
    const tr = document.createElement("tr");

    const tdName = document.createElement("td");
    tdName.textContent = ex.name;

    const tdUnit = document.createElement("td");
    tdUnit.textContent = ex.unit || "";

    const tdStep = document.createElement("td");
    tdStep.textContent = ex.step || "";

    const tdMax = document.createElement("td");
    tdMax.textContent = ex.dailyMax != null ? ex.dailyMax : "";

    const tdActive = document.createElement("td");
    tdActive.textContent = ex.active === false ? "Нет" : "Да";

    const tdBtn = document.createElement("td");
    const btn = document.createElement("button");
    btn.textContent = "Ред.";
    btn.style.fontSize = "11px";
    btn.style.padding = "2px 6px";
    btn.addEventListener("click", () => loadExerciseToForm(ex));
    tdBtn.appendChild(btn);

    tr.appendChild(tdName);
    tr.appendChild(tdUnit);
    tr.appendChild(tdStep);
    tr.appendChild(tdMax);
    tr.appendChild(tdActive);
    tr.appendChild(tdBtn);
    tbody.appendChild(tr);
  }
}

function loadExerciseToForm(ex) {
  document.getElementById("ex-id").value = ex.id || "";
  document.getElementById("ex-name").value = ex.name || "";
  document.getElementById("ex-unit").value = ex.unit || "";
  document.getElementById("ex-step").value = ex.step || 10;
  document.getElementById("ex-max").value = ex.dailyMax != null ? ex.dailyMax : 0;
  document.getElementById("ex-active").checked = ex.active !== false;
}

function saveExerciseFromForm() {
  const idInput = document.getElementById("ex-id");
  const nameInput = document.getElementById("ex-name");
  const unitInput = document.getElementById("ex-unit");
  const stepInput = document.getElementById("ex-step");
  const maxInput = document.getElementById("ex-max");
  const activeInput = document.getElementById("ex-active");
  const statusEl = document.getElementById("status-ex");

  const name = nameInput.value.trim();
  if (!name) {
    statusEl.textContent = "Название обязательно.";
    statusEl.style.color = "#b91c1c";
    return;
  }

  let id = idInput.value.trim();
  if (!id) {
    id = "ex_" + Date.now();
  }

  const unit = unitInput.value.trim() || "повторений";
  const step = Math.max(1, Number(stepInput.value) || 10);
  const max = Math.max(0, Number(maxInput.value) || 0);
  const active = !!activeInput.checked;

  const existingIndex = currentConfig.exercises.findIndex((e) => e.id === id);
  const exObj = {
    id,
    name,
    unit,
    step,
    dailyMax: max,
    enableTimer: false,
    active
  };

  if (existingIndex >= 0) {
    currentConfig.exercises[existingIndex] = exObj;
  } else {
    currentConfig.exercises.push(exObj);
  }

  chrome.runtime.sendMessage(
    {
      type: "fitsurf_saveConfig",
      exercises: currentConfig.exercises
    },
    (resp) => {
      if (resp && resp.ok) {
        statusEl.textContent = "Сохранено.";
        statusEl.style.color = "#059669";
        renderExercises();
      } else {
        statusEl.textContent = "Ошибка сохранения.";
        statusEl.style.color = "#b91c1c";
      }
    }
  );
}

function deleteExerciseById() {
  const idInput = document.getElementById("ex-id");
  const statusEl = document.getElementById("status-ex");
  const id = idInput.value.trim();
  if (!id) {
    statusEl.textContent = "Укажите ID упражнения для удаления.";
    statusEl.style.color = "#b91c1c";
    return;
  }
  const idx = currentConfig.exercises.findIndex((e) => e.id === id);
  if (idx === -1) {
    statusEl.textContent = "Упражнение с таким ID не найдено.";
    statusEl.style.color = "#b91c1c";
    return;
  }
  currentConfig.exercises.splice(idx, 1);
  chrome.runtime.sendMessage(
    {
      type: "fitsurf_saveConfig",
      exercises: currentConfig.exercises
    },
    (resp) => {
      if (resp && resp.ok) {
        statusEl.textContent = "Удалено.";
        statusEl.style.color = "#059669";
        renderExercises();
      } else {
        statusEl.textContent = "Ошибка удаления.";
        statusEl.style.color = "#b91c1c";
      }
    }
  );
}

// -------- Сайты --------

function renderSites() {
  const tbody = document.querySelector("#sites-table tbody");
  tbody.innerHTML = "";
  for (const site of currentConfig.sites) {
    const tr = document.createElement("tr");

    const tdEnabled = document.createElement("td");
    tdEnabled.textContent = site.enabled ? "Да" : "Нет";

    const tdPattern = document.createElement("td");
    tdPattern.textContent = site.pattern || "";

    const tdMinutes = document.createElement("td");
    tdMinutes.textContent = site.triggerByTimeMinutes || 0;

    const tdTrans = document.createElement("td");
    tdTrans.textContent = site.triggerByTransitions || 0;

    const tdCombine = document.createElement("td");
    tdCombine.textContent = site.combineMode || "OR";

    const tdNotify = document.createElement("td");
    tdNotify.textContent = site.notificationType || "inherit";

    const tdBtn = document.createElement("td");
    const btn = document.createElement("button");
    btn.textContent = "Ред.";
    btn.style.fontSize = "11px";
    btn.style.padding = "2px 6px";
    btn.addEventListener("click", () => loadSiteToForm(site));
    tdBtn.appendChild(btn);

    tr.appendChild(tdEnabled);
    tr.appendChild(tdPattern);
    tr.appendChild(tdMinutes);
    tr.appendChild(tdTrans);
    tr.appendChild(tdCombine);
    tr.appendChild(tdNotify);
    tr.appendChild(tdBtn);
    tbody.appendChild(tr);
  }
}

function loadSiteToForm(site) {
  document.getElementById("site-id").value = site.id || "";
  document.getElementById("site-pattern").value = site.pattern || "";
  document.getElementById("site-minutes").value = site.triggerByTimeMinutes || 0;
  document.getElementById("site-transitions").value = site.triggerByTransitions || 0;
  document.getElementById("site-combine").value = site.combineMode || "OR";
  document.getElementById("site-notification-type").value = site.notificationType || "inherit";
  document.getElementById("site-enabled").checked = site.enabled !== false;
}

function saveSiteFromForm() {
  const idInput = document.getElementById("site-id");
  const patternInput = document.getElementById("site-pattern");
  const minutesInput = document.getElementById("site-minutes");
  const transitionsInput = document.getElementById("site-transitions");
  const combineInput = document.getElementById("site-combine");
  const notifInput = document.getElementById("site-notification-type");
  const enabledInput = document.getElementById("site-enabled");
  const statusEl = document.getElementById("status-site");

  const pattern = patternInput.value.trim();
  if (!pattern) {
    statusEl.textContent = "Домен обязателен.";
    statusEl.style.color = "#b91c1c";
    return;
  }

  let id = idInput.value.trim();
  if (!id) {
    id = "site_" + Date.now();
  }

  const minutes = Math.max(0, Number(minutesInput.value) || 0);
  const transitions = Math.max(0, Number(transitionsInput.value) || 0);
  const combineMode = combineInput.value === "AND" ? "AND" : "OR";
  const notifType = notifInput.value || "inherit";
  const enabled = !!enabledInput.checked;

  const obj = {
    id,
    pattern,
    enabled,
    triggerByTimeMinutes: minutes,
    triggerByTransitions: transitions,
    combineMode,
    notificationType: notifType
  };

  const idx = currentConfig.sites.findIndex((s) => s.id === id);
  if (idx >= 0) {
    currentConfig.sites[idx] = obj;
  } else {
    currentConfig.sites.push(obj);
  }

  chrome.runtime.sendMessage(
    {
      type: "fitsurf_saveConfig",
      sites: currentConfig.sites
    },
    (resp) => {
      if (resp && resp.ok) {
        statusEl.textContent = "Сохранено.";
        statusEl.style.color = "#059669";
        renderSites();
      } else {
        statusEl.textContent = "Ошибка сохранения.";
        statusEl.style.color = "#b91c1c";
      }
    }
  );
}

function deleteSiteById() {
  const idInput = document.getElementById("site-id");
  const statusEl = document.getElementById("status-site");
  const id = idInput.value.trim();
  if (!id) {
    statusEl.textContent = "Укажите ID сайта для удаления.";
    statusEl.style.color = "#b91c1c";
    return;
  }
  const idx = currentConfig.sites.findIndex((s) => s.id === id);
  if (idx === -1) {
    statusEl.textContent = "Сайт с таким ID не найден.";
    statusEl.style.color = "#b91c1c";
    return;
  }
  currentConfig.sites.splice(idx, 1);
  chrome.runtime.sendMessage(
    {
      type: "fitsurf_saveConfig",
      sites: currentConfig.sites
    },
    (resp) => {
      if (resp && resp.ok) {
        statusEl.textContent = "Удалено.";
        statusEl.style.color = "#059669";
        renderSites();
      } else {
        statusEl.textContent = "Ошибка удаления.";
        statusEl.style.color = "#b91c1c";
      }
    }
  );
}

function addCurrentSitePattern() {
  const statusEl = document.getElementById("status-site");
  chrome.runtime.sendMessage({ type: "fitsurf_getCurrentTabDomain" }, (resp) => {
    if (resp && resp.ok && resp.hostname) {
      document.getElementById("site-pattern").value = resp.hostname.replace(/^www\./, "");
      statusEl.textContent = "Текущий сайт подставлен в поле домена.";
      statusEl.style.color = "#059669";
    } else {
      statusEl.textContent = "Не удалось получить домен текущей вкладки.";
      statusEl.style.color = "#b91c1c";
    }
  });
}

// -------- Глобальные настройки --------

function saveGlobalSettings() {
  const sCooldown = document.getElementById("global-cooldown");
  const sMaxInterval = document.getElementById("global-max-interval");
  const sType = document.getElementById("default-notification-type");
  const sPause = document.getElementById("pause-media");
  const statusEl = document.getElementById("status-global");

  const cooldown = Math.max(1, Number(sCooldown.value) || 30);
  const maxInterval = Math.max(0, Number(sMaxInterval.value) || 90);
  const notifType = sType.value === "nonblocking" ? "nonblocking" : "blocking";
  const pauseMedia = !!sPause.checked;

  const newSettings = {
    ...currentConfig.settings,
    globalCooldownMinutes: cooldown,
    globalMaxIntervalMinutes: maxInterval,
    defaultNotificationType: notifType,
    pauseMedia
  };
  currentConfig.settings = newSettings;

  chrome.runtime.sendMessage(
    {
      type: "fitsurf_saveConfig",
      settings: newSettings
    },
    (resp) => {
      if (resp && resp.ok) {
        statusEl.textContent = "Сохранено.";
        statusEl.style.color = "#059669";
      } else {
        statusEl.textContent = "Ошибка сохранения.";
        statusEl.style.color = "#b91c1c";
      }
    }
  );
}

// -------- Импорт/экспорт --------

function doExport() {
  const statusEl = document.getElementById("status-import");
  chrome.runtime.sendMessage({ type: "fitsurf_exportAll" }, (resp) => {
    if (!resp || !resp.ok) {
      statusEl.textContent = "Не удалось экспортировать.";
      statusEl.style.color = "#b91c1c";
      return;
    }
    const blob = new Blob([resp.exportJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fitsurf-export.json";
    a.click();
    URL.revokeObjectURL(url);
    statusEl.textContent = "Экспорт выполнен.";
    statusEl.style.color = "#059669";
  });
}

function doImport() {
  const statusEl = document.getElementById("status-import");
  const fileInput = document.getElementById("file-import");
  const file = fileInput.files && fileInput.files[0];
  if (!file) {
    statusEl.textContent = "Выберите JSON-файл для импорта.";
    statusEl.style.color = "#b91c1c";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const text = reader.result;
    chrome.runtime.sendMessage(
      {
        type: "fitsurf_importAll",
        json: text
      },
      (resp) => {
        if (resp && resp.ok) {
          statusEl.textContent = "Импорт выполнен. Обновите страницу.";
          statusEl.style.color = "#059669";
        } else {
          statusEl.textContent = "Ошибка импорта.";
          statusEl.style.color = "#b91c1c";
        }
      }
    );
  };
  reader.readAsText(file, "utf-8");
}

// -------- Статистика --------

function refreshStats() {
  const periodSelect = document.getElementById("stats-period");
  const days = Number(periodSelect.value) || 7;

  chrome.runtime.sendMessage(
    {
      type: "fitsurf_getStats",
      periodDays: days
    },
    (resp) => {
      if (!resp || !resp.ok) return;
      const { byDay, exercises } = resp;
      drawStatsChart(byDay, exercises);
      fillStatsTable(byDay, exercises);
    }
  );
}

function drawStatsChart(byDay, exercises) {
  const canvas = document.getElementById("stats-canvas");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const dayKeys = Object.keys(byDay).sort();
  if (!dayKeys.length) {
    ctx.fillStyle = "#6b7280";
    ctx.font = "13px system-ui";
    ctx.fillText("Нет данных за выбранный период", 10, 30);
    return;
  }

  const totalsByDay = dayKeys.map((dayKey) => {
    const perEx = byDay[dayKey];
    let sum = 0;
    for (const exId in perEx) sum += perEx[exId];
    return sum;
  });

  const maxVal = Math.max(...totalsByDay);
  if (maxVal <= 0) {
    ctx.fillStyle = "#6b7280";
    ctx.font = "13px system-ui";
    ctx.fillText("Нет выполненных упражнений за период", 10, 30);
    return;
  }

  const paddingLeft = 30;
  const paddingRight = 10;
  const paddingTop = 10;
  const paddingBottom = 20;
  const width = canvas.width - paddingLeft - paddingRight;
  const height = canvas.height - paddingTop - paddingBottom;

  const barWidth = Math.max(8, width / dayKeys.length - 4);

  ctx.strokeStyle = "#e5e7eb";
  ctx.beginPath();
  ctx.moveTo(paddingLeft, paddingTop);
  ctx.lineTo(paddingLeft, paddingTop + height);
  ctx.lineTo(paddingLeft + width, paddingTop + height);
  ctx.stroke();

  ctx.font = "11px system-ui";
  ctx.fillStyle = "#6b7280";
  ctx.fillText(String(maxVal), 2, paddingTop + 10);
  ctx.fillText("0", 2, paddingTop + height);

  for (let i = 0; i < dayKeys.length; i++) {
    const dayKey = dayKeys[i];
    const val = totalsByDay[i];
    const x = paddingLeft + i * (barWidth + 4);
    const barHeight = (val / maxVal) * height;
    const y = paddingTop + height - barHeight;

    ctx.fillStyle = "#2563eb";
    ctx.fillRect(x, y, barWidth, barHeight);

    const label = formatDateShort(dayKey);
    ctx.fillStyle = "#6b7280";
    ctx.save();
    ctx.translate(x + barWidth / 2, paddingTop + height + 12);
    ctx.rotate(-Math.PI / 4);
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }
}

function formatDateShort(dayKey) {
  const [y, m, d] = dayKey.split("-");
  return `${d}.${m}`;
}

function fillStatsTable(byDay, exercises) {
  const tbody = document.querySelector("#stats-table tbody");
  tbody.innerHTML = "";

  const exMap = {};
  for (const ex of exercises) {
    exMap[ex.id] = ex;
  }

  const dayKeys = Object.keys(byDay).sort();
  for (const dayKey of dayKeys) {
    const perEx = byDay[dayKey];
    for (const exId in perEx) {
      const ex = exMap[exId];
      const amount = perEx[exId];
      const tr = document.createElement("tr");
      const tdDate = document.createElement("td");
      tdDate.textContent = dayKey;
      const tdName = document.createElement("td");
      tdName.textContent = ex ? ex.name : exId;
      const tdAmount = document.createElement("td");
      tdAmount.textContent = amount + (ex && ex.unit ? " " + ex.unit : "");
      tr.appendChild(tdDate);
      tr.appendChild(tdName);
      tr.appendChild(tdAmount);
      tbody.appendChild(tr);
    }
  }
}
