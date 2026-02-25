// DSB v6 with Live Controls + OpenAI API Integration
(async function () {
  const defaults = window.APP_CONFIG;
  let config = JSON.parse(JSON.stringify(defaults)); // shallow clone for mutation by UI

  // Cheat code logic
  let keysPressed = "";
  const secretCode = "whosyourdaddy";
  document.addEventListener('keydown', (e) => {
    keysPressed += e.key;
    if (keysPressed.length > secretCode.length) {
      keysPressed = keysPressed.slice(-secretCode.length);
    }
    if (keysPressed.toLowerCase() === secretCode) {
      const controls = document.getElementById('controls');
      controls.style.display = controls.style.display === 'none' ? 'grid' : 'none';
    }
  });

  // --- UI bindings ---
  const EL = (id) => document.getElementById(id);
  const getControls = () => {
    const drift_range = parseInt(EL('ctl_drift_range').value, 10);
    const drift_values = Array.from({ length: drift_range * 2 + 1 }, (_, i) => i - drift_range);

    return {
      max_steps: parseInt(EL('ctl_max_steps').value, 10),
      cols: parseInt(EL('ctl_cols').value, 10),
      drain_step: parseFloat(EL('ctl_drain_step').value),
      drain_coll: parseFloat(EL('ctl_drain_coll').value),
      urgency_extra: parseFloat(EL('ctl_urgency').value),
      vol_low: parseFloat(EL('ctl_vol_low').value),
      vol_high: parseFloat(EL('ctl_vol_high').value),
      gust_rate: parseFloat(EL('ctl_gust_rate').value),
      bias: parseFloat(EL('ctl_bias').value),
      dense: parseFloat(EL('ctl_dense').value),
      sparse: parseFloat(EL('ctl_sparse').value),
      corr_keep: parseFloat(EL('ctl_corr_keep').value),
      drift_values,
      drift_probability: parseFloat(EL('ctl_drift_prob').value),
      trials_per_block: parseInt(EL('ctl_trials').value, 10) || 5
    };
  };

  // --- Elements ---
  const gridEl = document.getElementById('grid');
  const hud = document.getElementById('hud');
  const status = document.getElementById('status');
  const startBtn = document.getElementById('startBtn');
  const dlBtn = document.getElementById('downloadBtn');
  const submitBtn = document.getElementById('submitBtn');
  const beliefSlider = document.getElementById('beliefSlider');
  const beliefVal = document.getElementById('beliefVal');

  const surveyModal = document.getElementById('surveyModal');
  const okSurvey = document.getElementById('okSurvey');
  const skipSurvey = document.getElementById('skipSurvey');

  const completeModal = document.getElementById('completeModal');
  const saveStatus = document.getElementById('saveStatus');

  // Removed analyze button logic

  let mode = 'human';

  let runLog = null;

  function applyUI() {
    const u = getControls();
    config.trial.max_steps = u.max_steps;
    config.grid.cols = u.cols;
    config.battery.drain_per_step = u.drain_step;
    config.battery.drain_collision_penalty = u.drain_coll;
    config.battery.urgency_extra = u.urgency_extra; // custom field
    config._vol_low = u.vol_low;
    config._vol_high = u.vol_high;
    config._gust_rate = u.gust_rate;
    config._bias = u.bias;
    config._dense = u.dense;
    config._sparse = u.sparse;
    config._corr_keep = u.corr_keep;
    config.drift_values = u.drift_values;
    config.drift_probability = u.drift_probability;

    // reflow grid
    gridEl.style.gridTemplateRows = `repeat(${config.grid.rows}, ${config.grid.cell}px)`;
    gridEl.style.gridTemplateColumns = `repeat(${config.grid.cols}, ${config.grid.cell}px)`;
  }

  function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function newMap(density) {
    const p = density === 'dense' ? config._dense : config._sparse;
    const walls = new Set();
    const rows = config.grid.rows, cols = config.grid.cols;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if ((r === Math.floor(rows / 2) && c === 0) || (r === Math.floor(rows / 2) && c === cols - 1)) continue;
        if (Math.random() < p) walls.add(`${r},${c}`);
      }
    }
    for (let c = 0; c < cols; c++) {
      if (Math.random() < config._corr_keep) continue; // keep some obstacles
      walls.delete(`${Math.floor(config.grid.rows / 2)},${c}`);
    }
    return walls;
  }

  function driftGenerators(volatility) {
    const rows = config.grid.rows;
    const gens = [];
    const base = (volatility === 'high') ? config._vol_high : config._vol_low;
    for (let r = 0; r < rows; r++) {
      gens.push((function* () {
        let d = rand(config.drift_values);
        while (true) {
          yield d;
          if (Math.random() < base) d = rand(config.drift_values);
        }
      })());
    }
    return gens;
  }

  function render(agent, walls, battery) {
    const rows = config.grid.rows, cols = config.grid.cols, cell = config.grid.cell;
    gridEl.innerHTML = '';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const div = document.createElement('div');
        div.className = 'cell';
        const key = `${r},${c}`;
        if (walls.has(key)) div.classList.add('wall');
        if (r === Math.floor(rows / 2) && c === 0) div.classList.add('start');
        if (r === Math.floor(rows / 2) && c === cols - 1) div.classList.add('goal');
        if (r === agent.r && c === agent.c) div.classList.add('agent');
        gridEl.appendChild(div);
      }
    }
    const batPct = clamp(battery, 0, config.battery.max);
    const color = batPct > 50 ? '#22c55e' : batPct > 20 ? '#f59e0b' : '#ef4444';
    hud.innerHTML = `Battery <span class="battery"><div style="width:${batPct}%; background:${color}"></div></span> <span style="margin-left:6px">${batPct.toFixed(0)}%</span>`;
  }

  function neighbors(agent, walls) {
    const rows = config.grid.rows, cols = config.grid.cols;
    const dirs = [[-1, 0, 'UP'], [1, 0, 'DOWN'], [0, -1, 'LEFT'], [0, 1, 'RIGHT']];
    const out = [];
    for (const [dr, dc, name] of dirs) {
      const rr = agent.r + dr, cc = agent.c + dc;
      const key = `${rr},${cc}`;
      out.push({ dir: name, blocked: walls.has(key) || rr < 0 || rr >= rows || cc < 0 || cc >= cols });
    }
    return out;
  }

  function driftToNudge(drift) {
    const bias = 0.5 + (config._bias || 0.25) * Math.sign(drift);
    const gust = Math.random() < (config._gust_rate || 0.14) ? 2 : 1;
    return (Math.random() < bias ? 1 : -1) * gust;
  }

  // Build local map as 0/1 matrix (0=passable, 1=wall)
  function buildLocalMap(r, c, walls, grid_rows, grid_cols, rowRange = 2, colRange = 3) {
    const matrix = [];

    for (let dr = -rowRange; dr <= rowRange; dr++) {
      const row = [];
      for (let dc = -colRange; dc <= colRange; dc++) {
        const absRow = r + dr;
        const absCol = c + dc;

        // Out of bounds or wall = 1, otherwise = 0
        if (absRow < 0 || absRow >= grid_rows || absCol < 0 || absCol >= grid_cols) {
          row.push(1);
        } else if (walls.has(`${absRow},${absCol}`)) {
          row.push(1);
        } else {
          row.push(0);
        }
      }
      matrix.push(row);
    }

    return matrix;
  }

  // Removed API and LLM Prompts

  // Removed callAPI

  let isRunning = false;

  async function run() {
    if (isRunning) return;
    isRunning = true;

    // Disable controls
    startBtn.disabled = true;
    startBtn.innerText = 'Running...';
    dlBtn.style.display = 'none';

    try {
      applyUI(); // read sliders
      runLog = { session: 'BatteryLayersV6', mode, trials: [], ui: getControls() };
      const blocks = defaults.blocks;

      for (let b = 0; b < blocks; b++) {
        const factors = {
          volatility: b % 2 === 0 ? 'low' : 'high',
          urgency: b % 2 === 0 ? 'off' : 'on',
          sensor_noise: b % 2 === 0 ? 'low' : 'high',
          map_density: b % 2 === 0 ? 'sparse' : 'dense'
        };
        const u = getControls();
        const trialsPerBlock = u.trials_per_block;
        for (let t = 0; t < trialsPerBlock; t++) {
          status.innerText = `Block ${b + 1}/${blocks} • Trial ${t + 1}/${trialsPerBlock} (${mode})`;
          await runOneTrial({ b, t, factors });
        }
      }
      status.innerText = 'All trials complete. You can download the data.';
    } catch (e) {
      console.error(e);
      status.innerText = 'Error during run: ' + e.message;
    } finally {
      isRunning = false;
      startBtn.disabled = false;
      startBtn.innerText = 'Restart';
      dlBtn.style.display = 'inline-block';
    }
  }

  function currentLayerDrift(drifts, r) {
    const gen = drifts[r];
    const { value } = gen.next();
    return value;
  }

  function showSurvey(reason) {
    return new Promise(resolve => {
      let chosenContext = null;
      document.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
      surveyModal.classList.add('active'); // Changed to use classList

      const reasonEl = document.getElementById('surveyReason');
      if (reasonEl) {
        reasonEl.innerText = reason === 'goal' ? 'Trial Complete! Goal Reached 🏁' : (reason === 'battery' ? 'Battery Depleted 🔋' : 'Trial Ended');
        reasonEl.style.color = reason === 'goal' ? 'var(--success)' : 'var(--danger)';
      }

      if (beliefSlider) {
        beliefSlider.value = "50";
        if (beliefVal) beliefVal.innerText = "50";
      }

      const cleanup = () => {
        surveyModal.classList.remove('active'); // Changed to use classList
      };

      okSurvey.onclick = () => {
        const val = Number(beliefSlider.value);
        const result = { context_belief: val };
        cleanup(); resolve(result);
      };
    });
  }

  async function runOneTrial({ b, t, factors }) {
    const walls = newMap(factors.map_density);
    const drifts = driftGenerators(factors.volatility);

    // Constants for this trial
    const goalRow = Math.floor(config.grid.rows / 2);
    const goalCol = config.grid.cols - 1;

    let agent = { r: goalRow, c: 0 };
    let step = 0;
    let time_left = config.trial.max_steps;
    let battery = config.battery.max;
    let currentBelief = 50; // default start
    let collisions = 0;
    let prevStep = { action: null, row: null, col: null };

    // History design:
    // - Navigation: no history (each step is independent for speed)
    // - Survey: fullHistory (complete record for evaluation)
    let fullHistory = [];

    const trialLog = { block: b, trial: t, factors, steps: [], mode };

    render(agent, walls, battery);

    // Helper to build prompt state
    const getPromptState = () => ({
      step,
      r: agent.r,
      c: agent.c,
      battery: Math.round(battery),
      time_left,
      collisions,
      urgency: factors.urgency,
      walls: walls,  // Pass the full walls set for local map generation
      prev_action: prevStep.action,
      prev_row: prevStep.row,
      prev_col: prevStep.col,
      grid_rows: config.grid.rows,
      grid_cols: config.grid.cols,
      goal_row: goalRow,
      goal_col: goalCol,
      current_belief: currentBelief
    });

    let awaiting = true;
    const onKey = (e) => {
      if (mode !== 'human' || !awaiting) return;
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      const mapKey = { 'ArrowUp': 'UP', 'ArrowDown': 'DOWN', 'ArrowLeft': 'LEFT', 'ArrowRight': 'RIGHT' };
      stepOnce(mapKey[e.key], '');
    };
    document.addEventListener('keydown', onKey);

    function applyDrain(collided) {
      let d = config.battery.drain_per_step + (collided ? config.battery.drain_collision_penalty : 0);
      if (factors.urgency === 'on') d += (config.battery.urgency_extra || 0);
      battery = Math.max(0, battery - d);

      if (collided) {
        gridEl.classList.remove('shake');
        void gridEl.offsetWidth; // trigger reflow
        gridEl.classList.add('shake');
        setTimeout(() => gridEl.classList.remove('shake'), 300);
      }
    }

    function atGoal() {
      return (agent.r === goalRow && agent.c === goalCol);
    }

    function endCondition() {
      if (atGoal()) return 'goal';
      if (battery <= 0) return 'battery';
      if (time_left <= 0) return 'timeout';
      return null;
    }

    function stepOnce(actionLabel, rationale) {
      if (!awaiting) return; // Prevent moves after end

      let dr = 0, dc = 0;
      if (actionLabel === 'UP') dr = -1;
      if (actionLabel === 'DOWN') dr = 1;
      if (actionLabel === 'LEFT') dc = -1;
      if (actionLabel === 'RIGHT') dc = 1;

      // 1. Proposed Move
      const nextR = clamp(agent.r + dr, 0, config.grid.rows - 1);
      const nextC = clamp(agent.c + dc, 0, config.grid.cols - 1);

      // 2. Check Wall Collision (Voluntary Move)
      let collision = 0;
      let hitWall = false;

      if (walls.has(`${nextR},${nextC}`)) {
        hitWall = true;
        collision = 1;
        // Agent stays put
      } else {
        agent.r = nextR;
        agent.c = nextC;
      }

      // 3. Apply Wind Drift
      let actualDrift = 0;
      let drift = 0;
      let nudge = 0;

      // Apply drift only based on probability
      if (Math.random() < (config.drift_probability !== undefined ? config.drift_probability : 1.0)) {
        drift = currentLayerDrift(drifts, agent.r);
        nudge = driftToNudge(drift);

        // Iterative drift check to prevent tunneling
        const driftSteps = Math.abs(nudge);
        const driftDir = Math.sign(nudge);

        for (let i = 1; i <= driftSteps; i++) {
          const checkC = agent.c + (driftDir * i);

          // Check bounds
          if (checkC < 0 || checkC >= config.grid.cols) {
            collision = 1; // Hit boundary
            break;
          }

          // Check wall
          if (walls.has(`${agent.r},${checkC}`)) {
            collision = 1; // Hit wall
            break;
          }

          // If safe, we can move here
          actualDrift = driftDir * i;
        }
      }

      agent.c += actualDrift;

      step += 1;
      time_left -= 1;

      collisions += collision;
      applyDrain(collision > 0); // Pass boolean or count? applyDrain takes boolean-ish
      render(agent, walls, battery);

      trialLog.steps.push({
        step, action: actionLabel, rationale: rationale || null,
        row: agent.r, col: agent.c, drift_row: drift, nudge, battery: Math.round(battery),
        pos: `${agent.r},${agent.c}`, collision, belief: currentBelief
      });

      const why = endCondition();
      if (why) {
        finish(why);
      } else {
        prevStep = { action: actionLabel, row: agent.r, col: agent.c };
      }
    }

    function finish(why) {
      if (!awaiting) return; // Already finished
      awaiting = false;
      document.removeEventListener('keydown', onKey);
      trialLog.end_reason = why;
      runLog.trials.push(trialLog);

      // Auto-save to localStorage
      try {
        localStorage.setItem('dsb_backup_log', JSON.stringify(runLog));
      } catch (e) { console.warn('Backup failed', e); }

      proceed(why);
    }

    async function proceed(why) {
      showSurvey(why).then(async res => {
        trialLog.context_belief = res.context_belief;

        const u = getControls();
        const totalTrials = defaults.blocks * u.trials_per_block;
        const isLastTrial = (runLog.trials.length >= totalTrials);

        if (isLastTrial) {
          // Show Task Complete Modal
          const completeModal = document.getElementById('completeModal');
          const saveStatus = document.getElementById('saveStatus');
          if (completeModal) completeModal.classList.add('active');

          // Auto-submit to Webhook
          try {
            const payload = {
              experimentId: "DSB",
              timestamp: new Date().toLocaleString() + ' ' + Intl.DateTimeFormat().resolvedOptions().timeZone,
              data: JSON.stringify(runLog)
            };
            await fetch(WEBHOOK_URL, {
              method: "POST",
              mode: "no-cors",
              headers: { "Content-Type": "text/plain;charset=utf-8" },
              body: JSON.stringify(payload)
            });
            if (saveStatus) saveStatus.innerText = "Data saved successfully! You may now close this window.";
            if (saveStatus) saveStatus.style.color = "var(--success)";
            const waitMsg = document.getElementById('waitMsg');
            if (waitMsg) waitMsg.style.display = 'none';
            const returnBtn = document.getElementById('returnBtn');
            if (returnBtn) returnBtn.style.display = 'inline-block';
          } catch (err) {
            console.error(err);
            if (saveStatus) saveStatus.innerText = "Error saving data. Backup saved locally.";
            if (saveStatus) saveStatus.style.color = "var(--danger)";
            const subAll = document.getElementById('downloadBtn');
            if (subAll) subAll.style.display = 'inline-block';
          }
        }

        resolveTrial();
      });
    }

    let resolveTrial;
    const done = new Promise(res => { resolveTrial = res; });

    // Let the keydown logic call `finish(why)` which then calls `proceed(why)`,
    // and `proceed` calls `resolveTrial()` resolving `done`.
    await done;
  }

  // Initial grid CSS sizing
  (function initGrid() {
    const r = defaults.grid.rows, c = defaults.grid.cols, cell = defaults.grid.cell;
    gridEl.style.gridTemplateRows = `repeat(${r}, ${cell}px)`;
    gridEl.style.gridTemplateColumns = `repeat(${c}, ${cell}px)`;
  })();

  // Buttons
  startBtn.onclick = () => run();
  dlBtn.onclick = () => {
    const blob = new Blob([JSON.stringify(runLog, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dsb_layers_v6_run_${Date.now()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
  };

  // Auto-submission is handled directly in proceed() function now.
  const WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbzyZHP0KBEsq0hnyFrE8sWIVuZFFHIbhvngklXmiAojQa_y6ZYbiL9bjZQmGJXV2yXK/exec";

  // Removed API Configuration UI

})();
