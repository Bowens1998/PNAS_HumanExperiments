// Financial Investment Task — v1.1.1 (robust start with parallel execution)
document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);
  const status = $('status'), errBox = $('error');
  const startBtn = $('startBtn'), dlBtn = $('downloadBtn');
  let WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbzyZHP0KBEsq0hnyFrE8sWIVuZFFHIbhvngklXmiAojQa_y6ZYbiL9bjZQmGJXV2yXK/exec";

  let secretCode = "whosyourdaddy";
  let keysPressed = "";

  document.addEventListener('keydown', (e) => {
    keysPressed += e.key;
    if (keysPressed.length > secretCode.length) {
      keysPressed = keysPressed.slice(-secretCode.length);
    }
    if (keysPressed.toLowerCase() === secretCode) {
      const controls = document.getElementById('controls_panel');
      controls.style.display = controls.style.display === 'none' ? 'block' : 'none';
    }
  });

  // Fallback defaults if config.json fails
  const FALLBACK = {
    session: 'InvestTaskWebV1_1_1',
    ui_defaults: {
      T_trials: 10, W_window: 80,
      p_calm_to_turb: 0.12, p_turb_to_calm: 0.18,
      mu_L: 0.0008, mu_M: 0.0008, mu_H: 0.0008,
      sigma_calm_L: 0.006, sigma_calm_M: 0.010, sigma_calm_H: 0.016,
      sigma_turb_L: 0.014, sigma_turb_M: 0.022, sigma_turb_H: 0.034,
      rho_calm: 0.15, rho_turb: 0.65,
      trend_thresh: 0.02, alloc_step: 5, seed: 42
    }
  };

  (async function boot() {
    try {
      let cfg;
      try {
        const res = await fetch('./js/config.json', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        cfg = await res.json();
      } catch (e) {
        cfg = FALLBACK;
        showError(`config.json load failed (${e.message}). Using built-in defaults.`);
      }
      await appMain(cfg);
      status.textContent = 'Ready. Adjust sliders or start.';
      startBtn.disabled = false;
    } catch (e) {
      showError('Fatal init error: ' + e.message);
    }
  })();

  function showError(msg) {
    errBox.style.display = 'block';
    errBox.textContent = msg;
    console.error(msg);
  }

  // Math helpers (Global access needed for HeadlessExperiment)
  function matmul(A, B) {
    const n = A.length, m = B[0].length, p = B.length;
    const C = Array.from({ length: n }, () => Array(m).fill(0));
    for (let i = 0; i < n; i++) { for (let k = 0; k < p; k++) { const aik = A[i][k]; for (let j = 0; j < m; j++) C[i][j] += aik * B[k][j]; } }
    return C;
  }
  function chol(A) {
    const n = A.length, L = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let s = A[i][j];
        for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
        if (i === j) L[i][j] = Math.sqrt(Math.max(s, 1e-12)); else L[i][j] = s / L[j][j];
      }
    }
    return L;
  }
  function randn() { let u = 0, v = 0; while (u === 0) u = Math.random(); while (v === 0) v = Math.random(); return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function mulnorm(mean, cov) {
    const L = chol(cov);
    const z = [randn(), randn(), randn()], y = [0, 0, 0];
    for (let i = 0; i < 3; i++) { let s = 0; for (let k = 0; k <= i; k++) s += L[i][k] * z[k]; y[i] = s + mean[i]; }
    return y;
  }
  function covFrom(sigL, sigM, sigH, rho) {
    const S = [[sigL, 0, 0], [0, sigM, 0], [0, 0, sigH]];
    const R = [[1, rho, rho], [rho, 1, rho], [rho, rho, 1]];
    return matmul(matmul(S, R), S);
  }
  function slope(y) {
    const n = y.length; let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { const xi = i; const yi = y[i]; sx += xi; sy += yi; sxx += xi * xi; sxy += xi * yi; }
    return (n * sxy - sx * sy) / (n * sxx - sx * sx + 1e-12);
  }
  function trendLabelPct(yPct, thresh) {
    const beta = slope(yPct);
    if (beta > thresh * 100) return 1;
    if (beta < -thresh * 100) return -1;
    return 0;
  }
  function normalizeAlloc(xL, xM, xH) {
    let s = xL + xM + xH;
    if (s <= 0) return [33, 33, 34];
    return [100 * xL / s, 100 * xM / s, 100 * xH / s];
  }

  // --- Headless Experiment Class (Removed) ---

  async function appMain(cfg) {
    const UI = cfg.ui_defaults;
    // Bind all other DOM after we know we're good
    const submitTrial = $('submitTrial');
    const ctxRisk = $('ctxRisk'), ctxLabel = $('ctxLabel');
    const cL = $('cL'), cM = $('cM'), cH = $('cH');
    const ticksL = $('ticksL'), ticksM = $('ticksM'), ticksH = $('ticksH');
    const wL = $('wL'), wM = $('wM'), wH = $('wH'), vwL = $('vwL'), vwM = $('vwM'), vwH = $('vwH');
    const c_trials = $('T_trials');
    const c_W = $('W_window');
    const c_thr = $('trend_thresh');
    const c_ct = $('p_calm_to_turb'), c_tc = $('p_turb_to_calm');
    const c_rhoc = $('rho_calm'), c_rhot = $('rho_turb');
    const sigma_calm_L = $('sigma_calm_L'), sigma_calm_M = $('sigma_calm_M'), sigma_calm_H = $('sigma_calm_H');
    const sigma_turb_L = $('sigma_turb_L'), sigma_turb_M = $('sigma_turb_M'), sigma_turb_H = $('sigma_turb_H');
    const v_trials = $('v_trials'), v_W = $('v_W'), v_thr = $('v_thr'), v_ct = $('v_ct'), v_tc = $('v_tc'), v_rhoc = $('v_rhoc'), v_rhot = $('v_rhot');

    function initControls() {
      // Set to document node for T_trials since it is not defined in cfg initially but rather ui_defaults
      if ($('T_trials')) { $('T_trials').value = UI.T_trials; v_trials.textContent = `(${UI.T_trials})`; }
      c_W.value = UI.W_window; v_W.textContent = `(${UI.W_window})`;
      c_thr.value = UI.trend_thresh; v_thr.textContent = `(${UI.trend_thresh})`;
      c_ct.value = UI.p_calm_to_turb; v_ct.textContent = `(${UI.p_calm_to_turb})`;
      c_tc.value = UI.p_turb_to_calm; v_tc.textContent = `(${UI.p_turb_to_calm})`;
      c_rhoc.value = UI.rho_calm; v_rhoc.textContent = `(${UI.rho_calm})`;
      c_rhot.value = UI.rho_turb; v_rhot.textContent = `(${UI.rho_turb})`;
      sigma_calm_L.value = UI.sigma_calm_L; sigma_calm_M.value = UI.sigma_calm_M; sigma_calm_H.value = UI.sigma_calm_H;
      sigma_turb_L.value = UI.sigma_turb_L; sigma_turb_M.value = UI.sigma_turb_M; sigma_turb_H.value = UI.sigma_turb_H;
    }
    initControls();

    function bindVal(input, labelEl, fmt = (x) => x) { if (input && labelEl) input.addEventListener('input', () => { labelEl.textContent = `(${fmt(input.value)})`; }); }
    bindVal($('T_trials'), v_trials, x => x);
    bindVal(c_W, v_W, x => x);
    bindVal(c_thr, v_thr, x => Number(x).toFixed(3));
    bindVal(c_ct, v_ct, x => Number(x).toFixed(2));
    bindVal(c_tc, v_tc, x => Number(x).toFixed(2));
    bindVal(c_rhoc, v_rhoc, x => Number(x).toFixed(2));
    bindVal(c_rhot, v_rhot, x => Number(x).toFixed(2));

    let mode = 'human';

    function drawSparkPct(canvas, arrPct, ticksEl, color) {
      const ctx = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      const n = arrPct.length;
      const min = Math.min(...arrPct), max = Math.max(...arrPct);
      const x = (i) => i * (W - 10) / (n - 1) + 5;
      const y = (v) => H - 18 - (v - min) / (max - min + 1e-9) * (H - 28);
      ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1;
      const y0 = y(0);
      ctx.beginPath(); ctx.moveTo(5, y0); ctx.lineTo(W - 5, y0); ctx.stroke();
      ctx.strokeStyle = color || '#0ea5e9'; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < n; i++) { const xx = x(i), yy = y(arrPct[i]); if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy); }
      ctx.stroke();
      ctx.fillStyle = '#64748b'; ctx.font = '11px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'left'; ctx.fillText('t=0', 6, H - 4);
      ctx.textAlign = 'right'; ctx.fillText(`t=${n - 1}`, W - 6, H - 4);
      const minStr = `${min.toFixed(1)}%`; const maxStr = `${max.toFixed(1)}%`; const zeroStr = '0%';
      ticksEl.innerHTML = `<div style="position:absolute; left:0; top:0; font-size:11px; color:#64748b;">${maxStr}</div>
                           <div style="position:absolute; left:0; top:${(H - 18) / 2 - 6}px; font-size:11px; color:#64748b;">${zeroStr}</div>
                           <div style="position:absolute; left:0; bottom:0; font-size:11px; color:#64748b;">${minStr}</div>`;
    }

    function runtime() {
      return {
        T_trials: Number(c_trials.value),
        W_window: Number(c_W.value),
        trend_thresh: Number(c_thr.value),
        p_calm_to_turb: Number(c_ct.value),
        p_turb_to_calm: Number(c_tc.value),
        mu: [UI.mu_L, UI.mu_M, UI.mu_H],
        sig_calm: [Number(sigma_calm_L.value), Number(sigma_calm_M.value), Number(sigma_calm_H.value)],
        sig_turb: [Number(sigma_turb_L.value), Number(sigma_turb_M.value), Number(sigma_turb_H.value)],
        rho_calm: Number(c_rhoc.value),
        rho_turb: Number(c_rhot.value),
        seed: UI.seed
      };
    }

    function nextState(prev, p_ct, p_tc) {
      if (prev === 'calm') { return Math.random() < p_ct ? 'turb' : 'calm'; }
      return Math.random() < p_tc ? 'calm' : 'turb';
    }

    function simulateTrial(R) {
      // ... (reusing Headless logic, but kept here for UI mode)
      // duplicated logic to avoid heavy refactoring of visual mode for now
      // ideally visual mode would also use HeadlessExperiment class but that's a bigger refactor
      // for minimal risk, we keep visual mode logic as is.
      let state = Math.random() < 0.5 ? 'calm' : 'turb';
      const prices = { L: [100.0], M: [100.0], H: [100.0] };
      const pct = { L: [0], M: [0], H: [0] };
      const states = [];
      for (let t = 0; t < R.W_window; t++) {
        state = nextState(state, R.p_calm_to_turb, R.p_turb_to_calm);
        states.push(state);
        const cov = (state === 'calm')
          ? covFrom(R.sig_calm[0], R.sig_calm[1], R.sig_calm[2], R.rho_calm)
          : covFrom(R.sig_turb[0], R.sig_turb[1], R.sig_turb[2], R.rho_turb);
        const ret = mulnorm(R.mu, cov);
        const keys = ['L', 'M', 'H'];
        for (let i = 0; i < 3; i++) {
          const k = keys[i];
          const last = prices[k][prices[k].length - 1];
          const nextp = last * Math.exp(ret[i]);
          prices[k].push(nextp);
        }
      }
      for (const k of ['L', 'M', 'H']) { const base = prices[k][0]; pct[k] = prices[k].map(v => (v / base - 1) * 100); }
      const gt_trend = {
        L: trendLabelPct(pct.L, runtime().trend_thresh),
        M: trendLabelPct(pct.M, runtime().trend_thresh),
        H: trendLabelPct(pct.H, runtime().trend_thresh)
      };
      const ctx_true_final = states[states.length - 1];
      return { prices, pct, states, ctx_true_final, gt_trend };
    }

    let RUN = null, trialIdx = 0, trialObj = null, LOG = null;

    function factualFromUI() {
      return {
        L: { trend: document.querySelector('input[name="trendL"]:checked').value, conf: Number(document.getElementById('confL').value) },
        M: { trend: document.querySelector('input[name="trendM"]:checked').value, conf: Number(document.getElementById('confM').value) },
        H: { trend: document.querySelector('input[name="trendH"]:checked').value, conf: Number(document.getElementById('confH').value) }
      };
    }

    function renderTrial() {
      drawSparkPct(cL, trialObj.pct.L, ticksL, '#10b981');
      drawSparkPct(cM, trialObj.pct.M, ticksM, '#0ea5e9');
      drawSparkPct(cH, trialObj.pct.H, ticksH, '#ef4444');
      ctxLabel.textContent = `reported: ${ctxRisk.value}/100`;
      vwL.textContent = wL.value + '%'; vwM.textContent = wM.value + '%'; vwH.textContent = wH.value + '%';
    }


    function normalizeTriple(active, vA, vB, vC) {
      const R = 100 - vA;
      const S = vB + vC;
      let b, c;
      if (S <= 0) { b = R / 2; c = R / 2; } else { b = R * (vB / S); c = R * (vC / S); }
      return [Math.round(vA), Math.round(b), Math.round(c)];
    }

    function bindAlloc() {
      wL.addEventListener('input', () => {
        let [a, b, c] = normalizeTriple('L', Number(wL.value), Number(wM.value), Number(wH.value));
        wL.value = a; wM.value = b; wH.value = c; renderTrial();
      });
      wM.addEventListener('input', () => {
        let [b, a, c] = normalizeTriple('M', Number(wM.value), Number(wL.value), Number(wH.value));
        wM.value = b; wL.value = a; wH.value = c; renderTrial();
      });
      wH.addEventListener('input', () => {
        let [c, a, b] = normalizeTriple('H', Number(wH.value), Number(wL.value), Number(wM.value));
        wH.value = c; wL.value = a; wM.value = b; renderTrial();
      });
    }
    bindAlloc();

    // Removed LLM Prompts, API Calls, and Parallel Execution Management

    function nextTrial() {
      if (trialIdx >= RUN.T_trials) {
        // Just return, handled in endTrial
        return;
      }
      trialObj = simulateTrial(RUN);
      // reset UI
      document.getElementById('confL').value = 50; document.getElementById('confM').value = 50; document.getElementById('confH').value = 50;
      document.querySelector('input[name="trendL"][value="flat"]').checked = true;
      document.querySelector('input[name="trendM"][value="flat"]').checked = true;
      document.querySelector('input[name="trendH"][value="flat"]').checked = true;
      ctxRisk.value = 50; ctxLabel.textContent = 'reported: 50/100';
      wL.value = 33; wM.value = 33; wH.value = 34; renderTrial();

      // Removed LLM prompt building
      status.textContent = `Trial ${trialIdx + 1} / ${RUN.T_trials}`;
    }

    async function endTrial() {
      const F = factualFromUI();
      const risk = Number(ctxRisk.value);
      let aL = Number(wL.value), aM = Number(wM.value), aH = Number(wH.value);
      let [nL, nM, nH] = normalizeAlloc(aL, aM, aH); // enforce 100%
      const entry = {
        trial: trialIdx,
        params: runtime(),
        prices: trialObj.prices,
        pct: trialObj.pct,
        state_final: trialObj.ctx_true_final,
        gt_trend_pct: trialObj.gt_trend,
        report: { factual: F, contextual: { risk }, alloc: { L: nL, M: nM, H: nH } }
      };
      LOG.trials.push(entry);
      trialIdx += 1;

      const isLastTrial = (trialIdx >= RUN.T_trials);
      if (!isLastTrial) {
        alert("successfully submitted");
        nextTrial();
      } else {
        status.textContent = `All ${RUN.T_trials} trials complete. Thank you.`;
        dlBtn.style.display = 'inline-block';
        dlBtn.disabled = false;
        const subAll = $('submitAllBtn');
        if (subAll) {
          subAll.style.display = 'inline-block';
          subAll.disabled = false;
        }
        $('submitTrial').style.display = 'none'; // hide submit trial button when done
      }
    }

    function initRun() {
      RUN = runtime();
      LOG = { session: 'InvestTaskWebV1_1_1', mode, params: RUN, trials: [] };
      trialIdx = 0; dlBtn.disabled = true;
      status.textContent = `Running… ${RUN.T_trials} trials.`;
      nextTrial();
    }

    startBtn.onclick = () => { try { initRun(); } catch (e) { showError('Start failed: ' + e.message); } };
    dlBtn.onclick = () => {
      const blob = new Blob([JSON.stringify(LOG, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `invest_task_web_v111_${Date.now()}.json`; a.click();
    };

    const submitAllBtn = $('submitAllBtn');
    if (submitAllBtn) {
      submitAllBtn.onclick = async () => {
        const url = "https://script.google.com/macros/s/AKfycbzyZHP0KBEsq0hnyFrE8sWIVuZFFHIbhvngklXmiAojQa_y6ZYbiL9bjZQmGJXV2yXK/exec";
        if (url) {
          try {
            const payload = {
              experimentId: "FIP",
              timestamp: new Date().toISOString(),
              data: JSON.stringify(LOG)
            };
            await fetch(url, {
              method: "POST",
              mode: "no-cors",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            });
            alert("All trials are successfully submitted");
          } catch (err) {
            console.error(err);
            alert("Error submitting data. Data saved locally to session. Download JSON instead.");
          }
        } else {
          alert("All trials are successfully submitted");
        }
      };
    }

    // Legacy Submit logic removed

    document.getElementById('submitTrial').onclick = endTrial;
    ctxRisk.oninput = () => { ctxLabel.textContent = `reported: ${ctxRisk.value}/100`; };
    [wL, wM, wH].forEach(x => x.addEventListener('input', () => { vwL.textContent = wL.value + '%'; vwM.textContent = wM.value + '%'; vwH.textContent = wH.value + '%'; }));

    // Removed API Bindings

  }
});
