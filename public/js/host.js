let ws;
let clientId = null;
const peerConnections = {};
let localStream;
let isCallInProgress = false;
let allParticipants = []; 

const iceServers = [];

let roomCode = null;

const BITRATE_LEVELS = {
    HIGH: 192000,   // 192 kbps 
    MEDIUM: 96000, 
    LOW: 48000,     
};
const ADAPTATION_INTERVAL_MS = 5000; // check network every 5 seconds

//html references
const localAudio = document.getElementById('localAudio');

const startBtn = document.getElementById('startBtn');
const endBtn = document.getElementById('endBtn');
const exitBtn = document.getElementById('exitBtn');

//initialization and creation of websocket connection
const init = () => {
    ws = new WebSocket("ws://localhost:8080");
    ws.onopen = () => {
        console.log("Websocket connected");
    };

    ws.onmessage = handleSignalingMessage;

    ws.onclose = () => {
        // Closing the connection
        console.log('WebSocket disconnected.');
        endCall();
    };

    ws.onerror = (err) => {
        // Error occured
        console.error('WebSocket error:', err);
        endCall();
    };

    startBtn.addEventListener('click', async () => {
        // Only allow the button to be clicked once
        if (isCallInProgress) {
            console.log("Call is already in progress.");
            return;
        }

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'start-call',
                code: roomCode,
                role: 'host'
            })); // start call mesg to signalling server
        }

        // Disable the start button and enable the end button
        startBtn.disabled = true;
        endBtn.disabled = false;
        isCallInProgress = true;

        // Acquire media
        try {
            const audioConstraints = {
                autoGainControl: false,
                echoCancellation: false,
                noiseSuppression: false
            };

            localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: audioConstraints });
            // stopping the video track
            localStream.getVideoTracks().forEach(track => track.stop());
            console.log("Master has acquired local audio stream.");
            localAudio.srcObject = localStream;
            console.log("Sending offers to all existing clients:", allParticipants);
        for (const participant of allParticipants) {
            if (participant.id !== clientId) {
                await createAndSendOffer(participant.id);
            }
        }
        endBtn.disabled = false; // Enable end button only after successful setup

    } catch (error) {
        console.error("Master failed to acquire media:", error);
        endCall();
        return;
    }
});

    endBtn.addEventListener('click', () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'end-call',
                code: roomCode,
                role: 'host'
            })); // end call mesg to signalling server
        }
        endCall();
    });
}

// add near the top (after existing const/let declarations)
const localDisplayName = new URLSearchParams(window.location.search).get('username') || 'anonymous';

function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function appendChat(sender, text, ts) {
  // debug
  console.log('CHAT recv:', { sender, text, ts });

  // handle when args were swapped or text is a timestamp
  if ((typeof text === 'number' || /^\d{10,}$/.test(String(text))) && !ts) {
    ts = Number(text);
    text = '';
  }

  if (typeof text === 'object') text = JSON.stringify(text);

  const msgs = document.getElementById('chatMessages');
  if (!msgs) return;
  const el = document.createElement('div');
  el.style.marginBottom = '6px';
  const timeStr = ts ? ` <span style="color:#666;font-size:11px">${new Date(Number(ts)).toLocaleTimeString()}</span>` : '';
  el.innerHTML = `<strong>${escapeHtml(sender || 'anon')}</strong>${timeStr}: ${escapeHtml(text || '')}`;
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
}
const chatForm = document.getElementById('chatForm');
if (chatForm) {
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('chatInput');
    const text = input && input.value && input.value.trim();
    if (!text) return;
    const payload = { type: 'chat', sender: localDisplayName, text };
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    } else {
      console.warn('WebSocket not open; chat not sent');
    }
    appendChat('You', text, Date.now());
    input.value = '';
  });
}

async function handleSignalingMessage(event) {
    const data = JSON.parse(event.data);
    switch (data.type) {
        case 'init': {
            clientId = data.clientId;
            console.log(`My Host ID is: ${clientId}`);
            window.currentClientId = window.currentClientId || clientId;
            // The roomCode is searched on load
            const urlParams = new URLSearchParams(window.location.search);
            const roomCode = urlParams.get('code');
            const username = urlParams.get('username');
            ws.send(JSON.stringify({ type: 'joinroom', code: roomCode, from: clientId, username: username }));
            break;
        }

        case 'room_created': {
            // server returned a new room code
            roomCode = data.code;
            console.log(`Room created: ${roomCode}`);
            // auto-join the room as host (so server will add this ws to participants)
            const urlParams = new URLSearchParams(window.location.search);
            const username = urlParams.get('username') || 'host';
            ws.send(JSON.stringify({ type: 'joinroom', code: roomCode, from: clientId, username: username }));
            // optionally show roomCode in UI if you have a display function
            if (typeof window.showRoomCode === 'function') window.showRoomCode(roomCode);
            break;
        }

        case 'join_success': { 
            console.log(`Successfully joined room ${data.code}.`);
            allParticipants = data.participants;
            if (typeof window.updateParticipantList === 'function') {
                window.updateParticipantList(allParticipants);
            }
            const participantNames = allParticipants.map(p => p.username);
            console.log('Participants in room:', participantNames);
            break;
        }
        
        case 'user-joined': {
            const newParticipant = data.newParticipant;
            if (!newParticipant) break;
            console.log(`New user ${newParticipant.username} (${newParticipant.id}) joined.`);
            allParticipants.push(newParticipant);
            if (typeof window.updateParticipantList === 'function') {
                window.updateParticipantList(allParticipants);
            }
            if (localStream) {
                await createAndSendOffer(newParticipant.id);
            }
            break;
        }
        case 'client-left': {
            const leavingParticipant = data.participant;
            if (!leavingParticipant) break;
            const leftClientId = leavingParticipant.id;
            console.log(`Client ${leavingParticipant.username} (${leftClientId}) left.`);
            allParticipants = allParticipants.filter(p => p.id !== leftClientId);
            if (typeof window.updateParticipantList === 'function') {
                window.updateParticipantList(allParticipants);
            }
            if (peerConnections[leftClientId]) {
                peerConnections[leftClientId].close();
                delete peerConnections[leftClientId];
                console.log(`Closed connection to ${leftClientId}`);
            }
            break;
        }

        case 'answer': {
            const answererId = data.from;
            const peer = peerConnections[answererId]; // get the whole peer object
            if (!peer || !peer.pc) {
                console.error("Answer received but peerConnection not initialized for:", answererId);
                return;
            }
            await peer.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            console.log(`Received answer from ${answererId}. Call established.`);

            // check network conection quality for this peer
            if (peer && !peer.monitorInterval) {
                peer.monitorInterval = setInterval(() => {
                    monitorAndAdaptBitrate(answererId);
                }, ADAPTATION_INTERVAL_MS);
                console.log(`network quality monitoring for ${answererId}.`);
            }
            break;
        }

        case 'ice-candidate': {
            const peerId = data.from;
            const pc = peerConnections[peerId]?.pc; 
            if (pc && data.candidate) {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                } catch (e) {
                    console.warn('ICE candidate error:', e);
                }
            } else {
                console.warn(`ICE candidate received for unknown peer ${peerId} or no candidate data.`);
            }
            break;
        }

        case 'chat': {
            appendChat(data.sender || 'anon', data.text || '', data.ts);
            break;
        }

        case 'end-call':
            endCall();
            break;
    }
}

async function createAndSendOffer(targetClientId) { 
    if (peerConnections[targetClientId]) {
        console.warn(`Connection to ${targetClientId} already exists.`);
        return;
    }
    console.log(`Initiating connection to ${targetClientId}`);
    const pc = await createPeerConnection(targetClientId); 
    
    peerConnections[targetClientId] = {
        pc: pc,
        audioSender: null,
        currentBitrate: 'HIGH', // start at the highest quality
        monitorInterval: null
    };

    if (localStream) { 
        const audioTracks = localStream.getAudioTracks();
        if (audioTracks.length > 0) {
            const audioSender = pc.addTrack(audioTracks[0], localStream);
            // store the audio sender for later adjustments
            peerConnections[targetClientId].audioSender = audioSender;
            console.log("Added audio track for high-quality streaming.");

            //Optimizing for audio to be sent at higher bitrate
            const audioParameters = audioSender.getParameters();
            if (!audioParameters.encodings) {
                audioParameters.encodings = [{}];
            }
            // set initial bitrate from our levels
            audioParameters.encodings[0].maxBitrate = BITRATE_LEVELS.HIGH;
            audioParameters.encodings[0].priority = 'high';
            try {
                await audioSender.setParameters(audioParameters);
                console.log('Audio sender parameters set to high bitrate.');
            } catch (e) {
                console.warn('Failed to set audio sender parameters:', e);
            }

            // Audio formating for higher audio quality
            const audioTransceiver = pc.getTransceivers().find(t => t.sender === audioSender);
            if (audioTransceiver) {
                try {
                    const capabilities = RTCRtpSender.getCapabilities('audio');
                    const opusCodec = capabilities.codecs.find(c => c.mimeType === 'audio/opus');
                    if (opusCodec) {
                        audioTransceiver.setCodecPreferences([opusCodec]);
                        console.log('Opus codec prioritizing audio transceiver.');
                    } else {
                        console.warn('Opus codec not found');
                    }
                } catch (e) {
                    console.error('Failed audio codec :', e);
                }
            }
        }
    } else {
        console.error("Master's local stream is not available to send offer.");
        return;
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    ws.send(JSON.stringify({
        type: 'offer',
        to: targetClientId,
        sdp: pc.localDescription,
        from: clientId
    }));
    console.log(`Offer sent to ${targetClientId}`);
}

async function createPeerConnection(peerId) {

    const sessionIceServers = [...iceServers];
    try {
        const response = await fetch("/api/get-turn-credentials");
        if (response.ok) {
            const turnServers = await response.json();
            if (Array.isArray(turnServers) && turnServers.length > 0) {
                sessionIceServers.push(...turnServers); // Add fetched TURN to the session array
                console.log("Fetched TURN credentials and added to iceServers.");
            } else {
                console.warn("No TURN credentials fetched, proceeding with just STUN servers.");
            }
        } else {
            console.warn(`Failed to fetch TURN credentials: ${response.status} ${response.statusText}`);
        }
    } catch (e) {
        console.error("Error fetching TURN credentials:", e);
    }

    const pc = new RTCPeerConnection({ iceServers: sessionIceServers });
    console.log('PeerConnection initialized.');

    pc.onconnectionstatechange = () => {
        console.log(`Peer Connection State for ${peerId}:`, pc.connectionState);
    }; // simplified

    pc.onicecandidate = event => {
        if (event.candidate) {
            ws.send(JSON.stringify({
                type: 'ice-candidate',
                to: peerId,
                from: clientId,
                candidate: event.candidate
            }));
        }
    };

    return pc;
}

// set a new bitrate for a specific peer
async function setBitrateForPeer(peerId, newLevel) {
    const peer = peerConnections[peerId];
    if (!peer || !peer.audioSender || peer.currentBitrate === newLevel) {
        return; // no change needed/sender not ready
    }

    console.log(`adapting bitrate for ${peerId} from ${peer.currentBitrate} to ${newLevel}`);
    const params = peer.audioSender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
    }
    params.encodings[0].maxBitrate = BITRATE_LEVELS[newLevel];

    try {
        await peer.audioSender.setParameters(params);
        peer.currentBitrate = newLevel; 
        console.log(`successfully set bitrate for ${peerId} to ${newLevel} (${BITRATE_LEVELS[newLevel]} bps)`);
    } catch (e) {
        console.error(`failed to set bitrate for ${peerId}:`, e);
    }
}

// monitoring and adapting the bitrate
async function monitorAndAdaptBitrate(peerId) {
    const peer = peerConnections[peerId];
    if (!peer || !peer.pc || !peer.audioSender) {
        return;
    }

    const stats = await peer.pc.getStats();
    let packetLoss = 0;
    let rtt = 0;

    stats.forEach(report => {
        if (report.type === 'remote-inbound-rtp' && report.kind === 'audio') {
            // fractionLost: value b/w 0 and 1 representing packet loss 
            packetLoss = report.fractionLost;
            rtt = report.roundTripTime;
            console.log(`[stats for ${peerId}] Packet Loss: ${(packetLoss * 100).toFixed(2)}%, RTT: ${(rtt * 1000).toFixed(0)}ms`);
        }
    });

    if (packetLoss > 0.15 || rtt > 0.4) { // 15% packet loss or 400ms RTT, vansh change it if u want to
        if (peer.currentBitrate === 'HIGH') {
            setBitrateForPeer(peerId, 'MEDIUM');
        } else if (peer.currentBitrate === 'MEDIUM') {
            setBitrateForPeer(peerId, 'LOW');
        }
        return; 
    }

    // if network is excellent, try to go up a level
    if (packetLoss < 0.1 && rtt < 0.25) { 
        if (peer.currentBitrate === 'LOW') {
            setBitrateForPeer(peerId, 'MEDIUM');
        } else if (peer.currentBitrate === 'MEDIUM') {
            setBitrateForPeer(peerId, 'HIGH');
        }
    }
}

function endCall() {
    if (!isCallInProgress) {
        return;
    }

    console.log("ending call");
    isCallInProgress = false;

    // loop and clear intervals before closing connections
    for (const id in peerConnections) {
        const peer = peerConnections[id];
        if (peer.monitorInterval) {
            clearInterval(peer.monitorInterval);
        }
        if (peer.pc) {
            peer.pc.close();
        }
        delete peerConnections[id];
    }
    
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (localAudio) localAudio.srcObject = null;
    
    startBtn.disabled = false;
    endBtn.disabled = true;
    allClientIds = []; // Also reset the client list
    console.log("Call ended and resources cleaned up.");
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init);
} else {
  init();
}