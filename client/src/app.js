/**
 * PeruanisticSPEAK - Main Application Controller
 * Handles UI interactions, state management, reactive indicators and WebRTC orchestration.
 */

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[App] Initializing PeruanisticSPEAK...');

  // State
  const state = {
    peerId: localStorage.getItem('ps_peer_id') || 'peer_' + Math.random().toString(36).substring(2, 9),
    username: localStorage.getItem('ps_username') || 'Gamer_' + Math.floor(100 + Math.random() * 900),
    serverUrl: localStorage.getItem('ps_server_url') || 'ws://localhost:3001',
    currentRoom: 'voz-1',
    activeScreenOwner: null,
    shortcuts: JSON.parse(localStorage.getItem('ps_shortcuts') || JSON.stringify({
      toggleMute: 'Ctrl+Shift+M',
      toggleDeafen: 'Ctrl+Shift+D',
      toggleScreen: 'Ctrl+Shift+S',
      ptt: 'F9'
    })),
    recordingAction: null
  };

  localStorage.setItem('ps_peer_id', state.peerId);
  localStorage.setItem('ps_username', state.username);

  // DOM Elements
  const el = {
    // Window controls
    btnMinimize: document.getElementById('btnMinimize'),
    btnMaximize: document.getElementById('btnMaximize'),
    btnClose: document.getElementById('btnClose'),
    // Sidebar & Status
    serverStatusDot: document.getElementById('serverStatusDot'),
    serverTitleText: document.getElementById('serverTitleText'),
    voiceUserCountBadge: document.getElementById('voiceUserCountBadge'),
    channelItems: document.querySelectorAll('.channel-item'),
    participantsVoz1: document.getElementById('participantsVoz1'),
    participantsVoz2: document.getElementById('participantsVoz2'),
    participantsVozAfk: document.getElementById('participantsVozAfk'),
    // User deck
    localAvatar: document.getElementById('localAvatar'),
    localStatusIndicator: document.getElementById('localStatusIndicator'),
    localUsernameDisplay: document.getElementById('localUsernameDisplay'),
    localModeDisplay: document.getElementById('localModeDisplay'),
    btnUserProfile: document.getElementById('btnUserProfile'),
    btnToggleMute: document.getElementById('btnToggleMute'),
    btnToggleDeafen: document.getElementById('btnToggleDeafen'),
    btnToggleScreen: document.getElementById('btnToggleScreen'),
    btnOpenSettings: document.getElementById('btnOpenSettings'),
    btnOpenSettingsTop: document.getElementById('btnOpenSettingsTop'),
    // Stage & Topbar
    currentChannelHeader: document.getElementById('currentChannelHeader'),
    rtcStatusPill: document.getElementById('rtcStatusPill'),
    rtcStatusText: document.getElementById('rtcStatusText'),
    btnQuickShareScreen: document.getElementById('btnQuickShareScreen'),
    quickShareText: document.getElementById('quickShareText'),
    btnDisconnectVoice: document.getElementById('btnDisconnectVoice'),
    screenStage: document.getElementById('screenStage'),
    screenVideoElement: document.getElementById('screenVideoElement'),
    screenOverlayTop: document.getElementById('screenOverlayTop'),
    screenQualityBadge: document.getElementById('screenQualityBadge'),
    screenBroadcasterName: document.getElementById('screenBroadcasterName'),
    screenOverlayActions: document.getElementById('screenOverlayActions'),
    btnToggleFullscreen: document.getElementById('btnToggleFullscreen'),
    btnStopScreenShareOverlay: document.getElementById('btnStopScreenShareOverlay'),
    emptyScreenState: document.getElementById('emptyScreenState'),
    btnStartScreenFromEmpty: document.getElementById('btnStartScreenFromEmpty'),
    participantsGrid: document.getElementById('participantsGrid'),
    // Chat
    chatMessages: document.getElementById('chatMessages'),
    chatForm: document.getElementById('chatForm'),
    chatInput: document.getElementById('chatInput'),
    // Settings Modal
    settingsModal: document.getElementById('settingsModal'),
    btnCloseSettings: document.getElementById('btnCloseSettings'),
    btnSaveSettings: document.getElementById('btnSaveSettings'),
    modalTabs: document.querySelectorAll('.modal-tab'),
    tabPanes: document.querySelectorAll('.tab-pane'),
    selectAudioInput: document.getElementById('selectAudioInput'),
    micVolumeBar: document.getElementById('micVolumeBar'),
    selectInputMode: document.getElementById('selectInputMode'),
    selectScreenPreset: document.getElementById('selectScreenPreset'),
    inputUsername: document.getElementById('inputUsername'),
    inputServerUrl: document.getElementById('inputServerUrl'),
    btnReconnectServer: document.getElementById('btnReconnectServer'),
    btnKeyMute: document.getElementById('btnKeyMute'),
    btnKeyDeafen: document.getElementById('btnKeyDeafen'),
    btnKeyScreen: document.getElementById('btnKeyScreen'),
    btnKeyPtt: document.getElementById('btnKeyPtt')
  };

  // Update UI user profile
  el.localUsernameDisplay.textContent = state.username;
  el.localAvatar.textContent = state.username.charAt(0).toUpperCase();
  el.inputUsername.value = state.username;
  el.inputServerUrl.value = state.serverUrl;
  updateShortcutButtonsUI();

  // Instantiate Core Engines
  const signaling = new SignalingClient(state.serverUrl);
  const audio = new AudioManager();
  const screen = new ScreenShareManager();
  const peers = new PeerManager(signaling, audio, screen);

  // Initialize Microphone
  try {
    await audio.init();
    populateAudioDevices();
  } catch (err) {
    console.warn('[App] Could not initialize mic immediately (user may grant on click):', err);
  }

  // Connect Signaling Server
  connectSignaling();

  function connectSignaling() {
    signaling.connect(state.serverUrl);
  }

  signaling.on('connected', () => {
    el.serverStatusDot.classList.remove('disconnected');
    el.rtcStatusPill.classList.remove('disconnected');
    el.rtcStatusText.textContent = 'Voz Conectada';
    signaling.joinRoom(state.currentRoom, state.peerId, state.username);
  });

  signaling.on('disconnected', () => {
    el.serverStatusDot.classList.add('disconnected');
    el.rtcStatusPill.classList.add('disconnected');
    el.rtcStatusText.textContent = 'Reconectando...';
  });

  // UI Reactive Speakers & Voice Meter
  audio.on('volume', (vol) => {
    if (el.micVolumeBar) {
      el.micVolumeBar.style.width = vol + '%';
    }
  });

  audio.on('speaking-change', (isSpeaking) => {
    if (isSpeaking) {
      el.localAvatar.classList.add('speaking');
    } else {
      el.localAvatar.classList.remove('speaking');
    }
    updateParticipantCardSpeaking(state.peerId, isSpeaking);
  });

  audio.on('mute-change', (isMuted) => {
    if (isMuted) {
      el.btnToggleMute.classList.add('active-danger');
      el.localStatusIndicator.style.backgroundColor = 'var(--color-danger)';
    } else {
      el.btnToggleMute.classList.remove('active-danger');
      el.localStatusIndicator.style.backgroundColor = 'var(--color-speaking)';
    }
    renderParticipants();
  });

  audio.on('deafen-change', (isDeafened) => {
    if (isDeafened) {
      el.btnToggleDeafen.classList.add('active-danger');
    } else {
      el.btnToggleDeafen.classList.remove('active-danger');
    }
  });

  // Screen Share Events
  screen.on('started', (stream) => {
    el.btnToggleScreen.classList.add('active-primary');
    el.quickShareText.textContent = 'Detener Transmisión';
    el.btnQuickShareScreen.classList.remove('btn-secondary');
    el.btnQuickShareScreen.classList.add('btn-danger');

    displayScreenStream(stream, 'Tú (' + state.username + ')', screen.currentPreset, true);
  });

  screen.on('stopped', () => {
    el.btnToggleScreen.classList.remove('active-primary');
    el.quickShareText.textContent = 'Compartir Pantalla';
    el.btnQuickShareScreen.classList.remove('btn-danger');
    el.btnQuickShareScreen.classList.add('btn-secondary');

    if (state.activeScreenOwner === state.peerId) {
      clearScreenStream();
    }
  });

  // Remote Screen added/removed
  peers.on('remote-screen-added', (peerId, stream) => {
    const peer = peers.peerStates.get(peerId);
    const peerName = peer ? peer.username : 'Amigo';
    displayScreenStream(stream, peerName, '720p/1080p', false, peerId);
  });

  peers.on('remote-screen-removed', (peerId) => {
    if (state.activeScreenOwner === peerId) {
      clearScreenStream();
    }
  });

  peers.on('peers-updated', () => {
    renderParticipants();
  });

  function displayScreenStream(stream, title, preset, isLocal, ownerId = null) {
    state.activeScreenOwner = isLocal ? state.peerId : ownerId;
    el.emptyScreenState.style.display = 'none';
    el.screenVideoElement.style.display = 'block';
    el.screenVideoElement.srcObject = stream;
    el.screenVideoElement.play().catch(e => console.warn(e));

    el.screenOverlayTop.style.display = 'flex';
    el.screenOverlayActions.style.display = 'flex';
    el.screenBroadcasterName.textContent = title;
    el.screenQualityBadge.textContent = preset + ' 30fps';

    if (isLocal) {
      el.btnStopScreenShareOverlay.style.display = 'inline-flex';
    } else {
      el.btnStopScreenShareOverlay.style.display = 'none';
    }
  }

  function clearScreenStream() {
    state.activeScreenOwner = null;
    el.screenVideoElement.srcObject = null;
    el.screenVideoElement.style.display = 'none';
    el.screenOverlayTop.style.display = 'none';
    el.screenOverlayActions.style.display = 'none';
    el.emptyScreenState.style.display = 'flex';
  }

  // Render Participants in Voice Channel & Cards Grid
  function renderParticipants() {
    const activePeers = Array.from(peers.peerStates.values());
    const totalCount = activePeers.length + 1; // peers + local user
    el.voiceUserCountBadge.textContent = totalCount;

    // Sub-list in active sidebar channel
    const currentListContainer = state.currentRoom === 'voz-1'
      ? el.participantsVoz1
      : state.currentRoom === 'voz-2'
        ? el.participantsVoz2
        : el.participantsVozAfk;

    // Clear others
    el.participantsVoz1.innerHTML = '';
    el.participantsVoz2.innerHTML = '';
    el.participantsVozAfk.innerHTML = '';

    // Add local user in sidebar
    const localItem = document.createElement('div');
    localItem.className = 'participant-item';
    localItem.innerHTML = `
      <div class="participant-left">
        <div class="avatar-small ${audio.isSpeaking ? 'speaking' : ''}" id="sidebarAvatarLocal">${state.username.charAt(0).toUpperCase()}</div>
        <span>${escapeHtml(state.username)} (Tú)</span>
      </div>
      <div class="participant-icons">
        ${screen.isSharing ? '<span class="screen-share-tag">EN VIVO</span>' : ''}
        ${audio.isMuted ? '<span>🔇</span>' : ''}
      </div>
    `;
    currentListContainer.appendChild(localItem);

    // Add remote peers
    activePeers.forEach(peer => {
      const pItem = document.createElement('div');
      pItem.className = 'participant-item';
      pItem.innerHTML = `
        <div class="participant-left">
          <div class="avatar-small ${peer.isSpeaking ? 'speaking' : ''}">${escapeHtml(peer.username.charAt(0).toUpperCase())}</div>
          <span>${escapeHtml(peer.username)}</span>
        </div>
        <div class="participant-icons">
          ${peer.isSharingScreen ? '<span class="screen-share-tag">EN VIVO</span>' : ''}
          ${peer.isMuted ? '<span>🔇</span>' : ''}
        </div>
      `;
      currentListContainer.appendChild(pItem);
    });

    // Populate Participants Grid (Cards)
    el.participantsGrid.innerHTML = '';

    // Local user card
    const localCard = document.createElement('div');
    localCard.className = `participant-card ${audio.isSpeaking ? 'speaking' : ''}`;
    localCard.id = `card-peer-${state.peerId}`;
    localCard.innerHTML = `
      <div class="card-avatar ${audio.isSpeaking ? 'speaking' : ''}">${state.username.charAt(0).toUpperCase()}</div>
      <div class="card-name">${escapeHtml(state.username)} (Tú)</div>
      <div class="card-badges">
        ${screen.isSharing ? '<span class="screen-share-tag">TRANSMITIENDO</span>' : ''}
        ${audio.isMuted ? '<span style="color:var(--color-danger);font-size:11px;">Silenciado</span>' : ''}
      </div>
    `;
    el.participantsGrid.appendChild(localCard);

    // Remote peers cards
    activePeers.forEach(peer => {
      const card = document.createElement('div');
      card.className = `participant-card ${peer.isSpeaking ? 'speaking' : ''}`;
      card.id = `card-peer-${peer.peerId}`;
      card.innerHTML = `
        <div class="card-avatar ${peer.isSpeaking ? 'speaking' : ''}">${escapeHtml(peer.username.charAt(0).toUpperCase())}</div>
        <div class="card-name">${escapeHtml(peer.username)}</div>
        <div class="card-badges">
          ${peer.isSharingScreen ? '<span class="screen-share-tag">TRANSMITIENDO</span>' : ''}
          ${peer.isMuted ? '<span style="color:var(--color-danger);font-size:11px;">Silenciado</span>' : ''}
        </div>
      `;
      el.participantsGrid.appendChild(card);
    });
  }

  function updateParticipantCardSpeaking(peerId, isSpeaking) {
    const card = document.getElementById(`card-peer-${peerId}`);
    if (card) {
      if (isSpeaking) {
        card.classList.add('speaking');
      } else {
        card.classList.remove('speaking');
      }
    }
  }

  // Channel Switching
  el.channelItems.forEach(item => {
    item.addEventListener('click', () => {
      const chId = item.dataset.channelId;
      if (!chId || chId === state.currentRoom) return;

      el.channelItems.forEach(c => c.classList.remove('active'));
      item.classList.add('active');

      state.currentRoom = chId;
      el.currentChannelHeader.textContent = chId;
      signaling.joinRoom(state.currentRoom, state.peerId, state.username);
      renderParticipants();
    });
  });

  // Action Buttons
  el.btnToggleMute.addEventListener('click', () => audio.toggleMute());
  el.btnToggleDeafen.addEventListener('click', () => audio.toggleDeafen());
  el.btnToggleScreen.addEventListener('click', () => toggleScreenShare());
  el.btnQuickShareScreen.addEventListener('click', () => toggleScreenShare());
  el.btnStartScreenFromEmpty.addEventListener('click', () => toggleScreenShare());
  el.btnStopScreenShareOverlay.addEventListener('click', () => screen.stop());

  function toggleScreenShare() {
    const preset = el.selectScreenPreset.value || '720p';
    screen.toggle(preset).catch(err => {
      console.warn('[App] Screen share cancelled or error:', err);
    });
  }

  el.btnToggleFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      el.screenStage.requestFullscreen().catch(err => console.warn(err));
    } else {
      document.exitFullscreen().catch(err => console.warn(err));
    }
  });

  el.btnDisconnectVoice.addEventListener('click', () => {
    signaling.leaveRoom();
    audio.destroy();
    screen.stop();
    peers.destroy();
    el.rtcStatusPill.classList.add('disconnected');
    el.rtcStatusText.textContent = 'Desconectado';
    el.participantsGrid.innerHTML = '';
    el.voiceUserCountBadge.textContent = '0';
  });

  // Chat Submission
  el.chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = el.chatInput.value.trim();
    if (!text) return;
    signaling.sendChatMessage(text);
    el.chatInput.value = '';
  });

  signaling.on('chat-message', (msg) => {
    const row = document.createElement('div');
    row.className = 'chat-message-row';
    const dateStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    row.innerHTML = `
      <span class="chat-author">${escapeHtml(msg.username)}</span>
      <span class="chat-time">${dateStr}</span>
      <span class="chat-body">${escapeHtml(msg.text)}</span>
    `;
    el.chatMessages.appendChild(row);
    el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  });

  // Settings Modal Controls
  el.btnOpenSettings.addEventListener('click', () => openSettings());
  el.btnOpenSettingsTop.addEventListener('click', () => openSettings());
  el.btnCloseSettings.addEventListener('click', () => closeSettings());
  el.btnSaveSettings.addEventListener('click', () => saveSettings());

  function openSettings() {
    el.settingsModal.classList.remove('hidden');
    populateAudioDevices();
  }

  function closeSettings() {
    stopShortcutRecording();
    el.settingsModal.classList.add('hidden');
  }

  function saveSettings() {
    const newUsername = el.inputUsername.value.trim();
    if (newUsername && newUsername !== state.username) {
      state.username = newUsername;
      localStorage.setItem('ps_username', state.username);
      el.localUsernameDisplay.textContent = state.username;
      el.localAvatar.textContent = state.username.charAt(0).toUpperCase();
      signaling.joinRoom(state.currentRoom, state.peerId, state.username);
    }

    const newUrl = el.inputServerUrl.value.trim();
    if (newUrl && newUrl !== state.serverUrl) {
      state.serverUrl = newUrl;
      localStorage.setItem('ps_server_url', state.serverUrl);
      signaling.connect(state.serverUrl);
    }

    const mode = el.selectInputMode.value;
    audio.setInputMode(mode);
    el.localModeDisplay.textContent = mode === 'ptt' ? 'Push-To-Talk (' + state.shortcuts.ptt + ')' : 'VAD Activo';

    // Broadcast new shortcuts to Electron if running native
    syncShortcutsWithElectron();

    closeSettings();
  }

  // Settings Tabs Switcher
  el.modalTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      el.modalTabs.forEach(t => t.classList.remove('active'));
      el.tabPanes.forEach(p => p.classList.add('hidden'));

      tab.classList.add('active');
      const target = document.getElementById(tab.dataset.tab);
      if (target) target.classList.remove('hidden');
    });
  });

  async function populateAudioDevices() {
    const devices = await audio.getDevices();
    el.selectAudioInput.innerHTML = '<option value="">Predeterminado del sistema</option>';
    devices.inputs.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Micrófono (${d.deviceId.slice(0, 6)})`;
      el.selectAudioInput.appendChild(opt);
    });
  }

  el.selectAudioInput.addEventListener('change', async (e) => {
    if (e.target.value) {
      await audio.init(e.target.value);
    }
  });

  // Reconnect button
  el.btnReconnectServer.addEventListener('click', () => {
    state.serverUrl = el.inputServerUrl.value.trim();
    localStorage.setItem('ps_server_url', state.serverUrl);
    signaling.connect(state.serverUrl);
  });

  // -------------------------------------------------------------
  // Customizable Shortcuts & Key Recorder
  // -------------------------------------------------------------
  function updateShortcutButtonsUI() {
    el.btnKeyMute.textContent = state.shortcuts.toggleMute;
    el.btnKeyDeafen.textContent = state.shortcuts.toggleDeafen;
    el.btnKeyScreen.textContent = state.shortcuts.toggleScreen;
    el.btnKeyPtt.textContent = state.shortcuts.ptt;
  }

  const shortcutButtons = [el.btnKeyMute, el.btnKeyDeafen, el.btnKeyScreen, el.btnKeyPtt];
  shortcutButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      startShortcutRecording(btn, action);
    });
  });

  function startShortcutRecording(buttonElement, action) {
    stopShortcutRecording();
    state.recordingAction = action;
    buttonElement.classList.add('recording');
    buttonElement.textContent = 'Presiona tecla...';
  }

  function stopShortcutRecording() {
    if (!state.recordingAction) return;
    shortcutButtons.forEach(b => b.classList.remove('recording'));
    state.recordingAction = null;
    updateShortcutButtonsUI();
  }

  window.addEventListener('keydown', (e) => {
    // If currently recording a shortcut in Settings:
    if (state.recordingAction) {
      e.preventDefault();
      e.stopPropagation();

      // Ignore bare modifiers
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

      const keys = [];
      if (e.ctrlKey) keys.push('Ctrl');
      if (e.shiftKey) keys.push('Shift');
      if (e.altKey) keys.push('Alt');

      // Sanitize key name for Electron accelerator
      let keyName = e.key.toUpperCase();
      if (keyName === ' ') keyName = 'Space';
      if (keyName.startsWith('ARROW')) keyName = keyName.replace('ARROW', '');

      keys.push(keyName);
      const accelerator = keys.join('+');

      state.shortcuts[state.recordingAction] = accelerator;
      localStorage.setItem('ps_shortcuts', JSON.stringify(state.shortcuts));

      stopShortcutRecording();
      syncShortcutsWithElectron();
      return;
    }

    // Web-level PTT handling if in browser
    if (audio.inputMode === 'ptt') {
      const pttKey = state.shortcuts.ptt.toUpperCase();
      if (e.key.toUpperCase() === pttKey) {
        audio.pttKeyDown();
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    if (audio.inputMode === 'ptt') {
      const pttKey = state.shortcuts.ptt.toUpperCase();
      if (e.key.toUpperCase() === pttKey) {
        audio.pttKeyUp();
      }
    }
  });

  function syncShortcutsWithElectron() {
    if (window.electronAPI && window.electronAPI.updateShortcuts) {
      window.electronAPI.updateShortcuts(state.shortcuts);
      console.log('[App] Synced custom shortcuts to Electron:', state.shortcuts);
    }
  }

  // Listen to Global Shortcut triggers from Electron
  if (window.electronAPI && window.electronAPI.onShortcutTriggered) {
    window.electronAPI.onShortcutTriggered((action) => {
      console.log('[App] Received global shortcut action from Electron:', action);
      switch (action) {
        case 'toggleMute':
          audio.toggleMute();
          break;
        case 'toggleDeafen':
          audio.toggleDeafen();
          break;
        case 'toggleScreen':
          toggleScreenShare();
          break;
        case 'pttDown':
          audio.pttKeyDown();
          break;
        case 'pttUp':
          audio.pttKeyUp();
          break;
      }
    });

    // Window controls via Electron
    el.btnMinimize.addEventListener('click', () => window.electronAPI.minimize());
    el.btnMaximize.addEventListener('click', () => window.electronAPI.maximize());
    el.btnClose.addEventListener('click', () => window.electronAPI.close());

    // Initial sync
    syncShortcutsWithElectron();
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
