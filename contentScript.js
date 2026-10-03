// contentScript.js

let fitsurfModalElement = null;
let fitsurfBlockedVideoElements = [];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === "fitsurf_showExerciseModal") {
    const { exercise, options } = message;
    showExerciseModal(exercise, options);
  } else if (message.type === "fitsurf_updateExerciseModal") {
    const { exercise } = message;
    updateExerciseModal(exercise);
  }
});

// Создание модалки
function showExerciseModal(exercise, options) {
  removeExistingModal();

  const notificationType = options?.notificationType || "blocking";
  const pauseMedia = !!options?.pauseMedia;

  if (pauseMedia) {
    pauseAllPlayingVideos();
  }

  const overlay = document.createElement("div");
  overlay.id = "fitsurf-overlay";
  overlay.style.position = "fixed";
  overlay.style.zIndex = "2147483647";
  overlay.style.top = "0";
  overlay.style.left = "0";
  overlay.style.width = "100%";
  overlay.style.height = "100%";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";

  if (notificationType === "blocking") {
    overlay.style.backgroundColor = "rgba(0, 0, 0, 0.6)";
    overlay.style.pointerEvents = "auto";
  } else {
    overlay.style.backgroundColor = "transparent";
    overlay.style.pointerEvents = "none";
  }

  const container = document.createElement("div");
  container.id = "fitsurf-modal";
  container.style.background = "#ffffff";
  container.style.borderRadius = "12px";
  container.style.boxShadow = "0 10px 25px rgba(0,0,0,0.2)";
  container.style.padding = "20px 24px 18px 24px";
  container.style.maxWidth = "320px";
  container.style.width = "100%";
  container.style.pointerEvents = "auto";
  container.style.boxSizing = "border-box";
  container.style.color = "#222";

  if (notificationType !== "blocking") {
    container.style.position = "fixed";
    container.style.bottom = "20px";
    container.style.right = "20px";
  }

  const title = document.createElement("div");
  title.textContent = "Пора размяться 💪";
  title.style.fontSize = "18px";
  title.style.fontWeight = "600";
  title.style.marginBottom = "8px";

  const subt = document.createElement("div");
  subt.id = "fitsurf-exercise-text";
  subt.style.fontSize = "14px";
  subt.style.marginBottom = "12px";

  const dailyInfo = document.createElement("div");
  dailyInfo.id = "fitsurf-exercise-daily";
  dailyInfo.style.fontSize = "12px";
  dailyInfo.style.color = "#666";
  dailyInfo.style.marginBottom = "14px";

  const buttonsRow = document.createElement("div");
  buttonsRow.style.display = "flex";
  buttonsRow.style.gap = "8px";
  buttonsRow.style.justifyContent = "space-between";

  const btnDone = document.createElement("button");
  btnDone.textContent = "Сделал";
  styleButtonPrimary(btnDone);

  const btnOther = document.createElement("button");
  btnOther.textContent = "Другое";
  styleButtonSecondary(btnOther);

  const btnLater = document.createElement("button");
  btnLater.textContent = "Позже";
  styleButtonSecondary(btnLater);

  buttonsRow.appendChild(btnDone);
  buttonsRow.appendChild(btnOther);
  buttonsRow.appendChild(btnLater);

  const footer = document.createElement("div");
  footer.style.fontSize = "11px";
  footer.style.color = "#999";
  footer.style.marginTop = "10px";
  footer.textContent = "FitSurf — забота о теле во время серфинга";

  container.appendChild(title);
  container.appendChild(subt);
  container.appendChild(dailyInfo);
  container.appendChild(buttonsRow);
  container.appendChild(footer);
  overlay.appendChild(container);
  document.documentElement.appendChild(overlay);

  fitsurfModalElement = overlay;
  updateExerciseText(exercise);

  btnDone.addEventListener("click", () => {
    chrome.runtime.sendMessage(
      {
        type: "fitsurf_modalCompleted",
        exerciseId: exercise.id,
        amount: exercise.step
      },
      () => {
        removeExistingModal();
      }
    );
  });

  btnOther.addEventListener("click", () => {
    chrome.runtime.sendMessage(
      { type: "fitsurf_modalNextExercise", currentExerciseId: exercise.id },
      (response) => {
        if (response && response.ok && response.exercise) {
          updateExerciseModal(response.exercise);
        } else {
          removeExistingModal();
        }
      }
    );
  });

  btnLater.addEventListener("click", () => {
    chrome.runtime.sendMessage(
      {
        type: "fitsurf_modalPostponed"
      },
      () => {
        removeExistingModal();
      }
    );
  });

  if (notificationType !== "blocking") {
    setTimeout(() => {
      if (fitsurfModalElement) removeExistingModal();
    }, 30000);
  }
}

function updateExerciseText(exercise) {
  const textEl = document.getElementById("fitsurf-exercise-text");
  const dailyEl = document.getElementById("fitsurf-exercise-daily");
  if (!textEl || !dailyEl) return;
  const unit = exercise.unit || "повторений";
  const step = exercise.step || 10;
  textEl.textContent = `Сделайте ${step} ${unit} упражнения «${exercise.name}».`;
  if (exercise.dailyMax && exercise.dailyMax > 0) {
    dailyEl.textContent = `Максимум на сегодня: ${exercise.dailyMax} ${unit}.`;
  } else {
    dailyEl.textContent = "";
  }
}

function updateExerciseModal(exercise) {
  if (!fitsurfModalElement) {
    showExerciseModal(exercise, { notificationType: "blocking", pauseMedia: false });
    return;
  }
  updateExerciseText(exercise);
}

function styleButtonPrimary(btn) {
  btn.style.flex = "1 1 auto";
  btn.style.border = "none";
  btn.style.borderRadius = "8px";
  btn.style.padding = "8px 10px";
  btn.style.fontSize = "14px";
  btn.style.cursor = "pointer";
  btn.style.background = "#2563EB";
  btn.style.color = "#fff";
}

function styleButtonSecondary(btn) {
  btn.style.flex = "1 1 auto";
  btn.style.borderRadius = "8px";
  btn.style.padding = "8px 10px";
  btn.style.fontSize = "14px";
  btn.style.cursor = "pointer";
  btn.style.border = "1px solid #ccc";
  btn.style.background = "#f8f8f8";
  btn.style.color = "#333";
}

function removeExistingModal() {
  if (fitsurfModalElement && fitsurfModalElement.parentNode) {
    fitsurfModalElement.parentNode.removeChild(fitsurfModalElement);
  }
  fitsurfModalElement = null;
  fitsurfBlockedVideoElements = [];
}

function pauseAllPlayingVideos() {
  const videos = Array.from(document.querySelectorAll("video"));
  fitsurfBlockedVideoElements = [];
  for (const v of videos) {
    try {
      if (!v.paused && !v.ended) {
        v.pause();
        fitsurfBlockedVideoElements.push(v);
      }
    } catch (e) {
      // ignore
    }
  }
}
