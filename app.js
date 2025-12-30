const DEFAULTS = {
  focusMinutes: 25,
  breakMinutes: 5,
  historyLimit: 30,
};

const STORAGE_KEYS = {
  settings: "ft_settings",
  state: "ft_state",
  history: "ft_history",
};

const elements = {
  modeLabel: document.getElementById("modeLabel"),
  timeDisplay: document.getElementById("timeDisplay"),
  sessionMeta: document.getElementById("sessionMeta"),
  toggleBtn: document.getElementById("toggleBtn"),
  resetBtn: document.getElementById("resetBtn"),
  skipBtn: document.getElementById("skipBtn"),
  progressFill: document.getElementById("progressFill"),
  focusInput: document.getElementById("focusInput"),
  breakInput: document.getElementById("breakInput"),
  settingsForm: document.getElementById("settingsForm"),
  clearStorageBtn: document.getElementById("clearStorageBtn"),
  historyList: document.getElementById("historyList"),
};

let settings = loadSettings();
let state = loadState(settings);
let timerId = null;

primeSettingsInputs();
renderState();
renderHistory();

const tick = () => {
  state = loadState(settings);
  if (!state.running) {
    return;
  }

  state.lastTick = Date.now();
  updateFromEndAt(Date.now());
  persistState();
  renderState();
};

elements.toggleBtn.addEventListener("click", () => {
  state = loadState(settings);
  state.running = !state.running;
  if (state.running) {
    state.endAt = Date.now() + state.remaining * 1000;
    startTimer();
  } else {
    updateFromEndAt(Date.now());
    state.endAt = null;
    stopTimer();
  }
  persistState();
  renderState();
});

elements.resetBtn.addEventListener("click", () => {
  state = loadState(settings);
  stopTimer();
  state.running = false;
  state.mode = "focus";
  state.remaining = settings.focusMinutes * 60;
  state.cycle = 1;
  state.endAt = null;
  persistState();
  renderState();
});

elements.skipBtn.addEventListener("click", () => {
  state = loadState(settings);
  stopTimer();
  state.running = false;
  state.endAt = null;
  completeBlock();
  persistState();
  renderState();
});

elements.settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const focusMinutes = clampInt(elements.focusInput.value, 1, 180);
  const breakMinutes = clampInt(elements.breakInput.value, 1, 60);
  settings.focusMinutes = focusMinutes;
  settings.breakMinutes = breakMinutes;
  saveSettings();

  state = loadState(settings);
  if (!state.running) {
    state.remaining =
      state.mode === "focus" ? focusMinutes * 60 : breakMinutes * 60;
    persistState();
    renderState();
  }
});

elements.clearStorageBtn.addEventListener("click", () => {
  stopTimer();
  localStorage.removeItem(STORAGE_KEYS.settings);
  localStorage.removeItem(STORAGE_KEYS.state);
  localStorage.removeItem(STORAGE_KEYS.history);
  settings = loadSettings();
  state = loadState(settings);
  primeSettingsInputs();
  renderState();
  renderHistory();
});

function startTimer() {
  if (timerId) {
    return;
  }
  timerId = window.setInterval(tick, 1000);
}

function stopTimer() {
  if (timerId) {
    window.clearInterval(timerId);
    timerId = null;
  }
}

function updateFromEndAt(now, options = {}) {
  if (!isFiniteNumber(state.endAt)) {
    return;
  }
  while (state.endAt <= now) {
    completeBlock(state.endAt, options);
    const nextDuration =
      state.mode === "focus"
        ? settings.focusMinutes * 60
        : settings.breakMinutes * 60;
    state.endAt += nextDuration * 1000;
  }
  state.remaining = Math.max(0, Math.ceil((state.endAt - now) / 1000));
}

function completeBlock(completedAt, options = {}) {
  const completedMode = state.mode;
  const durationMinutes =
    completedMode === "focus" ? settings.focusMinutes : settings.breakMinutes;
  addHistory({
    mode: completedMode,
    durationMinutes,
    completedAt: new Date(completedAt || Date.now()).toISOString(),
  });

  if (state.mode === "focus") {
    state.mode = "break";
  } else {
    state.mode = "focus";
    state.cycle += 1;
  }
  state.remaining =
    state.mode === "focus"
      ? settings.focusMinutes * 60
      : settings.breakMinutes * 60;
  if (!options.silent) {
    playChime();
  }
}

function renderState() {
  elements.modeLabel.textContent = state.mode === "focus" ? "Focus" : "Break";
  elements.timeDisplay.textContent = formatTime(state.remaining);
  elements.sessionMeta.textContent = `Cycle ${state.cycle}`;
  elements.toggleBtn.textContent = state.running ? "Pause" : "Start";

  const totalSeconds =
    state.mode === "focus"
      ? settings.focusMinutes * 60
      : settings.breakMinutes * 60;
  const progress = ((totalSeconds - state.remaining) / totalSeconds) * 100;
  elements.progressFill.style.width = `${Math.min(100, Math.max(0, progress))}%`;
}

function primeSettingsInputs() {
  elements.focusInput.value = settings.focusMinutes;
  elements.breakInput.value = settings.breakMinutes;
}

function addHistory(entry) {
  const history = loadHistory();
  history.unshift(entry);
  const trimmed = history.slice(0, DEFAULTS.historyLimit);
  localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(trimmed));
  renderHistory();
}

function renderHistory() {
  const history = loadHistory();
  if (!history.length) {
    elements.historyList.innerHTML =
      "<div class=\"history-item\">No sessions yet. Start a focus block. <span>Ready when you are.</span></div>";
    return;
  }

  elements.historyList.innerHTML = history
    .map((item) => {
      const label = item.mode === "focus" ? "Focus" : "Break";
      const when = new Date(item.completedAt).toLocaleString();
      return `
        <div class="history-item" role="listitem">
          <strong>${label} · ${item.durationMinutes} min</strong>
          <span>${when}</span>
        </div>
      `;
    })
    .join("");
}

function resumeFromStoredState() {
  state = loadState(settings);
  if (state.running) {
    if (!isFiniteNumber(state.remaining)) {
      state.remaining =
        state.mode === "focus"
          ? settings.focusMinutes * 60
          : settings.breakMinutes * 60;
    }
    if (!isFiniteNumber(state.endAt)) {
      if (state.savedAt) {
        state.endAt = state.savedAt + state.remaining * 1000;
      } else {
        state.endAt = Date.now() + state.remaining * 1000;
      }
    }
    updateFromEndAt(Date.now(), { silent: true });
    startTimer();
    persistState();
    renderState();
  }
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function clampInt(value, min, max) {
  const numberValue = Number.parseInt(value, 10);
  if (Number.isNaN(numberValue)) {
    return min;
  }
  return Math.min(max, Math.max(min, numberValue));
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function loadSettings() {
  const stored = localStorage.getItem(STORAGE_KEYS.settings);
  if (!stored) {
    return { ...DEFAULTS };
  }
  try {
    const parsed = JSON.parse(stored);
    return {
      ...DEFAULTS,
      ...parsed,
    };
  } catch (error) {
    return { ...DEFAULTS };
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
}

function loadState(currentSettings) {
  const stored = localStorage.getItem(STORAGE_KEYS.state);
  if (!stored) {
    return {
      mode: "focus",
      remaining: currentSettings.focusMinutes * 60,
      running: false,
      endAt: null,
      savedAt: null,
      lastTick: null,
      cycle: 1,
    };
  }
  try {
    const parsed = JSON.parse(stored);
    const savedAt = isFiniteNumber(parsed.savedAt) ? parsed.savedAt : null;
    const remaining = isFiniteNumber(parsed.remaining)
      ? parsed.remaining
      : currentSettings.focusMinutes * 60;
    const lastTick = isFiniteNumber(parsed.lastTick) ? parsed.lastTick : null;
    let endAt = isFiniteNumber(parsed.endAt) ? parsed.endAt : null;
    if (!endAt && parsed.running) {
      if (lastTick) {
        endAt = lastTick + remaining * 1000;
      } else if (savedAt) {
        endAt = savedAt + remaining * 1000;
      } else {
        endAt = Date.now() + remaining * 1000;
      }
    }
    return {
      mode: parsed.mode || "focus",
      remaining,
      running: Boolean(parsed.running),
      endAt,
      savedAt,
      lastTick,
      cycle: parsed.cycle || 1,
    };
  } catch (error) {
    return {
      mode: "focus",
      remaining: currentSettings.focusMinutes * 60,
      running: false,
      endAt: null,
      savedAt: null,
      lastTick: null,
      cycle: 1,
    };
  }
}

function persistState() {
  state.savedAt = Date.now();
  state.lastTick = state.running ? state.savedAt : null;
  localStorage.setItem(STORAGE_KEYS.state, JSON.stringify(state));
}

function loadHistory() {
  const stored = localStorage.getItem(STORAGE_KEYS.history);
  if (!stored) {
    return [];
  }
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function playChime() {
  try {
    const audioContext = new (window.AudioContext ||
      window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 640;
    gain.gain.value = 0.1;
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.25);
  } catch (error) {
    // Some browsers block audio before a user gesture; fail silently.
  }
}

resumeFromStoredState();
