const DemoState = {
  IDLE: 'idle',
  SCANNING: 'scanning',
  AWAITING_APPROVAL_1: 'awaiting_approval_1',
  PROCESSING: 'processing',
  GENERATING_CREATIVES: 'generating_creatives',
  AWAITING_APPROVAL_2: 'awaiting_approval_2',
  DEPLOYING: 'deploying',
  LIVE: 'live'
};

let currentState = DemoState.IDLE;
let eventSource = null;
let ws = null;
let currentGoal = "";
let currentAnnouncementAudio = null;

// Store campaign details dynamically as they stream in
const campaignDetails = {};

// Map of connector IDs to friendly names
const CONNECTOR_FRIENDLY_NAMES = {
  "pulse_tenant_inventory_daily": "Tenant Inventory (Daily)",
  "pulse_loyalty_customers": "Loyalty Customer Data",
};

// Show activate button once simulation is ready
window.addEventListener('simulationReady', () => {
  const container = document.getElementById('activate-btn-container');
  if (container) container.style.display = 'block';
});

document.addEventListener("DOMContentLoaded", () => {
  connectWebSocket();
});

function transitionTo(state) {
  console.log(`[DemoState] Transitioning: ${currentState} -> ${state}`);
  currentState = state;
  const triggerText = document.getElementById("sim-active-trigger");
  if (triggerText) {
    triggerText.innerText = `SYSTEM STATUS: ${state.toUpperCase()}`;
  }
}

function setFivetranSyncing() {
    const dot = document.getElementById('fivetran-signal-dot');
    const label = document.getElementById('fivetran-signal-label');
    if (dot) { dot.style.background = '#D4AF37'; dot.style.boxShadow = '0 0 6px #D4AF37'; }
    if (label) { label.style.color = '#D4AF37'; label.innerText = 'SYNCING'; }
}

function setFivetranLive() {
    const dot = document.getElementById('fivetran-signal-dot');
    const label = document.getElementById('fivetran-signal-label');
    const chips = ['fivetran-chip-inventory', 'fivetran-chip-loyalty', 'fivetran-chip-products'];
    if (dot) { dot.style.background = '#00FF88'; dot.style.boxShadow = '0 0 8px #00FF88'; }
    if (label) { label.style.color = '#00FF88'; label.innerText = 'LIVE'; }
    chips.forEach(id => {
        const chip = document.getElementById(id);
        if (chip) { chip.style.color = '#00FF88'; chip.style.background = '#0D2A1F'; }
    });
}

function setFivetranStandby() {
    const dot = document.getElementById('fivetran-signal-dot');
    const label = document.getElementById('fivetran-signal-label');
    const chips = ['fivetran-chip-inventory', 'fivetran-chip-loyalty', 'fivetran-chip-products'];
    if (dot) { dot.style.background = '#2D3748'; dot.style.boxShadow = 'none'; }
    if (label) { label.style.color = 'var(--text-muted)'; label.innerText = 'STANDBY'; }
    chips.forEach(id => {
        const chip = document.getElementById(id);
        if (chip) { chip.style.color = '#2D4A3E'; chip.style.background = '#0D1F17'; }
    });
}

async function startCampaignOrchestration() {
  transitionTo(DemoState.SCANNING);
  setFivetranLive();
  
  const btn = document.getElementById('btn-activate-pulse');
  if (btn) {
    btn.style.animation = 'pulse-btn 1.5s infinite ease-in-out';
    btn.style.boxShadow = '0 0 30px rgba(0,229,255,0.5)';
  }

  // Use goal set by DTS date picker if available
  // Otherwise fall back to default
  if (window.currentGoal) {
    currentGoal = window.currentGoal;
  } else {
    const today = new Date().toISOString()
        .split('T')[0];
    currentGoal = `Campaign date: ${today} at 17:30. `
        + `Run full PULSE campaign analysis `
        + `for Galleria Dallas.`;
  }
  
  connectSSE();

  try {
    await fetch('/agents/goal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: currentGoal })
    });
  } catch (err) {
    console.error('Failed to start agent goal:', err);
  }
}

function connectSSE() {
  if (eventSource) {
    eventSource.close();
  }
  
  eventSource = new EventSource("/stream");
  const logContainer = document.getElementById("agent-log-stream");
  const terminalStatus = document.getElementById("terminal-status");
  
  eventSource.onopen = () => {
    if (terminalStatus) {
      terminalStatus.innerText = "STREAM_ACTIVE";
      terminalStatus.style.color = "var(--accent-success)";
    }
  };
  
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "keepalive") return;
      
      appendLogLine(data);
      handleSSEEvent(data);
    } catch (e) {
      console.error("SSE message parsing failed:", e);
    }
  };
  
  eventSource.onerror = () => {
    if (terminalStatus) {
      terminalStatus.innerText = "DISCONNECTED";
      terminalStatus.style.color = "var(--accent-secondary)";
    }
  };
}

let lastThinkingDiv = null;

function appendLogLine(log) {
  const logContainer = document.getElementById("agent-log-stream");
  if (!logContainer) return;
  
  // Resolve last thinking animation if a new line comes in
  if (lastThinkingDiv) {
    const dots = lastThinkingDiv.querySelector(".thinking-dots");
    if (dots) dots.remove();
    lastThinkingDiv = null;
  }
  
  const line = document.createElement("div");
  line.className = "reasoning-line";
  
  let leftBorderColor = "var(--border)";
  if (log.type === "thinking")      leftBorderColor = "var(--accent-warning)";
  else if (log.type === "action")   leftBorderColor = "var(--accent-primary)";
  else if (log.type === "decision") leftBorderColor = "var(--accent-secondary)";
  else if (log.type === "complete") leftBorderColor = "var(--accent-success)";
  else if (log.type === "creative") leftBorderColor = "#D4AF37";
  else if (log.type === "data")     leftBorderColor = "#4A9EFF";
  
  line.style.cssText = `border-left: 3px solid ${leftBorderColor}; padding-left: 8px; margin-bottom: 6px; font-family: monospace; font-size: 11px;`;
  
  const timeStr = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
  
  line.innerHTML = `
    <span style="color: var(--text-muted);">[${timeStr}]</span> 
    <span style="color: var(--accent-primary); font-weight: bold;">[${log.agent}]</span> 
    <span>${log.message}</span>
  `;
  
  if (log.type === "thinking") {
    const dots = document.createElement("span");
    dots.className = "thinking-dots";
    dots.innerHTML = '<span class="dot-anim">.</span><span class="dot-anim">.</span><span class="dot-anim">.</span>';
    line.appendChild(dots);
    lastThinkingDiv = line;
  }
  
  logContainer.appendChild(line);
  logContainer.scrollTop = logContainer.scrollHeight;
}

function handleSSEEvent(event) {
  // Capture brief details for creative previews
  if (event.type === "data" && event.data?.brief) {
    const brief = event.data.brief;
    const tenantId = brief.tenant_id;
    campaignDetails[tenantId] = {
      name: brief.name || "Tenant",
      headline: brief.headline || "Special Offer",
      body: brief.push_notification || "Stop by today for exclusive details."
    };
  }

  if (event.type === 'loyalty_notifications') {
    const notifs = event.data?.notifications ||
                   event.data || [];
    renderLoyaltyNotifications(
        Array.isArray(notifs) ? notifs : []
    );
    setTimeout(() => setFivetranStandby(), 5000);
  }

  if (event.type === "awaiting_approval_1") {
    try {
      console.debug('[PULSE] awaiting_approval_1 handler firing', event.data);
      transitionTo(DemoState.AWAITING_APPROVAL_1);

      // Pause simulation
      if (window.pulseSimulation) {
        window.pulseSimulation.pauseForApproval("approval_1");
      }

      const score = event.data?.score || 91;
      const theme = event.data?.theme || 'Campaign';
      console.debug('[PULSE] Calling showApprovalBanner with score:', score, 'theme:', theme);

      showApprovalBanner(1,
        `GM Approval Required: Proceed with campaign confluence score: ${score}% (${theme})?`,
        async () => {
          hideApprovalBanner(1);
          if (window.pulseSimulation) {
            window.pulseSimulation.resumeFromApproval("approval_1");
          }
          transitionTo(DemoState.PROCESSING);
          const btn = document.getElementById('btn-activate-pulse');
          if (btn) btn.innerText = "⚡";
          // POST to /agents/approve
          await fetch("/agents/approve?approval_id=approval_1", { method: "POST" });
        }
      );
      console.debug('[PULSE] showApprovalBanner called successfully');
    } catch(err) {
      console.error('[PULSE] awaiting_approval_1 handler ERROR:', err);
    }
  }

  if (event.type === "awaiting_approval_2") {
    try {
      console.debug('[PULSE] awaiting_approval_2 handler firing', event.data);
      transitionTo(DemoState.AWAITING_APPROVAL_2);

      // Slide down Active Campaign Panel
      const activeCampaignPanel = document.getElementById("active-campaign-panel");
      if (activeCampaignPanel) {
        activeCampaignPanel.style.display = "block";
        activeCampaignPanel.classList.add("slide-down");
      }

      const creatives = event.data?.creatives || [];
      const tenants = event.data?.tenants || [];

      // Render Creative Thumbnails
      renderThumbnails(creatives, tenants);

      // Pause simulation
      if (window.pulseSimulation) {
        window.pulseSimulation.pauseForApproval("approval_2");
      }

      const creativeCount = creatives.length || 5;
      showApprovalBanner(2,
        `Deploy ${creativeCount} active campaign creatives to Galleria Dallas DOOH screens?`,
        async () => {
          hideApprovalBanner(2);
          if (window.pulseSimulation) {
            window.pulseSimulation.resumeFromApproval("approval_2");
          }
          transitionTo(DemoState.DEPLOYING);
          const btn = document.getElementById('btn-activate-pulse');
          if (btn) btn.innerText = "⚡";
          await runTenantAcceptanceSequence(tenants);
          // POST to /agents/approve
          await fetch("/agents/approve?approval_id=approval_2", { method: "POST" });
        }
      );
      console.debug('[PULSE] Approval 2 banner shown');
    } catch(err) {
      console.error('[PULSE] awaiting_approval_2 handler ERROR:', err);
    }
  }

  if (event.type === 'gemini_prompt_ready') {
    const tryLoadPrompt = async (attemptsLeft) => {
        try {
            const resp = await fetch('/agents/gemini-prompt');
            const data = await resp.json();
            const promptDisplay = document.getElementById('gemini-prompt-display');
            const promptStatus = document.getElementById('gemini-prompt-status');

            if (promptDisplay && data.prompt) {
                promptDisplay.value = data.prompt;
                if (promptStatus) {
                    promptStatus.innerText = `~${data.tokens || 0} TOKENS`;
                    promptStatus.style.color = '#00E5FF';
                }
                console.log('[PULSE] Gemini prompt loaded:', data.tokens, 'tokens');
                return; // success
            }

            // Prompt not ready yet — retry if attempts remain
            if (attemptsLeft > 0) {
                console.log(`[PULSE] Prompt not ready, retrying... (${attemptsLeft} left)`);
                setTimeout(() => tryLoadPrompt(attemptsLeft - 1), 1000);
            } else {
                // All retries exhausted — show warning in status
                const promptStatus = document.getElementById('gemini-prompt-status');
                if (promptStatus) {
                    promptStatus.innerText = 'LOAD MANUALLY';
                    promptStatus.style.color = '#FF3B30';
                }
                console.warn('[PULSE] Prompt auto-load failed — use Load Prompt button');
            }
        } catch(e) {
            console.error('[PULSE] Failed to fetch prompt:', e);
            if (attemptsLeft > 0) {
                setTimeout(() => tryLoadPrompt(attemptsLeft - 1), 1000);
            }
        }
    };

    // Start first attempt after 3000ms to allow backend store to persist
    setTimeout(() => tryLoadPrompt(3), 3000);
  }
}

function showApprovalBanner(id, message, onApprove) {
  const container = document.getElementById("approval-banner-container");
  if (!container) return;

  // Prevent duplicate banners — if already showing, skip
  const existing = document.getElementById(`banner-${id}`);
  if (existing) {
    console.log(`[PULSE] Banner ${id} already showing — skipping duplicate`);
    return;
  }

  const banner = document.createElement("div");
  banner.id = `banner-${id}`;
  banner.className = "approval-banner slide-down";
  banner.innerHTML = `
    <span>${message}</span>
    <button class="primary" id="btn-approve-${id}" style="padding: 6px 16px; font-weight: bold; background: #00E5FF; color: #080C10; border: none; cursor: pointer; border-radius: 4px;">APPROVE</button>
  `;
  container.appendChild(banner);
  
  document.getElementById(`btn-approve-${id}`).addEventListener("click", onApprove);
}

function hideApprovalBanner(id) {
  const banner = document.getElementById(`banner-${id}`);
  if (banner) {
    banner.remove();
  }
}


function renderLoyaltyNotifications(notifications) {
    if (!notifications || notifications.length === 0)
        return;

    // --- PANEL 1: Collapsible message cards ---
    const messagesPanel = document.getElementById(
        'loyalty-messages-panel'
    );
    const messagesList = document.getElementById(
        'loyalty-messages-list'
    );

    if (messagesPanel) messagesPanel.style.display = 'block';

    if (messagesList) {
        messagesList.innerHTML = '';

        // Create a collapsed row showing all 5 tenant chips
        const summaryRow = document.createElement('div');
        summaryRow.style.cssText = `
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
            margin-bottom: 6px;
        `;

        notifications.forEach((notif, index) => {
            const tenantName = notif.tenant_name ||
                               notif.tenant_id || '?';
            const initials = tenantName
                .split(' ')
                .map(w => w[0])
                .join('')
                .substring(0, 2)
                .toUpperCase();

            // Chip button
            const chip = document.createElement('div');
            chip.id = `loyalty-chip-${index}`;
            chip.style.cssText = `
                display: flex;
                align-items: center;
                gap: 5px;
                padding: 4px 10px;
                background: rgba(212, 175, 55, 0.08);
                border: 1px solid rgba(212, 175, 55, 0.25);
                border-radius: 20px;
                cursor: pointer;
                font-family: var(--font-mono);
                font-size: 9px;
                color: #D4AF37;
                transition: all 0.2s;
                backdrop-filter: blur(8px);
            `;
            chip.innerHTML = `
                <div style="width: 16px; height: 16px;
                            border-radius: 50%;
                            background: rgba(212,175,55,0.2);
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-size: 7px;
                            font-weight: bold;">
                    ${initials}
                </div>
                ${tenantName.split(' ')[0]}
            `;

            // Popup card (hidden by default)
            const popup = document.createElement('div');
            popup.id = `loyalty-popup-${index}`;
            popup.style.cssText = `
                display: none;
                position: absolute;
                z-index: 1000;
                background: rgba(8, 12, 16, 0.95);
                border: 1px solid rgba(212, 175, 55, 0.4);
                border-radius: 8px;
                padding: 12px 14px;
                width: 260px;
                backdrop-filter: blur(16px);
                box-shadow: 0 8px 32px rgba(0,0,0,0.6),
                            0 0 16px rgba(212,175,55,0.1);
                font-family: var(--font-mono);
            `;
            popup.innerHTML = `
                <div style="font-size: 9px;
                            color: #D4AF37;
                            letter-spacing: 1px;
                            margin-bottom: 6px;
                            text-transform: uppercase;">
                    ${tenantName}
                </div>
                <div style="font-size: 11px;
                            color: #E8ECF1;
                            line-height: 1.5;">
                    ${notif.message || ''}
                </div>
                <div style="margin-top: 8px;
                            font-size: 8px;
                            color: #00FF88;">
                    ✓ Queued for delivery
                </div>
            `;

            // Toggle popup on chip click
            chip.onclick = (e) => {
                e.stopPropagation();
                // Close all other popups first
                notifications.forEach((_, i) => {
                    if (i !== index) {
                        const p = document.getElementById(
                            `loyalty-popup-${i}`
                        );
                        if (p) p.style.display = 'none';
                        const c = document.getElementById(
                            `loyalty-chip-${i}`
                        );
                        if (c) {
                            c.style.background =
                                'rgba(212, 175, 55, 0.08)';
                            c.style.borderColor =
                                'rgba(212, 175, 55, 0.25)';
                        }
                    }
                });

                const isOpen = popup.style.display === 'block';
                popup.style.display = isOpen ? 'none' : 'block';
                chip.style.background = isOpen
                    ? 'rgba(212, 175, 55, 0.08)'
                    : 'rgba(212, 175, 55, 0.2)';
                chip.style.borderColor = isOpen
                    ? 'rgba(212, 175, 55, 0.25)'
                    : 'rgba(212, 175, 55, 0.7)';

                // Position popup above chip
                if (!isOpen) {
                    const rect = chip.getBoundingClientRect();
                    popup.style.top = (rect.top -
                        popup.offsetHeight - 8) + 'px';
                    popup.style.left = rect.left + 'px';
                }
            };

            summaryRow.appendChild(chip);
            document.body.appendChild(popup);
        });

        // Close popups on outside click
        document.addEventListener('click', () => {
            notifications.forEach((_, i) => {
                const p = document.getElementById(
                    `loyalty-popup-${i}`
                );
                if (p) p.style.display = 'none';
                const c = document.getElementById(
                    `loyalty-chip-${i}`
                );
                if (c) {
                    c.style.background =
                        'rgba(212, 175, 55, 0.08)';
                    c.style.borderColor =
                        'rgba(212, 175, 55, 0.25)';
                }
            });
        }, { once: true });

        messagesList.appendChild(summaryRow);
    }

    // --- PANEL 2: Sending animation (staggered) ---
    const container = document.getElementById(
        'loyalty-notification-list'
    );
    const status = document.getElementById(
        'loyalty-status'
    );

    if (!container) return;
    container.innerHTML = '';

    if (status) {
        status.innerText = 'SENDING...';
        status.style.color = '#D4AF37';
    }

    notifications.forEach((notif, index) => {
        setTimeout(() => {
            const tenantName = notif.tenant_name ||
                               notif.tenant_id || '?';
            const customerName = notif.customer_name ||
                                 'Loyalty Member';

            const initials = tenantName
                .split(' ')
                .map(w => w[0])
                .join('')
                .substring(0, 2)
                .toUpperCase();

            const card = document.createElement('div');
            card.style.cssText = `
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 5px 8px;
                background: var(--bg-panel-inner);
                border-left: 2px solid var(--accent-blue);
                border-radius: 2px;
            `;
            card.innerHTML = `
                <div style="width: 24px; height: 24px;
                            border-radius: 50%;
                            background: var(--border-color);
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-size: 9px;
                            font-weight: bold;
                            color: var(--accent-blue);
                            flex-shrink: 0;">
                    ${initials}
                </div>
                <div style="flex: 1; min-width: 0;
                            font-family: var(--font-mono);">
                    <span style="font-size: 10px;
                                 color: var(--text-primary);">
                        ${customerName}
                    </span>
                    <span style="font-size: 9px;
                                 color: var(--text-muted);">
                        — ${tenantName}
                    </span>
                </div>
                <div style="font-size: 9px;
                            color: #00FF88;
                            flex-shrink: 0;">
                    ✓
                </div>
            `;
            container.appendChild(card);
            container.scrollTop = container.scrollHeight;

            if (index === notifications.length - 1) {
                setTimeout(() => {
                    if (status) {
                        status.innerText =
                            `${notifications.length} SENT`;
                        status.style.color = '#00FF88';
                    }
                }, 400);
            }
        }, index * 700);
    });
}

function renderThumbnails(creatives, tenants) {
  const grid = document.getElementById('creatives-grid');
  if (!grid) return;
  grid.innerHTML = '';
  
  creatives.forEach((creative, idx) => {
    const url = creative.url || creative;
    const tenantName = creative.tenant_name || (tenants && tenants[idx]) || 'Tenant';
    const tenantId = creative.tenant_id || '';
    const rank = creative.rank || (idx + 1);
    const isGenerated = creative.is_generated !== false;

    const card = document.createElement('div');
    card.style.cssText = `
        background: #0A0F16;
        border: 1px solid #1E2A38;
        border-radius: 4px;
        overflow: hidden;
        cursor: pointer;
        transition: border-color 0.2s;
        padding: 4px;
    `;

    const isRealImage = url && (
        url.endsWith('.png') ||
        url.endsWith('.jpg') ||
        url.endsWith('.webp')
    );

    if (isRealImage) {
        card.className = 'creative-thumbnail shimmer';
        const img = document.createElement('img');
        img.src = url;
        img.style.cssText = `
            width: 100%;
            height: 72px;
            object-fit: cover;
            border-radius: 2px;
            display: block;
            opacity: 0;
            transition: opacity 0.5s;
        `;
        img.onload = () => {
            card.classList.remove('shimmer');
            img.style.opacity = '1';
            if (window.pulseSimulation && tenantId) {
                window.pulseSimulation.focusOnStoreForCreative(tenantId, 3000);
            }
        };
        img.onerror = () => {
            card.classList.remove('shimmer');
            const iframe = document.createElement('iframe');
            iframe.src = `/assets/premade_ads/${tenantId}.html`;
            iframe.style.cssText = 'width:100%; height:72px; border:none; pointer-events:none; display:block;';
            card.appendChild(iframe);
            console.warn(`[Dashboard] Image not found, falling back to HTML: ${url}`);
        };
        card.appendChild(img);
    } else {
        card.className = 'premade-ad-frame';
        const iframe = document.createElement('iframe');
        iframe.src = url;
        iframe.style.cssText = 'width:100%; height:72px; border:none; pointer-events:none; display:block;';
        card.appendChild(iframe);
    }

    const nameDiv = document.createElement('div');
    nameDiv.style.cssText = `
        font-family: var(--font-mono, monospace);
        font-size: 8px;
        color: var(--text-muted, #6B7A8D);
        text-align: center;
        padding: 2px 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    `;
    nameDiv.innerText = tenantName.toUpperCase();
    card.appendChild(nameDiv);

    const rankDiv = document.createElement('div');
    rankDiv.style.cssText = `
        font-family: var(--font-mono, monospace);
        font-size: 7px;
        color: #D4AF37;
        text-align: center;
        padding: 1px 0;
    `;
    rankDiv.innerText = `#${rank} ${isGenerated ? 'AI GEN' : 'PREMADE'}`;
    card.appendChild(rankDiv);

    card.addEventListener('click', () => openCreativeModal(url, tenantName, tenantId));
    grid.appendChild(card);
  });
}

function openCreativeModal(url, storeName, tenantId) {
  const modal = document.getElementById('creative-modal');
  if (!modal) return;
  
  const details = campaignDetails[tenantId] || { headline: 'Special Campaign', body: 'Exclusive offer available now.' };
  
  const isImageUrl = url && (
    url.endsWith('.png') ||
    url.endsWith('.jpg') ||
    url.endsWith('.webp') ||
    url.includes('/assets/generated/') ||
    url.includes('/assets/creatives/')
  );

  let contentHtml = '';
  if (isImageUrl) {
    contentHtml = `<img src="${url}" style="width:100%; height:auto; border-radius:4px; border:1px solid #1E2D4A;" alt="${storeName}">`;
  } else {
    contentHtml = `<iframe src="/assets/premade_ads/${tenantId}.html" style="width:100%; height:280px; border:none; border-radius:4px;" sandbox="allow-scripts"></iframe>`;
  }
  
  modal.innerHTML = `
    <div style="position:relative; background:#0E131F; border:1px solid #1E2D4A; width:90%; max-width:640px; padding:20px; border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,0.6); display:flex; flex-direction:column; gap:15px;">
      <span onclick="document.getElementById('creative-modal').style.display='none'" 
            style="position:absolute; top:12px; right:16px; color:#4A5568; cursor:pointer; font-size:22px; font-weight:bold; line-height:1;">&times;</span>
      <h2 style="color:#00E5FF; margin:0; font-family:'Rajdhani',sans-serif; letter-spacing:2px;">${storeName.toUpperCase()}</h2>
      ${contentHtml}
      <div style="font-family:monospace; font-size:12px;">
        <div style="color:#FFD700; font-weight:bold; margin-bottom:6px;">"${details.headline}"</div>
        <p style="color:#718096; line-height:1.5;">${details.body}</p>
      </div>
    </div>
  `;
  modal.style.display = 'flex';
  modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
}

async function runTenantAcceptanceSequence(tenants) {
  // Timing preserved for simulation sync — cards removed from UI
  for (let i = 0; i < tenants.length; i++) {
    await new Promise(r => setTimeout(r, 800));
  }
}

function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    console.log("[WebSocket] Command center connected.");
  };
  
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWebSocketMessage(msg);
    } catch (e) {
      console.error("[WebSocket] message parsing error:", e);
    }
  };
  
  ws.onclose = () => {
    setTimeout(connectWebSocket, 5000);
  };
}

function handleWebSocketMessage(msg) {
  if (msg.type === "fivetran_sync") {
    // Handled by header signal — old panel removed
  }

  if (msg.type === "screen_activated" && window.pulseSimulation) {
    window.pulseSimulation.updateAdScreen(msg.screen_id, msg.creative_url);
  }

  if (msg.type === "campaign_fired") {
    if (msg.tts_audio_url) {
        window.pendingAnnouncementUrl = msg.tts_audio_url;
        console.log('[PULSE] Audio URL stored:', msg.tts_audio_url);
    }

    // Update active campaigns counter in header
    const campaignCount = msg.tenant_ids ? msg.tenant_ids.length : 5;
    const counterEl = document.getElementById('active-campaigns-count');
    if (counterEl) counterEl.innerText = campaignCount;

    transitionTo(DemoState.LIVE);
    
    const btn = document.getElementById('btn-activate-pulse');
    if (btn) {
      btn.style.animation = 'none';
      btn.style.boxShadow = '0 0 10px rgba(0,255,136,0.5)';
      btn.style.borderColor = '#00FF88';
      btn.innerText = "●";
    }
    
    // Set stores and screens in simulation
    if (window.pulseSimulation) {
        if (msg.tenant_ids) {
            // Check if any stores have active approval animations
            // If yes delay setting campaign_active to let the 5s 
            // red glow window complete first
            const sim = window.pulseSimulation;
            const hasActiveApproval = msg.tenant_ids.some(id => {
                const store = sim.stores[id.toUpperCase()];
                return store && store._approvalPulseInterval;
            });
            
            if (hasActiveApproval) {
                console.log('[Dashboard] Deferring campaign_active — approval animation running');
                // Wait 6.5s to let 5s red glow + 1s approved text complete
                setTimeout(() => {
                    msg.tenant_ids.forEach(id => {
                        const store = sim.stores[id.toUpperCase()];
                        // Only set if not already handled by pending_approval timeout
                        if (store && !store._approvalHandled) {
                            sim.setStoreState(id.toUpperCase(), 'campaign_active');
                        }
                    });
                }, 6500);
            } else {
                // No approval animation — apply immediately
                msg.tenant_ids.forEach(id => {
                    sim.setStoreState(id.toUpperCase(), 'campaign_active');
                });
            }
        }
        
        // Screen updates still happen immediately regardless
        if (msg.creatives) {
            msg.creatives.forEach(c => {
                if (c.screens) {
                    c.screens.forEach(screenId => {
                        // Use the url from the creative object directly
                        const url = c.url || `/assets/creatives/${c.tenant_id}_ad.png`;
                        window.pulseSimulation.updateAdScreen(
                            screenId, 
                            url
                        );
                    });
                }
            });
        }
    }
    
    // Animate revenue counter — use real daily revenue from Square if available
    const dailyRevenue = msg.daily_revenue || 148250;
    animateRevenueCounter(dailyRevenue);

    // Update REVENUE TODAY HUD counter
    const todayRevEl = document.getElementById('today-rev-val');
    if (todayRevEl) {
      todayRevEl.innerText = '$' + Math.round(dailyRevenue).toLocaleString();
    }

    // Play PA announcement audio after ads are deployed
    const audioUrl = msg.tts_audio_url || '/assets/audio/announcement.mp3';
    if (audioUrl) {
        setTimeout(() => {
            currentAnnouncementAudio = new Audio(audioUrl);
            window.currentAnnouncementAudio = currentAnnouncementAudio;
            currentAnnouncementAudio.volume = 0.8;
            currentAnnouncementAudio.play().then(() => {
                console.log('[PULSE] PA announcement playing');
                showStopAnnouncementButton();
            }).catch(err => {
                console.warn('[PULSE] Autoplay blocked:', err.message);
                showAudioPlayButton(audioUrl);
                showStopAnnouncementButton();
            });
            currentAnnouncementAudio.onended = () => {
                window.currentAnnouncementAudio = null;
                currentAnnouncementAudio = null;
                hideStopAnnouncementButton();
            };
        }, 3000);
    }

  }
}

function showAudioPlayButton(audioUrl) {
    const existing = document.getElementById('audio-play-banner');
    if (existing) existing.remove();

    const btn = document.createElement('div');
    btn.id = 'audio-play-banner';
    btn.style.cssText = `
        position: fixed;
        bottom: 80px;
        right: 24px;
        z-index: 9999;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 18px;
        background: #FFFFFF;
        border: 2px solid #B8860B;
        border-radius: 8px;
        cursor: pointer;
        font-family: var(--font-mono, monospace);
        box-shadow: 0 4px 16px rgba(0,0,0,0.15);
        pointer-events: all;
        transition: all 0.2s;
    `;
    btn.innerHTML = `
        <span style="font-size: 18px;">📢</span>
        <div>
            <div style="font-size: 11px;
                        color: #B8860B;
                        font-weight: bold;
                        letter-spacing: 1px;">
                PA ANNOUNCEMENT READY
            </div>
            <div style="font-size: 9px;
                        color: #5A6A7A;
                        margin-top: 2px;">
                Click to play campaign announcement
            </div>
        </div>
        <span style="font-size: 20px;
                     color: #B8860B;">▶</span>
    `;
    btn.onclick = () => playAnnouncement(audioUrl);
    btn.onmouseover = () => {
        btn.style.background = '#FFFBEB';
        btn.style.borderColor = '#92650A';
    };
    btn.onmouseout = () => {
        btn.style.background = '#FFFFFF';
        btn.style.borderColor = '#B8860B';
    };
    document.body.appendChild(btn);
}

function playAnnouncement(audioUrl) {
    const banner = document.getElementById('audio-play-banner');
    if (banner) banner.remove();

    const url = audioUrl ||
                window.pendingAnnouncementUrl ||
                '/assets/audio/announcement.mp3';

    if (!url) {
        console.warn('[PULSE] No audio URL available');
        return;
    }

    if (window.currentAnnouncementAudio) {
        window.currentAnnouncementAudio.pause();
        window.currentAnnouncementAudio = null;
    }

    const audio = new Audio(url);
    audio.volume = 0.8;
    currentAnnouncementAudio = audio;
    window.currentAnnouncementAudio = audio;

    audio.play()
        .then(() => {
            console.log('[PULSE] PA announcement playing');
            const banner = document.getElementById('audio-play-banner');
            if (banner) banner.remove();
            showStopAnnouncementButton();
        })
        .catch(err => {
            console.error('[PULSE] Play failed:', err);
        });

    audio.onended = () => {
        hideStopAnnouncementButton();
        window.currentAnnouncementAudio = null;
        currentAnnouncementAudio = null;
    };
}

function showStopAnnouncementButton() {
    const existing = document.getElementById('stop-announcement-btn');
    if (existing) existing.remove();

    const btn = document.createElement('button');
    btn.id = 'stop-announcement-btn';
    btn.innerText = '■ STOP ANNOUNCEMENT';
    btn.onclick = stopAnnouncement;
    btn.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 9999;
        padding: 8px 16px;
        font-size: 11px;
        font-family: var(--font-mono, monospace);
        font-weight: bold;
        letter-spacing: 1px;
        background: rgba(8, 12, 16, 0.95);
        border: 1px solid #FF4444;
        color: #FF4444;
        cursor: pointer;
        border-radius: 4px;
        pointer-events: all;
    `;
    document.body.appendChild(btn);
}

function hideStopAnnouncementButton() {
    const btn = document.getElementById('stop-announcement-btn');
    if (btn) btn.remove();
}

function stopAnnouncement() {
    if (currentAnnouncementAudio) {
        currentAnnouncementAudio.pause();
        currentAnnouncementAudio.currentTime = 0;
        currentAnnouncementAudio = null;
    }
    window.currentAnnouncementAudio = null;
    hideStopAnnouncementButton();
    console.log('[PULSE] Announcement stopped');
}

function animateRevenueCounter(target) {
  const el = document.getElementById("campaign-revenue");
  if (!el) return;
  
  const start = 0;
  const duration = 2000; // 2 seconds
  const startTime = performance.now();
  
  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1.0);
    const currentVal = Math.floor(start + progress * target);
    
    el.innerText = `$${currentVal.toLocaleString()}`;
    
    if (progress < 1.0) {
      requestAnimationFrame(update);
    }
  }
  
  requestAnimationFrame(update);
}

