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
    isConnectedToVoice: true,
    activeScreenOwner: null,
    attachedImage: null,
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
    // Chat & Image Attachment
    chatMessages: document.getElementById('chatMessages'),
    chatForm: document.getElementById('chatForm'),
    chatInput: document.getElementById('chatInput'),
    btnAttachImage: document.getElementById('btnAttachImage'),
    fileImageInput: document.getElementById('fileImageInput'),
    chatImagePreviewBar: document.getElementById('chatImagePreviewBar'),
    chatPreviewThumb: document.getElementById('chatPreviewThumb'),
    chatPreviewFileName: document.getElementById('chatPreviewFileName'),
    btnCancelImage: document.getElementById('btnCancelImage'),
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
    btnKeyPtt: document.getElementById('btnKeyPtt'),
    // Screen Picker Modal
    screenPickerModal: document.getElementById('screenPickerModal'),
    screenPickerGrid: document.getElementById('screenPickerGrid'),
    btnCloseScreenPicker: document.getElementById('btnCloseScreenPicker'),
    btnCancelScreenPicker: document.getElementById('btnCancelScreenPicker'),
    // Quick Connect Modal
    connectServerModal: document.getElementById('connectServerModal'),
    quickInputUsername: document.getElementById('quickInputUsername'),
    quickInputServerUrl: document.getElementById('quickInputServerUrl'),
    btnCloseConnectModal: document.getElementById('btnCloseConnectModal'),
    btnQuickConnectSubmit: document.getElementById('btnQuickConnectSubmit')
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
    if (state.isConnectedToVoice && state.currentRoom) {
      el.rtcStatusPill.classList.remove('disconnected');
      el.rtcStatusText.textContent = 'Voz Conectada';
      signaling.joinRoom(state.currentRoom, state.peerId, state.username);
    }
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

  // Render Participants in Voice Channel & Cards Grid (Bug 1 Fix)
  function renderParticipants() {
    // If not connected to voice, clear everything visually
    if (!state.isConnectedToVoice || !state.currentRoom) {
      el.voiceUserCountBadge.textContent = '0';
      el.participantsVoz1.innerHTML = '';
      el.participantsVoz2.innerHTML = '';
      el.participantsVozAfk.innerHTML = '';
      el.participantsGrid.innerHTML = '';
      return;
    }

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

  // Channel Switching & Reconnect
  el.channelItems.forEach(item => {
    item.addEventListener('click', () => {
      const chId = item.dataset.channelId;
      if (!chId) return;

      if (!state.isConnectedToVoice) {
        state.isConnectedToVoice = true;
        el.rtcStatusPill.classList.remove('disconnected');
        el.rtcStatusText.textContent = 'Voz Conectada';
        audio.init().catch(e => console.warn(e));
      }

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

  // Screen Share Toggle with Picker Modal (Bug 4 Fix)
  async function toggleScreenShare() {
    if (screen.isSharing) {
      await screen.stop();
      return;
    }

    if (window.electronAPI && window.electronAPI.getScreenSources) {
      openScreenPicker();
    } else {
      const preset = el.selectScreenPreset.value || '720p';
      screen.start(preset).catch(err => {
        console.warn('[App] Screen share cancelled or error:', err);
      });
    }
  }

  async function openScreenPicker() {
    try {
      const sources = await window.electronAPI.getScreenSources();
      el.screenPickerGrid.innerHTML = '';
      if (!sources || sources.length === 0) {
        alert('No se detectaron pantallas ni ventanas de juegos disponibles.');
        return;
      }
      sources.forEach(src => {
        const item = document.createElement('div');
        item.className = 'screen-picker-item';
        item.innerHTML = `
          <img src="${src.thumbnail}" class="screen-picker-thumb" alt="${escapeHtml(src.name)}">
          <span class="screen-picker-title">${escapeHtml(src.name)}</span>
        `;
        item.addEventListener('click', async () => {
          el.screenPickerModal.classList.add('hidden');
          const preset = el.selectScreenPreset.value || '720p';
          try {
            await screen.start(preset, src.id);
          } catch (err) {
            console.error('[App] Failed to start screen share with source:', err);
          }
        });
        el.screenPickerGrid.appendChild(item);
      });
      el.screenPickerModal.classList.remove('hidden');
    } catch (err) {
      console.error('[App] Error opening screen picker:', err);
    }
  }

  el.btnCloseScreenPicker.addEventListener('click', () => el.screenPickerModal.classList.add('hidden'));
  el.btnCancelScreenPicker.addEventListener('click', () => el.screenPickerModal.classList.add('hidden'));

  el.btnToggleFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      el.screenStage.requestFullscreen().catch(err => console.warn(err));
    } else {
      document.exitFullscreen().catch(err => console.warn(err));
    }
  });

  // Disconnect from Voice (Bug 1 Fix)
  el.btnDisconnectVoice.addEventListener('click', () => {
    signaling.leaveRoom();
    screen.stop();
    peers.destroy();
    state.isConnectedToVoice = false;
    state.currentRoom = null;
    el.currentChannelHeader.textContent = 'Ninguno (Desconectado)';
    el.rtcStatusPill.classList.add('disconnected');
    el.rtcStatusText.textContent = 'Desconectado';
    el.channelItems.forEach(c => c.classList.remove('active'));
    renderParticipants();
  });

  // -------------------------------------------------------------
  // Chat & Image Upload / Paste (Feature 2)
  // -------------------------------------------------------------
  el.btnAttachImage.addEventListener('click', () => {
    el.fileImageInput.click();
  });

  el.fileImageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    processImageFile(file);
  });

  // Paste image from clipboard anywhere (Ctrl+V)
  window.addEventListener('paste', (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (const item of items) {
      if (item.type.indexOf('image') !== -1) {
        const file = item.getAsFile();
        if (file) {
          processImageFile(file);
          break;
        }
      }
    }
  });

  function processImageFile(file) {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const maxW = 1280;
        let w = img.width;
        let h = img.height;
        if (w > maxW) {
          h = Math.round((h * maxW) / w);
          w = maxW;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

        state.attachedImage = dataUrl;
        el.chatPreviewThumb.src = dataUrl;
        el.chatPreviewFileName.textContent = file.name || 'Captura de pantalla';
        el.chatImagePreviewBar.style.display = 'flex';
        el.chatInput.focus();
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  }

  el.btnCancelImage.addEventListener('click', () => {
    state.attachedImage = null;
    el.fileImageInput.value = '';
    el.chatImagePreviewBar.style.display = 'none';
  });

  // Chat Submission
  el.chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = el.chatInput.value.trim();
    if (!text && !state.attachedImage) return;

    signaling.send({
      type: 'chat-message',
      roomId: state.currentRoom || 'voz-1',
      text: text,
      image: state.attachedImage
    });

    el.chatInput.value = '';
    state.attachedImage = null;
    el.fileImageInput.value = '';
    el.chatImagePreviewBar.style.display = 'none';
  });

  signaling.on('chat-message', (msg) => {
    const row = document.createElement('div');
    row.className = 'chat-message-row';
    const dateStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    let imageHtml = '';
    if (msg.image) {
      imageHtml = `<div class="chat-image-wrap"><img src="${msg.image}" class="chat-image" title="Clic para ampliar" onclick="window.open('${msg.image}')"></div>`;
    }
    row.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:2px; width:100%;">
        <div style="display:flex; align-items:baseline; gap:8px;">
          <span class="chat-author">${escapeHtml(msg.username)}</span>
          <span class="chat-time">${dateStr}</span>
        </div>
        ${msg.text ? `<span class="chat-body">${escapeHtml(msg.text)}</span>` : ''}
        ${imageHtml}
      </div>
    `;
    el.chatMessages.appendChild(row);
    el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  });

  // -------------------------------------------------------------
  // Quick Connect Modal (First-run / Change Server)
  // -------------------------------------------------------------
  el.serverTitleText.style.cursor = 'pointer';
  el.serverTitleText.title = 'Clic para cambiar servidor';
  el.serverTitleText.addEventListener('click', () => openConnectModal());
  el.serverStatusDot.style.cursor = 'pointer';
  el.serverStatusDot.addEventListener('click', () => openConnectModal());

  function openConnectModal() {
    el.quickInputUsername.value = state.username;
    el.quickInputServerUrl.value = state.serverUrl;
    el.connectServerModal.classList.remove('hidden');
  }

  el.btnCloseConnectModal.addEventListener('click', () => el.connectServerModal.classList.add('hidden'));

  el.btnQuickConnectSubmit.addEventListener('click', () => {
    const user = el.quickInputUsername.value.trim();
    const url = el.quickInputServerUrl.value.trim();
    if (user) {
      state.username = user;
      localStorage.setItem('ps_username', user);
      el.localUsernameDisplay.textContent = user;
    }
    if (url) {
      state.serverUrl = url;
      localStorage.setItem('ps_server_url', url);
      signaling.connect(url);
    }
    el.connectServerModal.classList.add('hidden');
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
      if (state.isConnectedToVoice && state.currentRoom) {
        signaling.joinRoom(state.currentRoom, state.peerId, state.username);
      }
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

  el.btnReconnectServer.addEventListener('click', () => {
    state.serverUrl = el.inputServerUrl.value.trim();
    localStorage.setItem('ps_server_url', state.serverUrl);
    signaling.connect(state.serverUrl);
  });

  // Shortcuts & Key Recorder
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
    if (state.recordingAction) {
      e.preventDefault();
      e.stopPropagation();

      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

      const keys = [];
      if (e.ctrlKey) keys.push('Ctrl');
      if (e.shiftKey) keys.push('Shift');
      if (e.altKey) keys.push('Alt');

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
    }
  }

  // Listen to Global Shortcut triggers from Electron
  if (window.electronAPI && window.electronAPI.onShortcutTriggered) {
    window.electronAPI.onShortcutTriggered((action) => {
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

    el.btnMinimize.addEventListener('click', () => window.electronAPI.minimize());
    el.btnMaximize.addEventListener('click', () => window.electronAPI.maximize());
    el.btnClose.addEventListener('click', () => window.electronAPI.close());

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
