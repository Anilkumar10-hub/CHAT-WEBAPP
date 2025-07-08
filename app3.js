// === DOM Elements ===
const authContainer = document.getElementById('auth-container');
const registerForm = document.getElementById('register-form');
const loginForm = document.getElementById('login-form');
const registerResult = document.getElementById('register-result');
const loginResult = document.getElementById('login-result');
const chatContainer = document.querySelector('.chat-container');
const currentUserDiv = document.getElementById('current-user');
const userList = document.getElementById('user-list');
const messages = document.getElementById('messages');
const chatUsername = document.getElementById('chat-username');
const startCallBtn = document.getElementById('startCallBtn');
const hangupBtn = document.getElementById('hangupBtn');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

// === CONFIGURATION ===
const NGROK_URL = 'https://60dfc6fe364f.ngrok-free.app';

let currentUser = null;
let socket = null;
let selectedUser = null;
let peerConnection = null;
let localStream = null;
const privateMessages = {};
const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

async function checkSession() {
  const res = await fetch(`${NGROK_URL}/profile`, {
    credentials: 'include'  // Important to send cookies/session info
  });
  if (res.ok) {
    const data = await res.json();
    if (data.user && data.user.username) {
      currentUser = data.user.username;
      showChatUI();
    }
  }
}

// Call checkSession immediately on page load
checkSession();


// Hide chat until logged in
chatContainer.style.display = 'none';
hangupBtn.style.display = 'none';

// === AUTH HANDLERS ===
registerForm.onsubmit = async (e) => {
  e.preventDefault();
  const username = registerForm['reg-username'].value;
  const password = registerForm['reg-password'].value;
  const res = await fetch(`${NGROK_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
    credentials: 'include'
  });
  const data = await res.json();
  registerResult.innerText = data.message || data.error;
};

loginForm.onsubmit = async (e) => {
  e.preventDefault();
  const username = loginForm['login-username'].value;
  const password = loginForm['login-password'].value;
  const res = await fetch(`${NGROK_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
    credentials: 'include'
  });
  const data = await res.json();
  loginResult.innerText = data.message || data.error;
  if (res.ok) {
    currentUser = username;
    showChatUI();
  }
};

function showChatUI() {
  authContainer.style.display = 'none';
  chatContainer.style.display = '';
  currentUserDiv.innerHTML = `Logged in as <b>${currentUser}</b> <button id="logout-btn">Logout</button>`;
  document.getElementById('logout-btn').onclick = async () => {
    await fetch(`${NGROK_URL}/logout`, { method: 'POST',credentials: 'include' });
    location.reload();
  };
  initSocket();
}

// === CHAT HANDLERS ===
function addMessage(msg, options = {}) {
  const li = document.createElement('li');
  li.textContent = msg;
  li.className = options.sent ? 'sent-message' : 'received-message';
  messages.appendChild(li);
  messages.scrollTop = messages.scrollHeight;
}

function displayPrivateChat(username) {
  messages.innerHTML = '';
  (privateMessages[username] || []).forEach(msgObj => {
    const sent = msgObj.from === currentUser;
    addMessage(msgObj.text, { sent });
  });
}

function updateInputPlaceholder() {
  const input = document.getElementById('message-input');
  if (selectedUser) {
    input.placeholder = `Message ${selectedUser} privately...`;
    startCallBtn.style.display = 'inline-block';
  } else {
    input.placeholder = "Type a public message...";
    startCallBtn.style.display = 'none';
  }
}

// === CALL HANDLING ===
function showIncomingCallModal(caller) {
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.7); display: flex; justify-content: center;
    align-items: center; z-index: 1000;
  `;
  
  modal.innerHTML = `
    <div style="background: white; padding: 20px; border-radius: 8px; text-align: center;">
      <h3>Incoming call from ${caller}</h3>
      <div style="display: flex; gap: 10px; margin-top: 20px;">
        <button id="accept-call" style="padding: 10px 20px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer;">
          Accept
        </button>
        <button id="reject-call" style="padding: 10px 20px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;">
          Reject
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById('accept-call').onclick = async () => {
    modal.remove();
    await handleCallAccepted(caller);
  };

  document.getElementById('reject-call').onclick = () => {
    modal.remove();
    socket.emit('call_rejected', { to: caller, from: currentUser });
  };
}

async function handleCallAccepted(caller) {
  await getMedia();
  createPeerConnection();
  
  // Set the selected user to the caller
  selectedUser = caller;
  chatUsername.textContent = caller;
  updateInputPlaceholder();
  
  // Create answer
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  
  // Send answer to caller
  socket.emit('call_accepted', { 
    to: caller, 
    from: currentUser,
    offer: peerConnection.localDescription 
  });
}

// === WEBRTC FUNCTIONS ===
async function getMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ 
      video: true, 
      audio: true 
    });
    localVideo.srcObject = localStream;
  } catch (err) {
    console.error('Error accessing media devices:', err);
  }
}

function createPeerConnection() {
  peerConnection = new RTCPeerConnection(config);

  // Add local tracks to connection
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  // Handle remote stream
  peerConnection.ontrack = event => {
    remoteVideo.srcObject = event.streams[0];
    hangupBtn.style.display = 'inline-block';
  };

  // ICE candidates
  peerConnection.onicecandidate = event => {
    if (event.candidate) {
      socket.emit('signal', { 
        to: selectedUser, 
        from: currentUser,
        type: 'candidate', 
        candidate: event.candidate 
      });
    }
  };
}

async function startCall() {
  if (!selectedUser) return;
  
  await getMedia();
  createPeerConnection();
  
  // Create offer
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  
  // Send call request
  socket.emit('call_request', { 
    to: selectedUser, 
    from: currentUser,
    offer: peerConnection.localDescription
  });
}

function hangUp() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  hangupBtn.style.display = 'none';
  
  if (selectedUser) {
    socket.emit('call_ended', { to: selectedUser, from: currentUser });
  }
}

// === SOCKET.IO HANDLER ===
function initSocket() {
  socket = io(NGROK_URL, {transports: ['websocket']});
  console.log('Registering user:', currentUser);
  socket.emit('register', currentUser);

  // Online users list
  socket.on('user list', (usernames) => {
    console.log('Received user list:', usernames);
    userList.innerHTML = '';
    usernames.forEach(name => {
      if (name === currentUser) return;
      const li = document.createElement('li');
      li.textContent = name;
      li.style.cursor = 'pointer';
      li.onclick = () => {
        selectedUser = name;
        chatUsername.textContent = name;
        displayPrivateChat(name);
        updateInputPlaceholder();
      };
      userList.appendChild(li);
    });
  });

  // Public chat messages
  socket.on('Chat message', (msgObj) => {
    const sent = msgObj.user === currentUser;
    addMessage(`${msgObj.user}: ${msgObj.text}`, { sent });
  });

  // Incoming private messages
  socket.on('private message', (msgObj) => {
    const from = msgObj.from;
    privateMessages[from] = privateMessages[from] || [];
    privateMessages[from].push(msgObj);
    if (selectedUser === from) displayPrivateChat(from);
  });

  // Incoming call notification
  socket.on('incoming_call', (data) => {
    const { from } = data;
    showIncomingCallModal(from);
  });

  // Call accepted
  socket.on('call_accepted', async (data) => {
    const { from, offer } = data;
    selectedUser = from;
    chatUsername.textContent = from;
    updateInputPlaceholder();
    
    if (!peerConnection) {
      await getMedia();
      createPeerConnection();
    }
    
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    socket.emit('signal', {
      to: from,
      from: currentUser,
      type: 'answer',
      answer: peerConnection.localDescription
    });
  });

  // Call rejected
  socket.on('call_rejected', (data) => {
    const { from } = data;
    alert(`${from} rejected your call`);
    hangUp();
  });

  // WebRTC signaling
  socket.on('signal', async (data) => {
    if (!peerConnection) return;
    
    if (data.type === 'offer') {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      
      socket.emit('signal', {
        to: data.from,
        from: currentUser,
        type: 'answer',
        answer: peerConnection.localDescription
      });
    } 
    else if (data.type === 'answer') {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    } 
    else if (data.type === 'candidate') {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
    else if (data.type === 'end') {
      hangUp();
    }
  });

  // Call ended
  socket.on('call_ended', () => {
    hangUp();
  });

  // SINGLE MESSAGE FORM HANDLER
  document.getElementById('message-form').onsubmit = (e) => {
    e.preventDefault();
    const input = document.getElementById('message-input');
    const msg = input.value.trim();
    if (!msg) return;

    if (selectedUser) {
      const msgObj = {
        from: currentUser,
        to: selectedUser,
        text: msg,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      socket.emit('private message', msgObj);
      privateMessages[selectedUser] = privateMessages[selectedUser] || [];
      privateMessages[selectedUser].push(msgObj);
      displayPrivateChat(selectedUser);
    } else {
      socket.emit('Chat message', { user: currentUser, text: msg });
    }
    input.value = '';
  };
  
  // Call button handlers
  startCallBtn.onclick = startCall;
  hangupBtn.onclick = hangUp;
}
