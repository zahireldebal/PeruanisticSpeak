/**
 * PeruanisticSPEAK - Main Application Controller
 * Handles UI interactions, state management, Discord-inspired 3-column layout,
 * WebRTC orchestration, chat persistence, emoji picker, theme toggling, and sound cues.
 */

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[App] Initializing PeruanisticSPEAK v1.0.1...');

  const EMOJIS = [
    '😀', '😂', '🤣', '😎', '🔥', '💀', '🎮',
    '👑', '👍', '👎', '❤️', '👀', '💯', '💩',
    '🎉', '🤡', '😭', '😡', '😱', '🤫', '🏆',
    '🎯', '🚀', '⭐', '⚡', '✨', '💪', '🤝',
    '🇵🇪', '🇧🇷', '👾', '🕹️', '🛡️', '⚔️', '💣'
  ];
  const DEFAULT_SERVER_URL = 'wss://peruanisticspeak.onrender.com';

  // -------------------------------------------------------------
  // Persistent State
  // -------------------------------------------------------------
  const state = {
    peerId: localStorage.getItem('ps_peer_id') || 'peer_' + Math.random().toString(36).substring(2, 9),
    username: localStorage.getItem('ps_username') || 'Gamer_' + Math.floor(100 + Math.random() * 900),
    avatar: localStorage.getItem('ps_avatar') || null,
    serverUrl: localStorage.getItem('ps_server_url') || DEFAULT_SERVER_URL,
    theme: localStorage.getItem('ps_theme') || 'dark',
    currentRoom: 'voz-1',
    activeTextChannel: 'general',
    isConnectedToVoice: true,
    activeScreenOwner: null,
    attachedImage: null,
    screenPreset: '720p',
    screenFps: 30,
    captureScreenAudio: true,
    serverRoomsState: {},
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

  
  // -------------------------------------------------------------
  // DOM References
  // -------------------------------------------------------------
  const el = {
    // Window controls
    btnMinimize: document.getElementById('btnMinimize'),
    btnMaximize: document.getElementById('btnMaximize'),
    btnClose: document.getElementById('btnClose'),

    // Server Rail & Theme
    btnToggleTheme: document.getElementById('btnToggleTheme'),
    iconThemeSun: document.getElementById('iconThemeSun'),
    iconThemeMoon: document.getElementById('iconThemeMoon'),

    // Sidebar & Status
    serverStatusDot: document.getElementById('serverStatusDot'),
    serverTitleText: document.getElementById('serverTitleText'),
    btnServerConnectHeader: document.getElementById('btnServerConnectHeader'),
    btnChangeServerPill: document.getElementById('btnChangeServerPill'),
    voiceUserCountBadge: document.getElementById('voiceUserCountBadge'),
    channelItems: document.querySelectorAll('.channel-item[data-channel-id]'),
    textChannelItems: document.querySelectorAll('.channel-item[data-text-channel]'),
    participantsVoz1: document.getElementById('participantsVoz1'),
    participantsVoz2: document.getElementById('participantsVoz2'),
    participantsVozAfk: document.getElementById('participantsVozAfk'),

    // User deck
    btnUserProfile: document.getElementById('btnUserProfile'),
    avatarFileInput: document.getElementById('avatarFileInput'),
    localAvatar: document.getElementById('localAvatar'),
    localStatusIndicator: document.getElementById('localStatusIndicator'),
    localUsernameDisplay: document.getElementById('localUsernameDisplay'),
    localModeDisplay: document.getElementById('localModeDisplay'),
    btnToggleMute: document.getElementById('btnToggleMute'),
    btnToggleDeafen: document.getElementById('btnToggleDeafen'),
    btnToggleScreen: document.getElementById('btnToggleScreen'),
    btnOpenSettings: document.getElementById('btnOpenSettings'),
    btnOpenSettingsTop: document.getElementById('btnOpenSettingsTop'),

    // Main Stage & Topbar
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
    screenViewerBadge: document.getElementById('screenViewerBadge'),
    screenViewerCount: document.getElementById('screenViewerCount'),
    screenOverlayActions: document.getElementById('screenOverlayActions'),
    btnToggleFullscreen: document.getElementById('btnToggleFullscreen'),
    btnStopScreenShareOverlay: document.getElementById('btnStopScreenShareOverlay'),
    emptyScreenState: document.getElementById('emptyScreenState'),
    btnStartScreenFromEmpty: document.getElementById('btnStartScreenFromEmpty'),
    participantsGrid: document.getElementById('participantsGrid'),

    // Right Members List
    membersCountTitle: document.getElementById('membersCountTitle'),
    membersList: document.getElementById('membersList'),

    // Chat Drawer & Emojis
    chatDrawer: document.getElementById('chatDrawer'),
    chatResizeHandle: document.getElementById('chatResizeHandle'),
    chatMessages: document.getElementById('chatMessages'),
    chatForm: document.getElementById('chatForm'),
    chatInput: document.getElementById('chatInput'),
    btnAttachImage: document.getElementById('btnAttachImage'),
    fileImageInput: document.getElementById('fileImageInput'),
    chatImagePreviewBar: document.getElementById('chatImagePreviewBar'),
    chatPreviewThumb: document.getElementById('chatPreviewThumb'),
    chatPreviewFileName: document.getElementById('chatPreviewFileName'),
    btnCancelImage: document.getElementById('btnCancelImage'),
    btnOpenEmojiPicker: document.getElementById('btnOpenEmojiPicker'),
    emojiPickerPopup: document.getElementById('emojiPickerPopup'),
    emojiGrid: document.getElementById('emojiGrid'),

    // Screen Share Quality Modal
    screenQualityModal: document.getElementById('screenQualityModal'),
    btnCloseScreenQualityModal: document.getElementById('btnCloseScreenQualityModal'),
    optPreset720p: document.getElementById('optPreset720p'),
    optPreset1080p: document.getElementById('optPreset1080p'),
    presetOptions: document.querySelectorAll('#screenQualityModal .preset-card-option'),
    checkCaptureScreenAudio: document.getElementById('checkCaptureScreenAudio'),
    btnCancelScreenQuality: document.getElementById('btnCancelScreenQuality'),
    btnConfirmScreenQuality: document.getElementById('btnConfirmScreenQuality'),

    // Screen Picker Modal (Electron desktopCapturer)
    screenPickerModal: document.getElementById('screenPickerModal'),
    screenPickerGrid: document.getElementById('screenPickerGrid'),
    btnCloseScreenPicker: document.getElementById('btnCloseScreenPicker'),
    btnCancelScreenPicker: document.getElementById('btnCancelScreenPicker'),

    // Settings Modal
    settingsModal: document.getElementById('settingsModal'),
    btnCloseSettings: document.getElementById('btnCloseSettings'),
    btnSaveSettings: document.getElementById('btnSaveSettings'),
    modalTabs: document.querySelectorAll('.modal-tab'),
    tabPanes: document.querySelectorAll('.tab-pane'),
    selectAudioInput: document.getElementById('selectAudioInput'),
    micVolumeBar: document.getElementById('micVolumeBar'),
    btnVoiceTest: document.getElementById('btnVoiceTest'),
    btnVoiceTestText: document.getElementById('btnVoiceTestText'),
    voiceTestStatusText: document.getElementById('voiceTestStatusText'),
    selectInputMode: document.getElementById('selectInputMode'),
    selectScreenPreset: document.getElementById('selectScreenPreset'),
    toggleNoiseSuppression: document.getElementById('toggleNoiseSuppression'),
    toggleEchoCancellation: document.getElementById('toggleEchoCancellation'),
    toggleAutoGain: document.getElementById('toggleAutoGain'),
    settingsAvatarPreview: document.getElementById('settingsAvatarPreview'),
    btnUploadAvatarSettings: document.getElementById('btnUploadAvatarSettings'),
    btnRemoveAvatarSettings: document.getElementById('btnRemoveAvatarSettings'),
    inputUsername: document.getElementById('inputUsername'),
    inputServerUrl: document.getElementById('inputServerUrl'),
    btnReconnectServer: document.getElementById('btnReconnectServer'),
    btnKeyMute: document.getElementById('btnKeyMute'),
    btnKeyDeafen: document.getElementById('btnKeyDeafen'),
    btnKeyScreen: document.getElementById('btnKeyScreen'),
    btnKeyPtt: document.getElementById('btnKeyPtt'),

    // Quick Connect Modal
    connectServerModal: document.getElementById('connectServerModal'),
    quickInputUsername: document.getElementById('quickInputUsername'),
    quickInputServerUrl: document.getElementById('quickInputServerUrl'),
    quickConnectError: document.getElementById('quickConnectError'),
    btnCloseConnectModal: document.getElementById('btnCloseConnectModal'),
    btnQuickConnectSubmit: document.getElementById('btnQuickConnectSubmit')
  };

  // Update UI theme and user profile on start
  applyTheme(state.theme);
  updateLocalProfileUI();
  el.inputUsername.value = state.username;
  el.inputServerUrl.value = state.serverUrl;
  updateShortcutButtonsUI();
  populateEmojiGrid();
  loadChannelChatHistory(state.activeTextChannel);

  // -------------------------------------------------------------
  // Instantiate WebRTC & Audio Engines
  // -------------------------------------------------------------
  const signaling = new SignalingClient(state.serverUrl);
  const audio = new AudioManager();
  const screen = new ScreenShareManager();
  const peers = new PeerManager(signaling, audio, screen);
  const sounds = new SoundEffects();

  // Sync saved audio processing settings with switches
  el.toggleNoiseSuppression.checked = !!audio.audioProcessing.noiseSuppression;
  el.toggleEchoCancellation.checked = !!audio.audioProcessing.echoCancellation;
  el.toggleAutoGain.checked = !!audio.audioProcessing.autoGainControl;

  // Initialize Microphone asynchronously without blocking UI listeners
  audio.init().then(() => {
    populateAudioDevices();
  }).catch((err) => {
    console.warn('[App] Microphone init note:', err);
  });

  // Connect to Signaling Server
  function connectSignaling() {
    signaling.connect(state.serverUrl);
  }

  if (!localStorage.getItem('ps_configured')) {
    openConnectModal();
  } else {
    connectSignaling();
  }

  // -------------------------------------------------------------
  // Signaling Connection Lifecycle
  // -------------------------------------------------------------
  signaling.on('connected', () => {
    el.serverStatusDot.classList.remove('disconnected');
    if (state.isConnectedToVoice && state.currentRoom) {
      el.rtcStatusPill.classList.remove('disconnected');
      el.rtcStatusText.textContent = 'Voz Conectada';
      signaling.joinRoom(state.currentRoom, state.peerId, state.username, state.avatar);
    }
  });

  signaling.on('disconnected', () => {
    el.serverStatusDot.classList.add('disconnected');
    el.rtcStatusPill.classList.add('disconnected');
    el.rtcStatusText.textContent = 'Reconectando...';
  });

  // Unique Nickname rejection handler (Feature 3)
  signaling.on('server-error', (err) => {
    if (err.code === 'nick-taken') {
      openConnectModal(err.message);
    }
  });

  // Server-wide channels state (Bug 4)
  signaling.on('server-state', (rooms) => {
    state.serverRoomsState = rooms || {};
    renderSidebarChannelsFromState();
    renderMembersList();
  });

  // Chat history kept by the server (text channels are server-wide)
  signaling.on('chat-history', (channels) => {
    for (const [channelId, messages] of Object.entries(channels || {})) {
      mergeChatHistory(channelId, messages);
    }
    loadChannelChatHistory(state.activeTextChannel);
  });

  // Sound cues on join / leave (Feature 7)
  signaling.on('user-joined', () => {
    sounds.playJoin();
  });

  signaling.on('user-left', () => {
    sounds.playLeave();
  });

  // -------------------------------------------------------------
  // Audio & Voice Activity Events
  // -------------------------------------------------------------
  audio.on('volume', (vol) => {
    if (el.micVolumeBar) el.micVolumeBar.style.width = vol + '%';
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
      el.localStatusIndicator.style.backgroundColor = 'var(--danger-color)';
    } else {
      el.btnToggleMute.classList.remove('active-danger');
      el.localStatusIndicator.style.backgroundColor = 'var(--success-color)';
    }
    renderParticipants();
  });

  audio.on('deafen-change', (isDeafened) => {
    sounds.isEnabled = !isDeafened;
    // Deafen also silences the audio of a stream you are watching
    if (state.activeScreenOwner && state.activeScreenOwner !== state.peerId) {
      el.screenVideoElement.muted = isDeafened;
    }
    if (isDeafened) {
      el.btnToggleDeafen.classList.add('active-danger');
    } else {
      el.btnToggleDeafen.classList.remove('active-danger');
    }
    renderParticipants();
  });

  // -------------------------------------------------------------
  // Screen Share Events
  // -------------------------------------------------------------
  screen.on('started', (stream, videoTrack, audioTrack) => {
    // Chime on start, but not while capturing system audio (it would be the first thing
    // viewers hear in the stream).
    if (!audioTrack) sounds.playScreenShareStart();
    el.btnToggleScreen.classList.add('active-primary');
    el.quickShareText.textContent = 'Detener Transmisión';
    el.btnQuickShareScreen.classList.remove('btn-secondary');
    el.btnQuickShareScreen.classList.add('btn-danger');

    displayScreenStream(stream, `Tú (${state.username})`, `${screen.currentPreset} @ ${screen.currentFps}fps`, true);
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

  peers.on('remote-screen-added', (peerId, stream) => {
    const peer = peers.peerStates.get(peerId);
    const peerName = peer ? peer.username : 'Amigo';
    displayScreenStream(stream, peerName, describeRemoteStream(stream), false, peerId);
  });

  peers.on('remote-screen-removed', (peerId) => {
    if (state.activeScreenOwner === peerId) {
      clearScreenStream();
      // Another friend is still streaming? Switch to it automatically.
      for (const [otherId, otherStream] of peers.remoteScreenStreams.entries()) {
        if (otherId !== peerId) {
          watchRemoteScreen(otherId, otherStream);
          break;
        }
      }
    }
  });

  function watchRemoteScreen(peerId, stream) {
    const peer = peers.peerStates.get(peerId);
    displayScreenStream(stream, peer ? peer.username : 'Amigo', describeRemoteStream(stream), false, peerId);
  }

  // "VER" on a LIVE user: show their stream, or ask them to resend it if it never arrived
  function watchPeerStream(peerId) {
    const stream = peers.remoteScreenStreams.get(peerId);
    if (stream) {
      watchRemoteScreen(peerId, stream);
    } else {
      signaling.sendRequestRenegotiate(peerId);
    }
  }

  // Feature 8: Screen Viewers
  peers.on('viewers-changed', (viewersList) => {
    el.screenViewerCount.textContent = viewersList.length;
    el.screenViewerBadge.title = viewersList.length > 0
      ? `Espectadores (${viewersList.length}): ${viewersList.join(', ')}`
      : 'Nadie está viendo tu pantalla aún';
  });

  peers.on('viewer-joined', (viewerName) => {
    sounds.playViewerJoined();
  });

  peers.on('peers-updated', () => {
    renderParticipants();
    renderMembersList();
  });

  function displayScreenStream(stream, title, preset, isLocal, ownerId = null) {
    state.activeScreenOwner = isLocal ? state.peerId : ownerId;
    el.emptyScreenState.style.display = 'none';
    el.screenVideoElement.style.display = 'block';
    el.screenVideoElement.muted = !!isLocal || audio.isDeafened;
    el.screenVideoElement.volume = isLocal ? 1 : getStreamVolume(ownerId) / 100;
    el.screenVideoElement.srcObject = stream;
    el.screenVideoElement.play().catch(e => console.warn(e));

    el.screenOverlayTop.style.display = 'flex';
    el.screenOverlayActions.style.display = 'flex';
    el.screenBroadcasterName.textContent = title;
    el.screenQualityBadge.textContent = preset;

    if (isLocal) {
      el.screenViewerBadge.style.display = 'flex';
      el.btnStopScreenShareOverlay.style.display = 'inline-flex';
    } else {
      el.screenViewerBadge.style.display = 'none';
      el.btnStopScreenShareOverlay.style.display = 'none';
    }
  }

  // Badge for a remote stream: resolution + fps read from the received video track
  function describeRemoteStream(stream) {
    const track = stream && stream.getVideoTracks()[0];
    const settings = (track && track.getSettings) ? track.getSettings() : {};
    if (settings.height) {
      const fps = settings.frameRate ? ` @ ${Math.round(settings.frameRate)}fps` : '';
      return `${settings.height}p${fps}`;
    }
    return 'En vivo';
  }

  function clearScreenStream() {
    state.activeScreenOwner = null;
    el.screenVideoElement.srcObject = null;
    el.screenVideoElement.style.display = 'none';
    el.screenOverlayTop.style.display = 'none';
    el.screenOverlayActions.style.display = 'none';
    el.emptyScreenState.style.display = 'flex';
  }

  // -------------------------------------------------------------
  // Participant & Channel Rendering
  // -------------------------------------------------------------
  function renderParticipants() {
    // The sidebar always shows who is in each voice channel (server-wide presence),
    // even when we are not connected to voice ourselves.
    renderSidebarChannelsFromState();

    if (!state.isConnectedToVoice || !state.currentRoom) {
      el.participantsGrid.innerHTML = '';
      return;
    }

    const activePeers = Array.from(peers.peerStates.values());

    // Render active voice channel cards grid
    el.participantsGrid.innerHTML = '';

    // Local user card
    const localCard = createParticipantCard({
      peerId: state.peerId,
      username: `${state.username} (Tú)`,
      avatar: state.avatar,
      isMuted: audio.isMuted,
      isDeafened: audio.isDeafened,
      isSpeaking: audio.isSpeaking,
      isSharingScreen: screen.isSharing
    });
    el.participantsGrid.appendChild(localCard);

    // Remote peers cards (click / right-click: volume)
    activePeers.forEach(peer => {
      const card = createParticipantCard(peer);
      attachVolumeMenu(card, peer.peerId);
      el.participantsGrid.appendChild(card);
    });
  }

  function createParticipantCard(user) {
    const card = document.createElement('div');
    card.className = `participant-card ${user.isSpeaking ? 'speaking' : ''}`;
    card.id = `card-peer-${user.peerId}`;

    const avatarHtml = user.avatar
      ? `<div class="card-avatar"><img src="${user.avatar}" alt="${escapeHtml(user.username)}"></div>`
      : `<div class="card-avatar">${escapeHtml(user.username.charAt(0).toUpperCase())}</div>`;

    let badgesHtml = '';
    if (user.peerId !== state.peerId && peers.getPeerVolume(user.peerId) !== 100) {
      badgesHtml += `<span class="volume-tag" title="Volumen personalizado">${peers.getPeerVolume(user.peerId)}%</span>`;
    }
    if (user.isSharingScreen) {
      const isRemote = user.peerId !== state.peerId;
      badgesHtml += isRemote
        ? `<button type="button" class="screen-share-tag watch-stream-btn" data-watch-peer="${escapeHtml(user.peerId)}" title="Ver transmisión">EN VIVO · VER</button>`
        : `<span class="screen-share-tag">EN VIVO</span>`;
    }
    if (user.isMuted) {
      badgesHtml += `<span title="Silenciado" style="color:var(--danger-color); font-size:12px;">🔇</span>`;
    }
    if (user.isDeafened) {
      badgesHtml += `<span title="Ensordecido" style="color:var(--danger-color); font-size:12px;">🎧</span>`;
    }

    card.innerHTML = `
      ${avatarHtml}
      <div class="card-name">${escapeHtml(user.username)}</div>
      <div class="card-badges">${badgesHtml}</div>
    `;
    const watchBtn = card.querySelector('[data-watch-peer]');
    if (watchBtn) {
      watchBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        watchPeerStream(user.peerId);
      });
    }
    return card;
  }

  function renderSidebarChannelsFromState() {
    el.participantsVoz1.innerHTML = '';
    el.participantsVoz2.innerHTML = '';
    el.participantsVozAfk.innerHTML = '';

    const channelContainers = {
      'voz-1': el.participantsVoz1,
      'voz-2': el.participantsVoz2,
      'sala-afk': el.participantsVozAfk
    };

    // If connected, add local user to currentRoom
    if (state.isConnectedToVoice && state.currentRoom && channelContainers[state.currentRoom]) {
      const localItem = createSidebarParticipantItem({
        peerId: state.peerId,
        username: `${state.username} (Tú)`,
        avatar: state.avatar,
        isMuted: audio.isMuted,
        isDeafened: audio.isDeafened,
        isSpeaking: audio.isSpeaking,
        isSharingScreen: screen.isSharing
      });
      channelContainers[state.currentRoom].appendChild(localItem);
    }

    // Add peers from serverRoomsState
    let voiceTotal = state.isConnectedToVoice && state.currentRoom ? 1 : 0;
    for (const [roomId, users] of Object.entries(state.serverRoomsState)) {
      const container = channelContainers[roomId];
      if (!container || !Array.isArray(users)) continue;

      users.forEach(u => {
        if (u.peerId === state.peerId) return; // already added above
        voiceTotal++;
        const item = createSidebarParticipantItem(u);
        // Volume can be adjusted for people in our own voice channel
        if (state.isConnectedToVoice && roomId === state.currentRoom) {
          attachVolumeMenu(item, u.peerId);
        }
        container.appendChild(item);
      });
    }
    el.voiceUserCountBadge.textContent = voiceTotal;
  }

  function createSidebarParticipantItem(user) {
    const item = document.createElement('div');
    item.className = 'participant-item';
    item.dataset.peerId = user.peerId;

    const avatarHtml = user.avatar
      ? `<div class="avatar-small ${user.isSpeaking ? 'speaking' : ''}"><img src="${user.avatar}" alt=""></div>`
      : `<div class="avatar-small ${user.isSpeaking ? 'speaking' : ''}">${escapeHtml(user.username.charAt(0).toUpperCase())}</div>`;

    item.innerHTML = `
      <div class="participant-left">
        ${avatarHtml}
        <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(user.username)}</span>
      </div>
      <div class="participant-icons">
        ${user.isSharingScreen ? '<span class="screen-share-tag">VIVO</span>' : ''}
        ${user.isMuted ? '<span>🔇</span>' : ''}
        ${user.isDeafened ? '<span>🎧</span>' : ''}
      </div>
    `;
    return item;
  }

  function renderMembersList() {
    el.membersList.innerHTML = '';
    const allUsers = new Map();

    // Add local user
    allUsers.set(state.peerId, {
      peerId: state.peerId,
      username: `${state.username} (Tú)`,
      avatar: state.avatar,
      isSpeaking: audio.isSpeaking,
      room: state.currentRoom
    });

    // Add peers from server state
    for (const [roomId, users] of Object.entries(state.serverRoomsState)) {
      if (Array.isArray(users)) {
        users.forEach(u => {
          if (!allUsers.has(u.peerId)) {
            allUsers.set(u.peerId, { ...u, room: roomId });
          }
        });
      }
    }

    // Also include WebRTC peers
    for (const [peerId, peer] of peers.peerStates.entries()) {
      if (!allUsers.has(peerId)) {
        allUsers.set(peerId, { ...peer, room: state.currentRoom });
      }
    }

    el.membersCountTitle.textContent = `EN LÍNEA — ${allUsers.size}`;

    allUsers.forEach(u => {
      const row = document.createElement('div');
      row.className = 'member-row';

      const avatarHtml = u.avatar
        ? `<div class="member-avatar ${u.isSpeaking ? 'speaking' : ''}"><img src="${u.avatar}" alt=""></div>`
        : `<div class="member-avatar ${u.isSpeaking ? 'speaking' : ''}">${escapeHtml(u.username.charAt(0).toUpperCase())}</div>`;

      row.innerHTML = `
        ${avatarHtml}
        <div class="member-meta">
          <span class="member-name">${escapeHtml(u.username)}</span>
          <span class="member-subtext">${u.room ? `En ${u.room}` : 'Conectado'}</span>
        </div>
      `;
      el.membersList.appendChild(row);
    });
  }

  // -------------------------------------------------------------
  // Per-user volume (0-100%) — click or right-click a user in your voice channel
  // -------------------------------------------------------------
  const streamVolumes = (() => {
    try { return JSON.parse(localStorage.getItem('ps_stream_volumes') || '{}'); } catch (_) { return {}; }
  })();

  function getStreamVolume(peerId) {
    return typeof streamVolumes[peerId] === 'number' ? streamVolumes[peerId] : 100;
  }

  function setStreamVolume(peerId, value) {
    streamVolumes[peerId] = value;
    try { localStorage.setItem('ps_stream_volumes', JSON.stringify(streamVolumes)); } catch (_) {}
    if (state.activeScreenOwner === peerId) el.screenVideoElement.volume = value / 100;
  }

  let volumePopover = null;

  function closeVolumePopover() {
    if (volumePopover) {
      volumePopover.remove();
      volumePopover = null;
      renderParticipants();
    }
  }

  function attachVolumeMenu(element, peerId) {
    element.classList.add('remote');
    element.title = 'Clic para ajustar el volumen';
    const open = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openVolumePopover(peerId, e.clientX, e.clientY);
    };
    element.addEventListener('click', open);
    element.addEventListener('contextmenu', open);
  }

  function volumeSliderHtml(id, label, value) {
    return `
      <label class="user-volume-label" for="${id}">
        <span>${label}</span><span class="user-volume-value" id="${id}Value">${value}%</span>
      </label>
      <input type="range" class="user-volume-range" id="${id}" min="0" max="100" step="1" value="${value}">
    `;
  }

  function openVolumePopover(peerId, x, y) {
    if (volumePopover) { volumePopover.remove(); volumePopover = null; }
    const peer = peers.peerStates.get(peerId);
    if (!peer) return;
    const watchingTheirStream = state.activeScreenOwner === peerId;

    const pop = document.createElement('div');
    pop.className = 'user-volume-popover';
    pop.innerHTML = `
      <div class="user-volume-title">${escapeHtml(peer.username)}</div>
      ${volumeSliderHtml('userVoiceVolume', 'Volumen de voz', peers.getPeerVolume(peerId))}
      ${watchingTheirStream ? volumeSliderHtml('userStreamVolume', 'Volumen de la transmisión', getStreamVolume(peerId)) : ''}
      <div class="user-volume-actions">
        <button type="button" class="btn btn-secondary btn-sm" id="btnResetUserVolume">Restablecer</button>
      </div>
    `;
    pop.addEventListener('click', e => e.stopPropagation());
    pop.addEventListener('contextmenu', e => e.stopPropagation());
    document.body.appendChild(pop);
    volumePopover = pop;

    // Keep the popover inside the window
    const rect = pop.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    pop.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;

    const voice = pop.querySelector('#userVoiceVolume');
    const voiceValue = pop.querySelector('#userVoiceVolumeValue');
    voice.addEventListener('input', () => {
      voiceValue.textContent = `${voice.value}%`;
      peers.setPeerVolume(peerId, voice.value);
    });

    const stream = pop.querySelector('#userStreamVolume');
    if (stream) {
      const streamValue = pop.querySelector('#userStreamVolumeValue');
      stream.addEventListener('input', () => {
        streamValue.textContent = `${stream.value}%`;
        setStreamVolume(peerId, Number(stream.value));
      });
    }

    pop.querySelector('#btnResetUserVolume').addEventListener('click', () => {
      voice.value = 100;
      voice.dispatchEvent(new Event('input'));
      if (stream) {
        stream.value = 100;
        stream.dispatchEvent(new Event('input'));
      }
    });
    voice.focus();
  }

  document.addEventListener('click', () => closeVolumePopover());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeVolumePopover(); });
  window.addEventListener('blur', () => closeVolumePopover());

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

  // -------------------------------------------------------------
  // Channel Switching & Teardown (Bug 6 Fix)
  // -------------------------------------------------------------
  el.channelItems.forEach(item => {
    item.addEventListener('click', () => {
      const chId = item.dataset.channelId;
      if (!chId || chId === state.currentRoom) return;

      console.log(`[App] Switching voice channel from "${state.currentRoom}" to "${chId}"`);

      // Destroy all existing peer connections so users in voz-1 cannot hear voz-2!
      peers.destroy();

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

      // Join new room cleanly
      signaling.joinRoom(state.currentRoom, state.peerId, state.username, state.avatar);
      sounds.playJoin();
      renderParticipants();
    });
  });

  // Text Channel Switching (Feature 9)
  el.textChannelItems.forEach(item => {
    item.addEventListener('click', () => {
      const textCh = item.dataset.textChannel;
      if (!textCh) return;

      el.textChannelItems.forEach(t => t.classList.remove('active'));
      item.classList.add('active');

      state.activeTextChannel = textCh;
      setTextChannelUnread(textCh, false);
      el.chatInput.placeholder = `Enviar mensaje a #${textCh}...`;
      loadChannelChatHistory(textCh);
    });
  });

  // Disconnect from Voice Call
  el.btnDisconnectVoice.addEventListener('click', () => {
    sounds.playLeave();
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

  // Action Buttons
  el.btnToggleMute.addEventListener('click', () => audio.toggleMute());
  el.btnToggleDeafen.addEventListener('click', () => audio.toggleDeafen());
  el.btnToggleScreen.addEventListener('click', () => handleScreenShareButton());
  el.btnQuickShareScreen.addEventListener('click', () => handleScreenShareButton());
  el.btnStartScreenFromEmpty.addEventListener('click', () => handleScreenShareButton());
  el.btnStopScreenShareOverlay.addEventListener('click', () => screen.stop());

  // -------------------------------------------------------------
  // Screen Share Quality & Audio Config (Bug 1 & 2)
  // -------------------------------------------------------------
  function handleScreenShareButton() {
    if (screen.isSharing) {
      screen.stop();
      return;
    }
    // Open Screen Quality & Audio selector modal
    el.screenQualityModal.classList.remove('hidden');
  }

  el.presetOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      state.screenPreset = opt.dataset.preset === '1080p' ? '1080p' : '720p';
      state.screenFps = opt.dataset.fps === '60' ? 60 : 30;
      el.presetOptions.forEach(o => o.classList.toggle('selected', o === opt));
    });
  });

  el.btnCloseScreenQualityModal.addEventListener('click', () => el.screenQualityModal.classList.add('hidden'));
  el.btnCancelScreenQuality.addEventListener('click', () => el.screenQualityModal.classList.add('hidden'));

  el.btnConfirmScreenQuality.addEventListener('click', () => {
    el.screenQualityModal.classList.add('hidden');
    state.captureScreenAudio = el.checkCaptureScreenAudio.checked;

    if (window.electronAPI && window.electronAPI.getScreenSources) {
      openScreenPicker();
    } else {
      screen.start(state.screenPreset, state.screenFps, null, state.captureScreenAudio).catch(err => {
        console.warn('[App] Screen share cancelled:', err);
      });
    }
  });

  async function openScreenPicker() {
    try {
      const sources = await window.electronAPI.getScreenSources();
      el.screenPickerGrid.innerHTML = '';
      if (!sources || sources.length === 0) {
        alert('No se detectaron pantallas ni ventanas de juegos.');
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
          try {
            await screen.start(state.screenPreset, state.screenFps, src.id, state.captureScreenAudio);
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

  // -------------------------------------------------------------
  // Chat Drawer: Resizable & Persistent (Bug 10 & Feature 9)
  // -------------------------------------------------------------
  let isResizingChat = false;
  let startY = 0;
  let startHeight = 240;

  el.chatResizeHandle.addEventListener('mousedown', (e) => {
    isResizingChat = true;
    startY = e.clientY;
    startHeight = el.chatDrawer.offsetHeight;
    el.chatResizeHandle.classList.add('active');
    document.body.style.cursor = 'ns-resize';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizingChat) return;
    const dy = startY - e.clientY;
    const newHeight = Math.min(Math.max(startHeight + dy, 120), window.innerHeight * 0.75);
    el.chatDrawer.style.height = `${newHeight}px`;
  });

  document.addEventListener('mouseup', () => {
    if (isResizingChat) {
      isResizingChat = false;
      el.chatResizeHandle.classList.remove('active');
      document.body.style.cursor = '';
    }
  });

  // Chat Image Attachment
  el.btnAttachImage.addEventListener('click', () => el.fileImageInput.click());
  el.fileImageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) processImageFile(file);
  });

  window.addEventListener('paste', (e) => {
    const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.includes('image')) {
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
        if (el.chatInput && typeof el.chatInput.focus === "function") el.chatInput.focus();
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

    signaling.sendChatMessage(text, state.attachedImage, state.activeTextChannel, {
      peerId: state.peerId,
      username: state.username,
      avatar: state.avatar
    });

    el.chatInput.value = '';
    state.attachedImage = null;
    el.fileImageInput.value = '';
    el.chatImagePreviewBar.style.display = 'none';
  });

  // Incoming Chat Message (Feature 5 & 9)
  signaling.on('chat-message', (msg) => {
    const targetRoom = msg.roomId || 'general';

    // Play notification sound if message is from another user
    if (msg.senderPeerId !== state.peerId) {
      sounds.playChatMessage();
    }

    // Save to channel history (skip duplicates)
    if (!saveChatMessageToStorage(targetRoom, msg)) return;

    // If currently viewing this channel, append immediately; otherwise mark it unread
    if (targetRoom === state.activeTextChannel) {
      appendChatMessageUI(msg);
    } else {
      setTextChannelUnread(targetRoom, true);
    }
  });

  function setTextChannelUnread(channelId, unread) {
    el.textChannelItems.forEach(item => {
      if (item.dataset.textChannel === channelId) item.classList.toggle('has-unread', unread);
    });
  }

  function chatMessageKey(msg) {
    return msg.id || `${msg.timestamp}|${msg.senderPeerId}|${msg.text}`;
  }

  function appendChatMessageUI(msg) {
    const row = document.createElement('div');
    row.className = 'chat-message-row';
    const dateStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const avatarHtml = msg.avatar
      ? `<div class="chat-avatar-thumb"><img src="${msg.avatar}" alt=""></div>`
      : `<div class="chat-avatar-thumb">${escapeHtml(msg.username.charAt(0).toUpperCase())}</div>`;

    let imageHtml = '';
    if (msg.image) {
      imageHtml = `<div class="chat-image-wrap"><img src="${msg.image}" class="chat-image" title="Clic para ampliar" onclick="window.open('${msg.image}')"></div>`;
    }

    row.innerHTML = `
      ${avatarHtml}
      <div class="chat-content-wrap">
        <div class="chat-author-line">
          <span class="chat-author">${escapeHtml(msg.username)}</span>
          <span class="chat-time">${dateStr}</span>
        </div>
        ${msg.text ? `<span class="chat-body">${escapeHtml(msg.text)}</span>` : ''}
        ${imageHtml}
      </div>
    `;
    el.chatMessages.appendChild(row);
    el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  }

  // Returns false if the message was already stored
  function saveChatMessageToStorage(roomId, msg) {
    try {
      const key = `ps_chat_${roomId}`;
      const history = JSON.parse(localStorage.getItem(key) || '[]');
      const msgKey = chatMessageKey(msg);
      if (history.some(m => chatMessageKey(m) === msgKey)) return false;
      history.push(msg);
      // Keep last 100 messages
      while (history.length > 100) history.shift();
      localStorage.setItem(key, JSON.stringify(history));
    } catch (_) {}
    return true;
  }

  // Union of local history and the server's recent messages, ordered by time
  function mergeChatHistory(roomId, serverMessages) {
    if (!Array.isArray(serverMessages) || serverMessages.length === 0) return;
    try {
      const key = `ps_chat_${roomId}`;
      const local = JSON.parse(localStorage.getItem(key) || '[]');
      const byKey = new Map(local.map(m => [chatMessageKey(m), m]));
      let added = 0;
      serverMessages.forEach(m => {
        const k = chatMessageKey(m);
        if (!byKey.has(k)) { byKey.set(k, m); added++; }
      });
      if (added === 0) return;
      const merged = Array.from(byKey.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)).slice(-100);
      localStorage.setItem(key, JSON.stringify(merged));
      if (roomId !== state.activeTextChannel) setTextChannelUnread(roomId, true);
    } catch (_) {}
  }

  function loadChannelChatHistory(roomId) {
    el.chatMessages.innerHTML = `
      <div class="chat-message-row">
        <div class="chat-avatar-thumb">#</div>
        <div class="chat-content-wrap">
          <div class="chat-author-line">
            <span class="chat-author">Canal #${roomId}</span>
            <span class="chat-time">ahora</span>
          </div>
          <span class="chat-body">Este es el inicio de la conversación en #${roomId}.</span>
        </div>
      </div>
    `;
    try {
      const key = `ps_chat_${roomId}`;
      const history = JSON.parse(localStorage.getItem(key) || '[]');
      history.forEach(msg => appendChatMessageUI(msg));
    } catch (_) {}
  }

  // -------------------------------------------------------------
  // Emoji Picker (Feature 6)
  // -------------------------------------------------------------
  

  function populateEmojiGrid() {
    el.emojiGrid.innerHTML = '';
    EMOJIS.forEach(emoji => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'emoji-btn';
      btn.textContent = emoji;
      btn.addEventListener('click', () => {
        insertEmoji(emoji);
        el.emojiPickerPopup.classList.remove('visible');
      });
      el.emojiGrid.appendChild(btn);
    });
  }

  function insertEmoji(emoji) {
    const input = el.chatInput;
    const start = input.selectionStart || input.value.length;
    const end = input.selectionEnd || input.value.length;
    input.value = input.value.substring(0, start) + emoji + input.value.substring(end);
    if (input && typeof input.focus === "function") input.focus();
    input.selectionStart = input.selectionEnd = start + emoji.length;
  }

  el.btnOpenEmojiPicker.addEventListener('click', (e) => {
    e.stopPropagation();
    el.emojiPickerPopup.classList.toggle('visible');
  });

  document.addEventListener('click', (e) => {
    if (!el.emojiPickerPopup.contains(e.target) && e.target !== el.btnOpenEmojiPicker) {
      el.emojiPickerPopup.classList.remove('visible');
    }
  });

  // -------------------------------------------------------------
  // Profile Picture Upload (Feature 2)
  // -------------------------------------------------------------
  el.btnUserProfile.addEventListener('click', () => el.avatarFileInput.click());
  el.btnUploadAvatarSettings.addEventListener('click', () => el.avatarFileInput.click());

  el.btnRemoveAvatarSettings.addEventListener('click', () => {
    state.avatar = null;
    localStorage.removeItem('ps_avatar');
    updateLocalProfileUI();
    signaling.sendUserState({ avatar: null });
    renderParticipants();
  });

  el.avatarFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        // Compress avatar to 64x64 JPEG
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 64, 64);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.75);

        state.avatar = dataUrl;
        localStorage.setItem('ps_avatar', dataUrl);
        updateLocalProfileUI();
        signaling.sendUserState({ avatar: dataUrl });
        renderParticipants();
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });

  function updateLocalProfileUI() {
    el.localUsernameDisplay.textContent = state.username;
    if (state.avatar) {
      el.localAvatar.innerHTML = `<img src="${state.avatar}" alt="${escapeHtml(state.username)}">`;
      el.settingsAvatarPreview.innerHTML = `<img src="${state.avatar}" alt="${escapeHtml(state.username)}">`;
    } else {
      const initial = state.username.charAt(0).toUpperCase();
      el.localAvatar.textContent = initial;
      el.settingsAvatarPreview.textContent = initial;
    }
  }

  // -------------------------------------------------------------
  // Theme Switching (Dark & Light)
  // -------------------------------------------------------------
  function applyTheme(theme) {
    state.theme = theme;
    try {
      localStorage.setItem('ps_theme', theme);
    } catch (_) {}
    document.documentElement.setAttribute('data-theme', theme);
    if (typeof el !== 'undefined' && el && el.iconThemeSun && el.iconThemeMoon) {
      if (theme === 'dark') {
        el.iconThemeSun.style.display = 'none';
        el.iconThemeMoon.style.display = 'block';
      } else {
        el.iconThemeSun.style.display = 'block';
        el.iconThemeMoon.style.display = 'none';
      }
    }
  }

  el.btnToggleTheme.addEventListener('click', () => {
    const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
  });

  // -------------------------------------------------------------
  // Server Quick Connect Modal
  // -------------------------------------------------------------
  el.serverTitleText.style.cursor = 'pointer';
  el.serverTitleText.addEventListener('click', () => openConnectModal());
  el.serverStatusDot.style.cursor = 'pointer';
  el.serverStatusDot.addEventListener('click', () => openConnectModal());
  if (el.btnChangeServerPill) el.btnChangeServerPill.addEventListener('click', () => openConnectModal());
  if (el.btnServerConnectHeader) el.btnServerConnectHeader.addEventListener('click', () => openConnectModal());

  function openConnectModal(errorMessage = null) {
    el.quickInputUsername.value = state.username;
    el.quickInputServerUrl.value = state.serverUrl || DEFAULT_SERVER_URL;
    if (errorMessage) {
      el.quickConnectError.textContent = errorMessage;
      el.quickConnectError.style.display = 'block';
    } else {
      el.quickConnectError.style.display = 'none';
    }
    el.connectServerModal.classList.remove('hidden');
    setTimeout(() => {
      if (el.quickInputUsername && typeof el.quickInputUsername.focus === "function") el.quickInputUsername.focus();
    }, 150);
  }

  el.btnCloseConnectModal.addEventListener('click', () => el.connectServerModal.classList.add('hidden'));

  el.btnQuickConnectSubmit.addEventListener('click', (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const user = el.quickInputUsername.value.trim();
    let url = el.quickInputServerUrl.value.trim() || DEFAULT_SERVER_URL;

    if (url.startsWith('https://')) {
      url = url.replace('https://', 'wss://');
    } else if (url.startsWith('http://')) {
      url = url.replace('http://', 'ws://');
    } else if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      url = 'wss://' + url;
    }

    if (user) {
      state.username = user;
      localStorage.setItem('ps_username', user);
      el.inputUsername.value = user;
      updateLocalProfileUI();
    }

    state.serverUrl = url;
    localStorage.setItem('ps_server_url', url);
    localStorage.setItem('ps_configured', 'true');
    el.inputServerUrl.value = url;

    el.connectServerModal.classList.add('hidden');
    signaling.connect(url);
  });

  // -------------------------------------------------------------
  // Settings Modal Controls & Audio Processing (Feature 1 & Bug 5)
  // -------------------------------------------------------------
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
    audio.stopVoiceTest();
    el.settingsModal.classList.add('hidden');
  }

  function saveSettings() {
    const newUsername = el.inputUsername.value.trim();
    if (newUsername && newUsername !== state.username) {
      state.username = newUsername;
      localStorage.setItem('ps_username', state.username);
      updateLocalProfileUI();
      if (state.isConnectedToVoice && state.currentRoom) {
        signaling.joinRoom(state.currentRoom, state.peerId, state.username, state.avatar);
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
    el.localModeDisplay.textContent = mode === 'ptt' ? `PTT (${state.shortcuts.ptt})` : 'VAD Activo';

    syncShortcutsWithElectron();
    closeSettings();
  }

  // Audio Processing Toggles: each change re-opens the mic with the new settings
  // (Chromium ignores processing changes on a live track).
  const NOISE_MODE_LABELS = {
    rnnoise: 'IA activa (RNNoise)',
    browser: 'Básica (navegador)',
    off: 'Desactivada'
  };

  function updateNoiseSuppressionStatus(text) {
    const status = document.getElementById('noiseSuppressionStatus');
    if (status) status.textContent = text || NOISE_MODE_LABELS[audio.noiseSuppressionMode] || '—';
  }

  audio.on('ready', () => updateNoiseSuppressionStatus());

  async function applyAudioProcessing(settings) {
    const toggles = [el.toggleNoiseSuppression, el.toggleEchoCancellation, el.toggleAutoGain];
    toggles.forEach(t => { t.disabled = true; });
    updateNoiseSuppressionStatus('Aplicando...');
    try {
      await audio.setAudioProcessing(settings);
    } finally {
      toggles.forEach(t => { t.disabled = false; });
      updateNoiseSuppressionStatus();
    }
  }

  el.toggleNoiseSuppression.addEventListener('change', (e) => {
    applyAudioProcessing({ noiseSuppression: e.target.checked });
  });

  el.toggleEchoCancellation.addEventListener('change', (e) => {
    applyAudioProcessing({ echoCancellation: e.target.checked });
  });

  el.toggleAutoGain.addEventListener('change', (e) => {
    applyAudioProcessing({ autoGainControl: e.target.checked });
  });

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
    const savedDeviceId = localStorage.getItem('ps_audio_device');

    devices.inputs.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Micrófono (${d.deviceId.slice(0, 6)})`;
      if (d.deviceId === savedDeviceId) {
        opt.selected = true;
      }
      el.selectAudioInput.appendChild(opt);
    });
  }

  // Voice test ("Probar Voz"): hear your own mic with the current processing settings
  function updateVoiceTestUI(isTesting) {
    if (!el.btnVoiceTest) return;
    el.btnVoiceTestText.textContent = isTesting ? 'Detener Prueba' : 'Probar Voz (Escucharme)';
    el.btnVoiceTest.classList.toggle('btn-danger', isTesting);
    el.btnVoiceTest.classList.toggle('btn-secondary', !isTesting);
    el.voiceTestStatusText.textContent = isTesting ? 'Escuchándote...' : 'Inactivo';
    el.voiceTestStatusText.classList.toggle('active', isTesting);
  }

  audio.on('voice-test-change', updateVoiceTestUI);

  if (el.btnVoiceTest) {
    el.btnVoiceTest.addEventListener('click', () => {
      audio.toggleVoiceTest();
      if (!audio.isVoiceTesting && !audio.audioTrack) {
        el.voiceTestStatusText.textContent = 'Micrófono no disponible';
        el.voiceTestStatusText.classList.remove('active');
      }
    });
  }

  // Bug 5: Persist audio device selection
  el.selectAudioInput.addEventListener('change', async (e) => {
    const devId = e.target.value;
    localStorage.setItem('ps_audio_device', devId);
    await audio.init(devId || null);
  });

  el.btnReconnectServer.addEventListener('click', () => {
    state.serverUrl = el.inputServerUrl.value.trim();
    localStorage.setItem('ps_server_url', state.serverUrl);
    signaling.connect(state.serverUrl);
  });

  // -------------------------------------------------------------
  // Shortcuts & Key Recorder
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
    // If recording a shortcut in settings
    if (state.recordingAction) {
      e.preventDefault();
      e.stopPropagation();

      const parts = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.shiftKey) parts.push('Shift');
      if (e.altKey) parts.push('Alt');

      let keyName = e.key;
      if (['Control', 'Shift', 'Alt'].includes(keyName)) return;

      if (keyName === ' ') keyName = 'Space';
      else if (keyName.length === 1) keyName = keyName.toUpperCase();

      parts.push(keyName);
      const accelerator = parts.join('+');

      state.shortcuts[state.recordingAction] = accelerator;
      localStorage.setItem('ps_shortcuts', JSON.stringify(state.shortcuts));
      stopShortcutRecording();
      syncShortcutsWithElectron();
      return;
    }

    // In-app PTT key listener
    if (audio.inputMode === 'ptt' && state.shortcuts.ptt) {
      if (matchesAccelerator(e, state.shortcuts.ptt)) {
        audio.pttKeyDown();
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    if (audio.inputMode === 'ptt' && state.shortcuts.ptt) {
      if (matchesAccelerator(e, state.shortcuts.ptt)) {
        audio.pttKeyUp();
      }
    }
  });

  function matchesAccelerator(event, accelerator) {
    const parts = accelerator.split('+');
    const key = parts[parts.length - 1];
    const hasCtrl = parts.includes('Ctrl');
    const hasShift = parts.includes('Shift');
    const hasAlt = parts.includes('Alt');

    if (event.ctrlKey !== hasCtrl) return false;
    if (event.shiftKey !== hasShift) return false;
    if (event.altKey !== hasAlt) return false;

    return event.key.toUpperCase() === key.toUpperCase() || event.code.toUpperCase() === key.toUpperCase();
  }

  function syncShortcutsWithElectron() {
    if (window.electronAPI && window.electronAPI.updateShortcuts) {
      window.electronAPI.updateShortcuts(state.shortcuts);
    }
  }

  // Electron IPC Listeners
  if (window.electronAPI) {
    if (window.electronAPI.onShortcut) {
      window.electronAPI.onShortcut((action) => {
        switch (action) {
          case 'toggleMute':
            audio.toggleMute();
            break;
          case 'toggleDeafen':
            audio.toggleDeafen();
            break;
          case 'toggleScreen':
            handleScreenShareButton();
            break;
          case 'pttDown':
            audio.pttKeyDown();
            break;
          case 'pttUp':
            audio.pttKeyUp();
            break;
        }
      });
    }

    el.btnMinimize.addEventListener('click', () => window.electronAPI.minimize());
    el.btnMaximize.addEventListener('click', () => window.electronAPI.maximize());
    el.btnClose.addEventListener('click', () => window.electronAPI.close());
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
