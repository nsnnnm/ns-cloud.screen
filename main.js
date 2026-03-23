const signalingUrl = window.SIGNALING_URL;

const roomInput = document.getElementById("roomId");
const hostBtn = document.getElementById("hostBtn");
const joinBtn = document.getElementById("joinBtn");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const chatLog = document.getElementById("chatLog");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");

let pc;
let dataChannel;
let isHost = false;
let polling = false;

const iceServers = [
  { urls: "stun:stun.l.google.com:19302" },
];

function logChat(who, text) {
  const div = document.createElement("div");
  div.className = `chat-message ${who}`;
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

sendBtn.onclick = () => {
  const msg = chatInput.value.trim();
  if (!msg || !dataChannel || dataChannel.readyState !== "open") return;
  dataChannel.send(msg);
  logChat("me", msg);
  chatInput.value = "";
};

function createPeerConnection() {
  pc = new RTCPeerConnection({ iceServers });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendToSignaling({
        type: "ice",
        candidate: event.candidate,
      });
    }
  };

  pc.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  pc.ondatachannel = (event) => {
    dataChannel = event.channel;
    setupDataChannel();
  };
}

function setupDataChannel() {
  dataChannel.onopen = () => logChat("system", "チャット接続しました");
  dataChannel.onmessage = (e) => logChat("remote", e.data);
}

async function startHost() {
  isHost = true;
  createPeerConnection();

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: false,
  });
  localVideo.srcObject = stream;
  stream.getTracks().forEach((track) => pc.addTrack(track, stream));

  dataChannel = pc.createDataChannel("chat");
  setupDataChannel();

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  await sendToSignaling({
    type: "offer",
    sdp: offer.sdp,
  });

  startPolling();
}

async function startJoin() {
  isHost = false;
  createPeerConnection();

  const stream = await navigator.mediaDevices.getUserMedia({
    video: false,
    audio: false,
  });
  localVideo.srcObject = stream;

  await sendToSignaling({ type: "join" });

  startPolling();
}

async function sendToSignaling(payload) {
  const roomId = roomInput.value.trim();
  await fetch(signalingUrl + "/signal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roomId,
      role: isHost ? "host" : "guest",
      ...payload,
    }),
  });
}

async function pollSignaling() {
  if (polling) return;
  polling = true;

  const roomId = roomInput.value.trim();

  while (true) {
    try {
      const res = await fetch(
        signalingUrl + `/poll?roomId=${roomId}&role=${isHost ? "host" : "guest"}`
      );
      const messages = await res.json();

      for (const msg of messages) {
        await handleSignalingMessage(msg);
      }
    } catch (e) {
      console.error("poll error", e);
    }

    await new Promise((r) => setTimeout(r, 500));
  }
}

function startPolling() {
  pollSignaling();
}

async function handleSignalingMessage(msg) {
  if (msg.type === "offer" && !isHost) {
    await pc.setRemoteDescription(
      new RTCSessionDescription({ type: "offer", sdp: msg.sdp })
    );
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await sendToSignaling({
      type: "answer",
      sdp: answer.sdp,
    });
  } else if (msg.type === "answer" && isHost) {
    await pc.setRemoteDescription(
      new RTCSessionDescription({ type: "answer", sdp: msg.sdp })
    );
  } else if (msg.type === "ice") {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
    } catch (e) {
      console.error("Failed to add ICE", e);
    }
  }
}

hostBtn.onclick = () => startHost();
joinBtn.onclick = () => startJoin();
