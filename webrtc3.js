const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
let localStream;
let peerConnection;

async function getMedia() {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;
}

// Place the following code after getMedia()
const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

function createPeerConnection() {
  peerConnection = new RTCPeerConnection(config);

  // Add local tracks to connection
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

  // Handle remote stream
  peerConnection.ontrack = event => {
    remoteVideo.srcObject = event.streams[0];
  };

  // ICE candidates
  peerConnection.onicecandidate = event => {
    if (event.candidate) {
      socket.emit('signal', { type: 'candidate', candidate: event.candidate, to: targetUser });
    }
  };
}
// When user clicks "Start Call"
document.getElementById('startCallBtn').onclick = async () => {
  await getMedia();
  createPeerConnection();

  // Create offer
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  // Send offer to other user
  socket.emit('signal', { type: 'offer', offer, to: targetUser });
};

// Listen for signaling messages
socket.on('signal', async (data) => {
  if (data.type === 'offer') {
    await getMedia();
    createPeerConnection();
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('signal', { type: 'answer', answer, to: data.from });
  } else if (data.type === 'answer') {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
  } else if (data.type === 'candidate') {
    await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
  }
});
document.getElementById('hangupBtn').onclick = () => {
  peerConnection.close();
  peerConnection = null;
  remoteVideo.srcObject = null;
  socket.emit('signal', { type: 'end', to: targetUser });
};
