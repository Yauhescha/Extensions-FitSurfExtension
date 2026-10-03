// background.js (service worker, type: module)

const DEFAULT_EXERCISES = [
  {
    id: "ex_squats",
    name: "Приседания",
    unit: "повторений",
    step: 10,
    dailyMax: 100,
    enableTimer: false,
    active: true
  },
  {
    id: "ex_pushups",
    name: "Отжимания",
    unit: "повторений",
    step: 10,
    dailyMax: 40,
    enableTimer: false,
    active: true
  },
  {
    id: "ex_crunches",
    name: "Пресс",
    unit: "повторений",
    step: 10,
    dailyMax: 100,
    enableTimer: false,
    active: true
  }
];

const DEFAULT_SETTINGS = {
  globalCooldownMinutes: 30,         // минимум между любыми напоминаниями
  globalMaxIntervalMinutes: 90,      // если давно не было напоминаний – напомнить в любом случае
  defaultNotificationType: "blocking", // blocking | nonblocking
  pauseMedia: true
};

const DEFAULT_SITES = [
  // пример (пользователь всё равно всё настраивает в options):
  // {
  //   id: "site_youtube",
  //   pattern: "youtube.com",
  //   enabled: true,
  //   triggerByTimeMinutes: 20,
  //   triggerByTransitions: 0,
  //   combineMode: "OR",
  //   notificationType: "inherit"
  // }
];

const DEFAULT_RUNTIME = {
  lastNotificationTime: 0,
  lastExerciseId: null
};

// история: массив событий
// { timestamp, dateKey, exerciseId, amount, source: 'auto' | 'manual' }

const STORAGE_KEYS = ["exercises", "settings", "sites", "history", "runtime"];

// runtime-память для времени и переходов (не обязательно переживать рестарт worker'а)
const runtimeStats = {
  active: {
    tabId: null,
    windowId: null,
    hostname: null,
    url: null
  },
  hosts: {
    // [hostname]: { minutesToday, transitionsToday, lastUrl }
  }
};

// ======= Утилиты дат/хранилища =======

function getTodayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isSameDayKey(ts, dayKey) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}` === dayKey;
}

async function getStorage(keys) {
  return await chrome.storage.local.get(keys);
}

async function setStorage(obj) {
  return await chrome.storage.local.set(obj);
}

function ensureDefaults(data) {
  const out = { ...data };
  if (!out.exercises || !Array.isArray(out.exercises) || out.exercises.length === 0) {
    out.exercises = DEFAULT_EXERCISES.map(e => ({ ...e }));
  }
  if (!out.settings) {
    out.settings = { ...DEFAULT_SETTINGS };
  } else {
    out.settings = { ...DEFAULT_SETTINGS, ...out.settings };
  }
  if (!out.sites || !Array.isArray(out.sites)) {
    out.sites = [...DEFAULT_SITES];
  }
  if (!out.history || !Array.isArray(out.history)) {
    out.history = [];
  }
  if (!out.runtime) {
    out.runtime = { ...DEFAULT_RUNTIME };
  } else {
    out.runtime = { ...DEFAULT_RUNTIME, ...out.runtime };
  }
  return out;
}

function matchSiteConfigForHostname(sites, hostname) {
  if (!hostname) return null;
  for (const site of sites || []) {
    if (!site.enabled) continue;
    const pattern = site.pattern && site.pattern.trim();
    if (!pattern) continue;
    if (hostname === pattern || hostname.endsWith("." + pattern)) {
      return site;
    }
  }
  return null;
}

function aggregateDailyTotals(history, dayKey) {
  const totals = {}; // exerciseId -> amount
  if (!Array.isArray(history)) return totals;
  for (const ev of history) {
    if (ev.dateKey === dayKey || isSameDayKey(ev.timestamp, dayKey)) {
      totals[ev.exerciseId] = (totals[ev.exerciseId] || 0) + ev.amount;
    }
  }
  return totals;
}

// лёгкая чистка истории (старше 90 дней)
function pruneHistory(history) {
  const maxAgeDays = 120;
  const now = Date.now();
  const cutoff = now - maxAgeDays * 24 * 60 * 60 * 1000;
  return history.filter(ev => ev.timestamp >= cutoff);
}

// ====== Инициализация ======

chrome.runtime.onInstalled.addListener(async () => {
  const current = await getStorage(STORAGE_KEYS);
  const withDefaults = ensureDefaults(current);
  await setStorage(withDefaults);

  // создаём периодический будильник
  chrome.alarms.create("fitsurf_tick", { periodInMinutes: 1 });
});

chrome.runtime.onStartup?.addListener(async () => {
  // на всякий случай
  const current = await getStorage(STORAGE_KEYS);
  const withDefaults = ensureDefaults(current);
  await setStorage(withDefaults);
  chrome.alarms.create("fitsurf_tick", { periodInMinutes: 1 });
});

// ====== Отслеживание активной вкладки ======

async function updateActiveTabInfo() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tabs && tabs[0] && tabs[0].url) {
    const tab = tabs[0];
    try {
      const url = new URL(tab.url);
      runtimeStats.active = {
        tabId: tab.id,
        windowId: tab.windowId,
        hostname: url.hostname,
        url: tab.url
      };
      if (!runtimeStats.hosts[url.hostname]) {
        runtimeStats.hosts[url.hostname] = {
          minutesToday: 0,
          transitionsToday: 0,
          lastUrl: tab.url
        };
      }
    } catch (e) {
      runtimeStats.active = {
        tabId: tab.id,
        windowId: tab.windowId,
        hostname: null,
        url: tab.url
      };
    }
  } else {
    runtimeStats.active = {
      tabId: null,
      windowId: null,
      hostname: null,
      url: null
    };
  }
}

chrome.tabs.onActivated.addListener(() => {
  updateActiveTabInfo();
});

chrome.windows.onFocusChanged.addListener(() => {
  updateActiveTabInfo();
});

// переходы внутри сайта
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;
  if (runtimeStats.active.tabId !== tabId) return;

  let oldHost = runtimeStats.active.hostname;
  let oldUrl = runtimeStats.active.url;
  let newHostname = null;

  try {
    const urlObj = new URL(tab.url);
    newHostname = urlObj.hostname;
  } catch (e) {
    return;
  }

  runtimeStats.active.hostname = newHostname;
  runtimeStats.active.url = tab.url;

  if (!runtimeStats.hosts[newHostname]) {
    runtimeStats.hosts[newHostname] = {
      minutesToday: 0,
      transitionsToday: 0,
      lastUrl: tab.url
    };
  }

  const hostStats = runtimeStats.hosts[newHostname];
  if (oldHost === newHostname && oldUrl && oldUrl !== tab.url) {
    hostStats.transitionsToday += 1;
    hostStats.lastUrl = tab.url;
    evaluateTriggersForHostname(newHostname).catch(console.error);
  } else {
    hostStats.lastUrl = tab.url;
  }
});

// ====== Alarms: тикаем каждую минуту ======

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "fitsurf_tick") {
    handleTick().catch(console.error);
  }
});

async function handleTick() {
  await updateActiveTabInfo();
  const hostname = runtimeStats.active.hostname;
  if (!hostname) return;
  if (!runtimeStats.hosts[hostname]) {
    runtimeStats.hosts[hostname] = {
      minutesToday: 0,
      transitionsToday: 0,
      lastUrl: runtimeStats.active.url
    };
  }
  runtimeStats.hosts[hostname].minutesToday += 1;
  await evaluateTriggersForHostname(hostname);
}

// ====== Логика триггеров ======

async function evaluateTriggersForHostname(hostname) {
  const dataRaw = await getStorage(STORAGE_KEYS);
  const data = ensureDefaults(dataRaw);

  const { settings, sites, history, runtime } = data;
  const now = Date.now();
  const lastNotificationTime = runtime.lastNotificationTime || 0;
  const sinceLastMinutes = (now - lastNotificationTime) / 60000;

  const hostStats = runtimeStats.hosts[hostname] || {
    minutesToday: 0,
    transitionsToday: 0
  };

  if (settings.globalCooldownMinutes > 0 &&
      sinceLastMinutes < settings.globalCooldownMinutes) {
    return;
  }

  let shouldNotify = false;
  const siteConfig = matchSiteConfigForHostname(sites, hostname);

  if (siteConfig) {
    const byTime = siteConfig.triggerByTimeMinutes > 0 &&
      hostStats.minutesToday >= siteConfig.triggerByTimeMinutes;
    const byTransitions = siteConfig.triggerByTransitions > 0 &&
      hostStats.transitionsToday >= siteConfig.triggerByTransitions;

    if (siteConfig.triggerByTimeMinutes > 0 && siteConfig.triggerByTransitions > 0) {
      shouldNotify = siteConfig.combineMode === "AND"
        ? (byTime && byTransitions)
        : (byTime || byTransitions);
    } else {
      shouldNotify = byTime || byTransitions;
    }
  }

  if (!shouldNotify &&
      settings.globalMaxIntervalMinutes > 0 &&
      sinceLastMinutes >= settings.globalMaxIntervalMinutes) {
    shouldNotify = true;
  }

  if (!shouldNotify) return;

  const ok = await triggerExerciseNotification(hostname, data);
  if (ok) {
    // обнуляем счётчики для этого сайта, чтобы сработало снова через новый период
    if (runtimeStats.hosts[hostname]) {
      runtimeStats.hosts[hostname].minutesToday = 0;
      runtimeStats.hosts[hostname].transitionsToday = 0;
    }
  }
}

async function triggerExerciseNotification(hostname, data) {
  const { exercises, settings, sites, history, runtime } = data;
  const todayKey = getTodayKey();
  const totals = aggregateDailyTotals(history, todayKey);
  const activeExercises = (exercises || []).filter(ex => ex.active !== false);

  const available = activeExercises.filter(ex => {
    if (!ex.dailyMax || ex.dailyMax <= 0) return true;
    const done = totals[ex.id] || 0;
    return done < ex.dailyMax;
  });

  if (!available.length) {
    return false;
  }

  let chosen = available[0];
  if (runtime.lastExerciseId && available.length > 1) {
    const alt = available.find(ex => ex.id !== runtime.lastExerciseId);
    if (alt) chosen = alt;
  }

  const siteConfig = matchSiteConfigForHostname(sites, hostname);
  let notificationType = settings.defaultNotificationType || "blocking";
  if (siteConfig && siteConfig.notificationType && siteConfig.notificationType !== "inherit") {
    notificationType = siteConfig.notificationType;
  }

  const tabId = runtimeStats.active.tabId;
  if (!tabId) return false;

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "fitsurf_showExerciseModal",
      exercise: {
        id: chosen.id,
        name: chosen.name,
        unit: chosen.unit,
        step: chosen.step,
        dailyMax: chosen.dailyMax || 0,
        enableTimer: !!chosen.enableTimer
      },
      options: {
        notificationType,
        pauseMedia: !!settings.pauseMedia
      }
    });

    const now = Date.now();
    const newRuntime = {
      ...runtime,
      lastNotificationTime: now,
      lastExerciseId: chosen.id
    };
    await setStorage({ runtime: newRuntime });
    return true;
  } catch (e) {
    console.error("Failed to send message to tab", e);
    return false;
  }
}

// ====== Логирование упражнений ======

async function logExercise(exerciseId, amount, source) {
  const dataRaw = await getStorage(["history"]);
  const history = Array.isArray(dataRaw.history) ? dataRaw.history : [];
  const now = Date.now();
  const dateKey = getTodayKey();

  const newEntry = {
    timestamp: now,
    dateKey,
    exerciseId,
    amount,
    source
  };

  const newHistory = pruneHistory([...history, newEntry]);
  await setStorage({ history: newHistory });
  return newHistory;
}

// ====== Обработчик сообщений от content script / popup / options ======

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type } = message || {};
  if (!type) return;

  (async () => {
    try {
      if (type === "fitsurf_modalCompleted") {
        const { exerciseId, amount } = message;
        if (exerciseId && amount > 0) {
          const history = await logExercise(exerciseId, amount, "auto");
          sendResponse({ ok: true, historyUpdated: true });
        } else {
          sendResponse({ ok: false });
        }
      } else if (type === "fitsurf_modalPostponed") {
        const dataRaw = await getStorage(["runtime"]);
        const runtime = dataRaw.runtime || { ...DEFAULT_RUNTIME };
        const now = Date.now();
        const newRuntime = { ...runtime, lastNotificationTime: now };
        await setStorage({ runtime: newRuntime });
        sendResponse({ ok: true });
      } else if (type === "fitsurf_modalNextExercise") {
        const currentId = message.currentExerciseId;
        const dataRaw = await getStorage(STORAGE_KEYS);
        const data = ensureDefaults(dataRaw);
        const todayKey = getTodayKey();
        const totals = aggregateDailyTotals(data.history, todayKey);
        const activeExercises = data.exercises.filter(ex => ex.active !== false);

        const available = activeExercises.filter(ex => {
          if (ex.id === currentId) return false;
          if (!ex.dailyMax || ex.dailyMax <= 0) return true;
          const done = totals[ex.id] || 0;
          return done < ex.dailyMax;
        });

        if (!available.length) {
          sendResponse({ ok: false, reason: "no_other_exercises" });
          return;
        }

        const next = available[0];
        sendResponse({
          ok: true,
          exercise: {
            id: next.id,
            name: next.name,
            unit: next.unit,
            step: next.step,
            dailyMax: next.dailyMax || 0,
            enableTimer: !!next.enableTimer
          }
        });
      } else if (type === "fitsurf_getTodaySummary") {
        const dataRaw = await getStorage(STORAGE_KEYS);
        const data = ensureDefaults(dataRaw);
        const todayKey = getTodayKey();
        const totals = aggregateDailyTotals(data.history, todayKey);
        sendResponse({
          ok: true,
          exercises: data.exercises,
          totals,
          todayKey
        });
      } else if (type === "fitsurf_addManualExercise") {
        const { exerciseId, amount } = message;
        if (!exerciseId || !amount || amount <= 0) {
          sendResponse({ ok: false });
          return;
        }
        const history = await logExercise(exerciseId, amount, "manual");
        const todayKey = getTodayKey();
        const totals = aggregateDailyTotals(history, todayKey);
        sendResponse({ ok: true, totals });
      } else if (type === "fitsurf_getConfig") {
        const dataRaw = await getStorage(STORAGE_KEYS);
        const data = ensureDefaults(dataRaw);
        await setStorage(data);
        sendResponse({
          ok: true,
          exercises: data.exercises,
          settings: data.settings,
          sites: data.sites
        });
      } else if (type === "fitsurf_saveConfig") {
        const { exercises, settings, sites } = message;
        if (Array.isArray(exercises)) {
          await setStorage({ exercises });
        }
        if (settings && typeof settings === "object") {
          const oldSettingsRaw = await getStorage(["settings"]);
          const merged = { ...DEFAULT_SETTINGS, ...(oldSettingsRaw.settings || {}), ...settings };
          await setStorage({ settings: merged });
        }
        if (Array.isArray(sites)) {
          await setStorage({ sites });
        }
        sendResponse({ ok: true });
      } else if (type === "fitsurf_getStats") {
        const { periodDays } = message;
        const days = periodDays && periodDays > 0 ? periodDays : 7;
        const dataRaw = await getStorage(["history", "exercises"]);
        const history = Array.isArray(dataRaw.history) ? dataRaw.history : [];
        const exercises = Array.isArray(dataRaw.exercises) ? dataRaw.exercises : [];
        const now = Date.now();
        const cutoff = now - days * 24 * 60 * 60 * 1000;

        const filtered = history.filter(ev => ev.timestamp >= cutoff);
        const byDay = {}; // dateKey -> { exerciseId -> amount }
        for (const ev of filtered) {
          const dKey = ev.dateKey || getTodayKey();
          if (!byDay[dKey]) byDay[dKey] = {};
          byDay[dKey][ev.exerciseId] = (byDay[dKey][ev.exerciseId] || 0) + ev.amount;
        }

        sendResponse({
          ok: true,
          byDay,
          exercises
        });
      } else if (type === "fitsurf_exportAll") {
        const dataRaw = await getStorage(STORAGE_KEYS);
        const data = ensureDefaults(dataRaw);
        sendResponse({
          ok: true,
          exportJson: JSON.stringify(
            {
              exercises: data.exercises,
              settings: data.settings,
              sites: data.sites,
              history: data.history
            },
            null,
            2
          )
        });
      } else if (type === "fitsurf_importAll") {
        const { json } = message;
        try {
          const parsed = JSON.parse(json);
          const toStore = {};
          if (Array.isArray(parsed.exercises)) {
            toStore.exercises = parsed.exercises;
          }
          if (parsed.settings && typeof parsed.settings === "object") {
            toStore.settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
          }
          if (Array.isArray(parsed.sites)) {
            toStore.sites = parsed.sites;
          }
          if (Array.isArray(parsed.history)) {
            toStore.history = parsed.history;
          }
          const newRuntime = { ...DEFAULT_RUNTIME };
          toStore.runtime = newRuntime;
          await setStorage(toStore);
          sendResponse({ ok: true });
        } catch (e) {
          console.error("Import error", e);
          sendResponse({ ok: false, error: "parse_error" });
        }
      } else if (type === "fitsurf_getCurrentTabDomain") {
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tabs[0] || !tabs[0].url) {
          sendResponse({ ok: false });
          return;
        }
        try {
          const urlObj = new URL(tabs[0].url);
          sendResponse({ ok: true, hostname: urlObj.hostname });
        } catch {
          sendResponse({ ok: false });
        }
      } else {
        sendResponse({ ok: false });
      }
    } catch (e) {
      console.error("Message handling error", e);
      try {
        sendResponse({ ok: false, error: e && e.message });
      } catch {}
    }
  })();

  return true; // async
});
