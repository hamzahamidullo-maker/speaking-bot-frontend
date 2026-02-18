const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

const API_BASE = "https://speaking-backend-production.up.railway.app";

let selectedGender = null;
let selectedLevel = null;
let sessionId = null;
let mediaRecorder = null;
let isRecording = false;
let audioChunks = [];
let isProcessing = false;
let timerInterval = null;
let secondsElapsed = 0;
let currentAudio = null;

const userId = tg.initDataUnsafe?.user?.id?.toString() || "test_user";

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function selectGender(gender) {
  selectedGender = gender;
  document.getElementById("avatarEmoji").textContent = gender === "female" ? "👩" : "👨";
  // highlight selected
  document.querySelectorAll(".gender-btn").forEach(b => b.style.opacity = "0.5");
  document.querySelector(`.gender-btn.${gender}`).style.opacity = "1";
  document.querySelector(`.gender-btn.${gender}`).style.borderColor = gender === "male" ? "#6366f1" : "#ec4899";
}

async function selectLevel(level) {
  if (!selectedGender) {
    selectedGender = "male";
    document.getElementById("avatarEmoji").textContent = "👨";
  }
  selectedLevel = level;

  const colors = { beginner: "#34d399", intermediate: "#818cf8", advanced: "#f472b6" };
  const tag = document.getElementById("callLevelTag");
  tag.textContent = level.charAt(0).toUpperCase() + level.slice(1);
  tag.style.color = colors[level];
  tag.style.borderColor = colors[level];

  showScreen("callScreen");
  startTimer();
  setAiStatus("Connecting...");

  try {
    const res = await fetch(`${API_BASE}/session/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, level, gender: selectedGender })
    });
    const data = await res.json();
    sessionId = data.session_id;
    showLastMsg(data.message);
    setAiStatus("Listening...");
    if (data.audio_hex) playAudioHex(data.audio_hex);
  } catch (err) {
    showLastMsg("Hello! I am your speaking partner. Let us practice English together!");
    setAiStatus("Listening...");
  }
}

function startTimer() {
  secondsElapsed = 0;
  timerInterval = setInterval(() => {
    secondsElapsed++;
    const m = Math.floor(secondsElapsed / 60);
    const s = secondsElapsed % 60;
    document.getElementById("callDuration").textContent = `${m}:${s.toString().padStart(2, "0")}`;
  }, 1000);
}

async function toggleRecording() {
  if (isProcessing) return;
  if (isRecording) stopRecording();
  else await startRecording();
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = sendVoiceMessage;
    mediaRecorder.start();
    isRecording = true;
    document.getElementById("btnMic").classList.add("recording");
    document.getElementById("btnMic").textContent = "⏹️";
    document.getElementById("micPulse").classList.add("recording");
    setAiStatus("Recording...");
  } catch (err) {
    alert("Microphone access denied!");
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
  }
  isRecording = false;
  document.getElementById("btnMic").classList.remove("recording");
  document.getElementById("btnMic").textContent = "🎤";
  document.getElementById("micPulse").classList.remove("recording");
  setAiStatus("Processing...");
}

async function sendVoiceMessage() {
  if (audioChunks.length === 0) return;
  const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
  await sendAudio(audioBlob);
}

async function sendAudio(audioBlob) {
  if (!sessionId || isProcessing) return;
  isProcessing = true;
  document.getElementById("btnMic").disabled = true;

  const formData = new FormData();
  formData.append("session_id", sessionId);
  formData.append("audio", audioBlob, "audio.webm");

  try {
    const res = await fetch(`${API_BASE}/session/voice`, { method: "POST", body: formData });
    const data = await res.json();

    if (data.user_text) showLastMsg(`You: ${data.user_text}`, true);

    setTimeout(() => {
      if (data.ai_response) {
        const { mainText, feedbackText } = parseResponse(data.ai_response);
        showLastMsg(mainText);
        if (feedbackText) showFeedback(feedbackText);
      }
      if (data.audio_hex) playAudioHex(data.audio_hex);
      if (data.stats) updateStats(data.stats);
    }, 300);

  } catch (err) {
    showLastMsg("Sorry, could not process. Try again.");
  } finally {
    isProcessing = false;
    document.getElementById("btnMic").disabled = false;
    setAiStatus("Listening...");
  }
}

async function sendTextMessage() {
  const input = document.getElementById("textInput");
  const text = input.value.trim();
  if (!text || !sessionId || isProcessing) return;
  input.value = "";
  isProcessing = true;
  document.getElementById("btnMic").disabled = true;
  showLastMsg(`You: ${text}`, true);
  setAiStatus("Thinking...");

  try {
    const res = await fetch(`${API_BASE}/session/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, message: text })
    });
    const data = await res.json();
    const { mainText, feedbackText } = parseResponse(data.ai_response);
    showLastMsg(mainText);
    if (feedbackText) showFeedback(feedbackText);
    if (data.audio_hex) playAudioHex(data.audio_hex);
    if (data.stats) updateStats(data.stats);
  } catch (err) {
    showLastMsg("Sorry, something went wrong.");
  } finally {
    isProcessing = false;
    document.getElementById("btnMic").disabled = false;
    setAiStatus("Listening...");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("textInput").addEventListener("keydown", e => {
    if (e.key === "Enter") sendTextMessage();
  });
});

function toggleTextInput() {
  const row = document.getElementById("textRow");
  row.style.display = row.style.display === "none" ? "flex" : "none";
  if (row.style.display === "flex") document.getElementById("textInput").focus();
}

async function endSession() {
  clearInterval(timerInterval);
  document.getElementById("fstatExchanges").textContent = document.getElementById("statExchanges").textContent;
  document.getElementById("fstatWords").textContent = document.getElementById("statWords").textContent;
  document.getElementById("fstatScore").textContent = document.getElementById("statScore").textContent;
  document.getElementById("fstatDuration").textContent = document.getElementById("callDuration").textContent;
  showScreen("summaryScreen");

  if (!sessionId) return;
  try {
    const res = await fetch(`${API_BASE}/session/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId })
    });
    const data = await res.json();
    const card = document.getElementById("summaryContent");
    card.style.justifyContent = "flex-start";
    card.style.alignItems = "flex-start";
    card.textContent = data.summary;
  } catch (err) {
    document.getElementById("summaryContent").textContent = "Great session! Keep practicing!";
  }
  sessionId = null;
}

function restartApp() {
  selectedGender = null;
  selectedLevel = null;
  sessionId = null;
  secondsElapsed = 0;
  document.getElementById("summaryContent").innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
  document.getElementById("summaryContent").style.justifyContent = "center";
  document.getElementById("feedbackBox").style.display = "none";
  document.getElementById("callDuration").textContent = "0:00";
  document.querySelectorAll(".gender-btn").forEach(b => { b.style.opacity = "1"; b.style.borderColor = ""; });
  updateStats({ exchanges: 0, total_words: 0, avg_score: null });
  showScreen("setupScreen");
}

function showLastMsg(text, isUser = false) {
  const el = document.getElementById("lastMsg");
  el.style.color = isUser ? "#818cf8" : "#ccc";
  el.textContent = text;
}

function showFeedback(text) {
  const box = document.getElementById("feedbackBox");
  document.getElementById("feedbackText").textContent = text;
  box.style.display = "block";
  setTimeout(() => { box.style.display = "none"; }, 8000);
}

function setAiStatus(status) {
  document.getElementById("aiStatus").textContent = status;
}

function updateStats(stats) {
  if (stats.exchanges !== undefined)
    document.getElementById("statExchanges").textContent = stats.exchanges;
  if (stats.total_words !== undefined)
    document.getElementById("statWords").textContent = stats.total_words;
  if (stats.avg_score !== null && stats.avg_score !== undefined)
    document.getElementById("statScore").textContent = stats.avg_score + "/10";
}

function parseResponse(text) {
  if (text.includes("FEEDBACK_START")) {
    const parts = text.split("FEEDBACK_START");
    const mainText = parts[0].trim();
    const feedbackText = (parts[1] || "").replace("FEEDBACK_END", "").trim();
    return { mainText, feedbackText };
  }
  return { mainText: text, feedbackText: null };
}

function playAudioHex(hex) {
  try {
    const bytes = new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
    const blob = new Blob([bytes], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    if (currentAudio) { currentAudio.pause(); URL.revokeObjectURL(currentAudio.src); }
    currentAudio = new Audio(url);
    currentAudio.play().catch(() => {});
    setAiStatus("Speaking...");
    document.getElementById("avatarRings").classList.add("speaking");
    currentAudio.onended = () => {
      setAiStatus("Listening...");
      document.getElementById("avatarRings").classList.remove("speaking");
      URL.revokeObjectURL(url);
    };
  } catch (err) {
    console.error("Audio error:", err);
  }
}
