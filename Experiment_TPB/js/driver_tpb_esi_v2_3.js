// ER‑TPB v2.3: reliable start, active mode buttons, diagnosis-grounded vitals, LLM mode
// Includes Headless Parallel Execution support

(async function () {
  const cfg = window.APP_CONFIG;
  const R = (id) => document.getElementById(id);
  const log = (msg) => { R('log').textContent = `[${new Date().toLocaleTimeString()}] ${msg}\n` + R('log').textContent; };
  const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function addClass(el, c) { el.classList.add(c); }
  function rmClass(el, c) { el.classList.remove(c); }

  // Setup webhook url and cheat code listener
  let WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbzyZHP0KBEsq0hnyFrE8sWIVuZFFHIbhvngklXmiAojQa_y6ZYbiL9bjZQmGJXV2yXK/exec";
  const secretCode = "whosyourdaddy";
  let keysPressed = "";

  document.addEventListener('keydown', (e) => {
    keysPressed += e.key;
    if (keysPressed.length > secretCode.length) {
      keysPressed = keysPressed.slice(-secretCode.length);
    }
    if (keysPressed.toLowerCase() === secretCode) {
      const controls = document.getElementById('controls_panel');
      if (controls) {
        controls.style.display = controls.style.display === 'none' ? 'block' : 'none';
      }
    }
  });

  // Logic Helpers (Pure)
  const Logic = {
    samplePatient: (cfg) => {
      const ages = cfg.patient_profiles.ages;
      const sets = cfg.patient_profiles.comorbid_sets;
      return { age: choice(ages), comorbid: choice(sets) };
    },
    sampleTrueDx: (cfg, highPrev) => {
      const pool = cfg.dx_options;
      const w = pool.map(dx => {
        if (dx === 'Stable / no acute condition') return highPrev ? 0.8 : 1.2;
        if (dx === 'Respiratory failure') return highPrev ? 1.3 : 1.0;
        if (dx === 'Cardiac event') return 1.1;
        if (dx === 'Massive hemorrhage') return 0.9;
        if (dx === 'Infection / sepsis') return 1.2;
        if (dx === 'Neurological event (stroke-like)') return 1.0;
        return 1.0;
      });
      const sum = w.reduce((a, b) => a + b, 0);
      let u = Math.random() * sum;
      for (let i = 0; i < w.length; i++) { u -= w[i]; if (u <= 0) return pool[i]; }
      return pool[0];
    },
    sampleSeverity: (cfg, highPrev) => {
      const prev = highPrev ? cfg.ui_defaults.prevalence_high : cfg.ui_defaults.prevalence_low;
      const u = Math.random();
      if (u < prev * 0.35) return 'LSI';
      if (u < prev) return 'HR';
      return 'STABLE';
    },
    maybeFlipSeverity: (sev, highVol, cfg) => {
      if (sev === 'LSI') return sev; // Terminal state in this simplifed logic
      const p = highVol ? cfg.ui_defaults.vol_high : cfg.ui_defaults.vol_low;
      if (Math.random() < p) {
        if (sev === 'STABLE') return 'HR';
        if (sev === 'HR') return 'LSI';
      }
      return sev;
    },
    vitalsFromDx: (trueDx, severity, comorbid, highNoise, cfg) => {
      const base = {
        'Respiratory failure': { HR: 110, SBP: 105, RR: 28, SpO2: 86, Temp: 37.5, AVPU: 'V' },
        'Cardiac event': { HR: 102, SBP: 110, RR: 20, SpO2: 94, Temp: 37.0, AVPU: 'A' },
        'Massive hemorrhage': { HR: 122, SBP: 85, RR: 24, SpO2: 93, Temp: 36.8, AVPU: 'A' },
        'Infection / sepsis': { HR: 110, SBP: 95, RR: 22, SpO2: 94, Temp: 38.8, AVPU: 'A' },
        'Neurological event (stroke-like)': { HR: 90, SBP: 160, RR: 18, SpO2: 96, Temp: 37.0, AVPU: 'V' },
        'Stable / no acute condition': { HR: 80, SBP: 120, RR: 16, SpO2: 98, Temp: 36.9, AVPU: 'A' },
      }[trueDx];
      const sev = {
        'STABLE': { dHR: 0, dSBP: 0, dRR: 0, dSpO2: 0, dTemp: 0, AVPU: null },
        'HR': { dHR: +10, dSBP: -10, dRR: +4, dSpO2: -2, dTemp: +0.2, AVPU: null },
        'LSI': { dHR: +20, dSBP: -20, dRR: +8, dSpO2: -6, dTemp: +0.3, AVPU: 'U' }
      }[severity];
      let cHR = 0, cSBP = 0, cRR = 0, cSpO2 = 0, cTemp = 0;
      if (comorbid) {
        if (comorbid.includes('Hypertension')) cSBP += 10;
        if (comorbid.includes('COPD')) { cRR += 2; cSpO2 -= 2; }
        if (comorbid.includes('Diabetes')) cTemp += 0.1;
        if (comorbid.includes('CKD')) cSBP -= 5;
        if (comorbid.includes('CAD')) cHR += 4;
        if (comorbid.includes('Immunosuppressed')) cTemp += 0.2;
        if (comorbid.includes('Anticoagulant use')) cSBP -= 3;
      }
      const noise = highNoise ? cfg.ui_defaults.noise_high : cfg.ui_defaults.noise_low;
      const jitter = (v, s) => (v + (Math.random() * 2 - 1) * s * 5);
      let HR = Math.round(jitter(base.HR + sev.dHR + cHR, noise));
      let SBP = Math.round(jitter(base.SBP + sev.dSBP + cSBP, noise));
      let RR = Math.round(jitter(base.RR + sev.dRR + cRR, noise));
      let SpO2 = Math.max(70, Math.min(100, Math.round(jitter(base.SpO2 + sev.dSpO2 + cSpO2, noise))));
      let Temp = (base.Temp + sev.dTemp + cTemp + (Math.random() * 2 - 1) * 0.1 * noise).toFixed(1);
      let AVPU = sev.AVPU ? sev.AVPU : base.AVPU;
      const DBP = Math.max(40, Math.round(SBP * 0.6));
      return { HR, BP: `${SBP}/${DBP}`, RR, SpO2, Temp, AVPU };
    },
    flagsFromDx: (trueDx, severity) => {
      const f = {
        'Respiratory failure': ['cyanosis', 'accessory muscles', 'tachypnea'],
        'Cardiac event': ['diaphoresis', 'pressure-like chest pain', 'ECG changes?'],
        'Massive hemorrhage': ['pallor', 'weak pulses', 'cool extremities'],
        'Infection / sepsis': ['fever', 'rigors', 'warm flushed skin?'],
        'Neurological event (stroke-like)': ['facial droop?', 'slurred speech?', 'arm drift?'],
        'Stable / no acute condition': ['anxious', 'mild discomfort']
      }[trueDx];
      if (severity === 'LSI') return f.slice(0, 3);
      if (severity === 'HR') return f.slice(0, 2);
      return f.slice(1, 3);
    }
  };


  // --- Removed Headless Experiment ---


  // Progress indicator
  const progressIndicator = R('progressIndicator');
  function updateProgress() {
    const completed = runLog ? runLog.trials.length : 0;
    const target = Number(controls.trials?.value) || cfg.trials_per_block;
    progressIndicator.textContent = `${completed}/${target} finished`;
  }

  // Mode selection
  let mode = 'human';

  // Controls & Buttons
  const controls = {
    prevalence: R('ctl_prevalence'),
    noise: R('ctl_noise'),
    vol: R('ctl_vol'),
    maxticks: R('ctl_maxticks'),
    trials: R('ctl_trials'),
  };
  const btn = {
    start: R('startBtn'),
    next: R('advanceBtn'),
    final: R('finalizeBtn'),
    restart: R('restartBtn'),
    dl: R('downloadBtn')
  };

  // Removed API Configuration and Testing logic

  // Modal
  const modalBg = document.getElementById('modalBg');
  const esiSelect = document.getElementById('esiSelect');
  const confirmESI = document.getElementById('confirmESI');
  const ctxReqHint = document.getElementById('ctxReqHint');
  const openModal = () => { modalBg.classList.add('active'); };
  const closeModal = () => { modalBg.classList.remove('active'); };

  // Build BF diagnosis options
  const dxList = R('dxList');
  const dxOptions = (cfg.dx_options || []);
  function rebuildDx() {
    dxList.innerHTML = '';
    dxOptions.forEach((label, i) => {
      const id = `dx_${i}`;
      const row = document.createElement('label');
      row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '8px';
      row.innerHTML = `<input type="radio" name="dx" value="${label}" id="${id}"><span>${label}</span>`;
      dxList.appendChild(row);
    });
  }
  rebuildDx();

  // Context slider
  const ctxSlider = R('ctxSlider');
  const ctxVal = R('ctxVal');
  const ctxBanner = R('ctxBanner');
  let ctxUpdateCount = 0;
  ctxSlider.addEventListener('input', () => {
    ctxVal.innerText = ctxSlider.value;
    if (trial && !done) {
      const s = trial.steps[trial.steps.length - 1];
      s.BC_updates.push({ tick: s.tick, ctx: Number(ctxSlider.value) });
      ctxUpdateCount += 1;
    }
  });

  // Removed LLM textareas and applying logic

  function renderPatient(p, cc, trueDx) {
    R('Age').innerText = p.age;
    R('Comorbid').innerText = (p.comorbid && p.comorbid.length) ? p.comorbid.join(', ') : 'None';
    R('CC').innerText = cc;
    R('TrueDx').innerText = trueDx;
  }

  function updateVitalsPanel(v, flags, t, T) {
    R('HR').innerText = v.HR;
    R('BP').innerText = v.BP;
    R('RR').innerText = v.RR;
    R('SpO2').innerText = v.SpO2;
    R('Temp').innerText = v.Temp;
    R('AVPU').innerText = v.AVPU;
    R('Trend').innerText = (t === 1 ? "—" : "mixed");
    R('Flags').innerText = flags.join(', ');
    R('tickLbl').innerText = `tick ${t}/${T} (cap ${trial.maxT})`;
  }

  function getSelectedDx() {
    const el = dxList.querySelector('input[name="dx"]:checked');
    return el ? el.value : null;
  }

  // State
  let runLog = null;
  let trial = null;
  let tickIdx = 0;
  let done = false;

  const CCs = ["chest pain", "dyspnea", "abdominal pain", "syncope", "fever + cough", "headache + neuro deficit?", "trauma (fall)", "palpitations"];

  // Buttons
  btn.start.onclick = () => start(true);
  btn.next.onclick = () => stepTick();
  btn.final.onclick = () => finalizeESIModal();
  btn.restart.onclick = () => restartTrial();
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); if (!btn.next.disabled) stepTick(); }
    else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); if (!btn.final.disabled) finalizeESIModal(); }
    else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); if (!btn.restart.disabled) restartTrial(); }
  });
  btn.dl.onclick = () => downloadRun();

  function enableRun(on) {
    btn.next.disabled = !on;
    btn.final.disabled = !on;
    btn.restart.disabled = !on;
  }

  function start(forceReset = false) {
    if (forceReset || !runLog) {
      runLog = {
        session: cfg.session, mode, trials: [], controls: {
          prevalence: controls.prevalence.value, noise: controls.noise.value,
          volatility: controls.vol.value, max_ticks: Number(controls.maxticks.value) || cfg.max_ticks,
          trials: Number(controls.trials.value) || cfg.trials_per_block
        }
      };
      R('log').textContent = ''; // Clear log UI
      log('Current session reset.');
    } else {
      runLog.mode = mode;
    }
    updateProgress();
    btn.dl.disabled = true;
    enableRun(true);
    R('status').innerText = (mode === 'llm' ? 'LLM mode. Space=Next, F=Finalize (modal), R=Restart.' : 'Human mode. Space=Next, F=Finalize (modal), R=Restart.');
    newTrial();
  }

  function restartTrial() {
    if (!runLog) { start(); return; }
    log('Trial restarted.');
    R('status').innerText = (mode === 'llm' ? 'LLM mode.' : 'Human mode.') + ' Space=Next, F=Finalize, R=Restart.';
    enableRun(true);
    newTrial();
  }

  function newTrial() {
    const [minT, maxT] = cfg.tick_range;
    const drawnT = Math.floor(Math.random() * (maxT - minT + 1)) + minT;
    const cap = Number(controls.maxticks.value) || cfg.max_ticks;
    const T = Math.min(drawnT, cap);

    const patient = Logic.samplePatient(cfg);
    const cc = choice(CCs);
    const highPrev = controls.prevalence.value === 'high';
    const trueDx = Logic.sampleTrueDx(cfg, highPrev);
    Math.random(); // Sync random burn
    const severity0 = Logic.sampleSeverity(cfg, highPrev);

    trial = {
      T, maxT: cap, cc, patient, trueDx,
      severity: severity0,
      steps: [], finalized: null,
      ctxUpdates: 0
    };
    tickIdx = 0; done = false;

    ctxSlider.value = 0; ctxVal.innerText = '0'; ctxUpdateCount = 0;
    dxList.querySelectorAll('input[name="dx"]').forEach(e => e.checked = false);
    renderPatient(patient, cc, trueDx);

    log(`New trial: T=${T} (cap ${cap}), Dx=${trueDx}, Sev=${severity0}, CC=${cc}, age=${patient.age}, comorbid=${JSON.stringify(patient.comorbid)}`);
    stepTick(true);
  }

  function stepTick(first = false) {
    if (done) return;
    if (!first) {
      const highVol = controls.vol.value === 'high';
      trial.severity = Logic.maybeFlipSeverity(trial.severity, highVol, cfg);
    }
    const highNoise = controls.noise.value === 'high';
    const vitals = Logic.vitalsFromDx(trial.trueDx, trial.severity, trial.patient.comorbid, highNoise, cfg);
    const t = Math.min(tickIdx + 1, trial.T);
    const flags = Logic.flagsFromDx(trial.trueDx, trial.severity);
    updateVitalsPanel(vitals, flags, t, trial.T);

    const rt = cfg.ctx.reminder_ticks;
    const lastMinusOne = Math.max(1, trial.T - 1);
    const remA = (rt[0] === -1 ? lastMinusOne : rt[0]);
    const remB = (rt[1] === -1 ? lastMinusOne : rt[1]);
    const showReminder = (t === remA) || (t === remB);
    R('ctxBanner').style.display = showReminder ? 'block' : 'none';

    const step = {
      tick: t, vitals, cc: trial.cc, patient: trial.patient, flags,
      BF_dx: getSelectedDx(),
      BC_updates: [],
      severity: trial.severity,
      trueDx: trial.trueDx
    };
    trial.steps.push(step);
    tickIdx = t;
    log(`Tick advanced to ${t}/${trial.T}`);

    if (mode === 'llm') {
      console.log(Logic.buildPrompt({ tick: t, T: trial.T, vitals, flags, patient: trial.patient, cc: trial.cc, dx_options: cfg.dx_options }));
    }

    if (t === trial.T) {
      R('status').innerText = 'Time limit reached for this case. Please finalize ESI.';
      btn.next.disabled = true;
      finalizeESIModal();
    }
  }

  function finalizeESIModal() {
    if (done) return;
    ctxReqHint.style.display = (ctxUpdateCount < cfg.ctx.min_required_updates) ? 'block' : 'none';
    openModal();
  }

  function applyLLMResponse(obj) {
    const s = trial.steps[trial.steps.length - 1];

    // Support both formats: prefer nested (BF, BC, action), fallback to flat (dx, ctx, esi)
    const dx = obj.BF?.dx || obj.dx;
    const ctx = obj.BC?.ctx ?? obj.ctx;
    const esi = obj.action?.finalize_ESI ?? obj.esi;

    if (dx) {
      s.BF_dx = String(dx);
      const radios = dxList.querySelectorAll('input[name="dx"]');
      radios.forEach(r => { if (r.value === s.BF_dx) r.checked = true; });
      log(`LLM BF dx: ${s.BF_dx}`);
    }

    if (typeof ctx === 'number') {
      const v = Math.max(0, Math.min(100, Math.round(ctx)));
      ctxSlider.value = v; ctxVal.innerText = String(v);
      s.BC_updates.push({ tick: s.tick, ctx: v });
      ctxUpdateCount += 1;
      log(`LLM BC ctx: ${v}`);
    }

    if (esi != null) {
      const lvl = Math.max(1, Math.min(5, Number(esi)));
      esiSelect.value = String(lvl);
      finalizeESIModal();
      log(`LLM finalize ESI=${lvl}`);
    }
  }

  confirmESI.onclick = async () => {
    if (done) return;
    const selectedEsi = esiSelect.value;
    if (!selectedEsi) {
      alert("Please select an ESI level before submitting.");
      return;
    }

    const curr = trial.steps[trial.steps.length - 1];
    curr.BF_dx = getSelectedDx() || curr.BF_dx;
    curr.BC_updates.push({ tick: curr.tick, ctx: Number(ctxSlider.value) });

    const lvl = Math.max(1, Math.min(5, Number(selectedEsi)));
    trial.finalized = { ESI: lvl, ctxUpdates: ctxUpdateCount };
    log(`Finalized ESI=${lvl} (ctx updates=${ctxUpdateCount})`);
    R('status').innerText = `Finalized ESI=${lvl}.`;

    if (!runLog) runLog = { session: cfg.session, mode, trials: [], controls: {} };
    runLog.trials.push(trial);
    updateProgress();
    done = true;
    closeModal();

    // Next Trial or Done
    const target = Number(controls.trials?.value) || cfg.trials_per_block;
    const isLastTrial = (runLog.trials.length >= target);

    if (!isLastTrial) {
      newTrial();
    } else {
      btn.next.disabled = true;
      btn.final.disabled = true;
      btn.restart.disabled = true;
      R('status').innerText = `All ${target} trials complete! Thank you.`;

      // Show Task Complete Modal
      const completeModal = document.getElementById('completeModal');
      const saveStatus = document.getElementById('saveStatus');
      if (completeModal) completeModal.classList.add('active');

      // Auto-submit to Webhook
      try {
        const payload = {
          experimentId: "TPB",
          timestamp: new Date().toLocaleString() + ' ' + Intl.DateTimeFormat().resolvedOptions().timeZone,
          data: JSON.stringify(runLog)
        };
        await fetch(WEBHOOK_URL, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(payload)
        });
        if (saveStatus) {
          saveStatus.innerText = "Data saved successfully! You may now close this window.";
          saveStatus.style.color = "var(--success)";
        }
        const waitMsg = document.getElementById('waitMsg');
        if (waitMsg) waitMsg.style.display = 'none';
      } catch (err) {
        console.error(err);
        if (saveStatus) {
          saveStatus.innerText = "Error saving data. Backup saved locally.";
          saveStatus.style.color = "var(--danger)";
        }
        btn.dl.style.display = 'inline-block';
        btn.dl.disabled = false;
      }
    }
  };

  // Note: submitAllBtn logic removed inside html and js as auto-submit handles payload delivery.

  function downloadRun() {
    const blob = new Blob([JSON.stringify(runLog || {}, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `er_tpb_v2_3_run_${Date.now()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    log('Run JSON downloaded.');
  }

})();