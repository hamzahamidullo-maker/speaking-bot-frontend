const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// Config — change this to your backend URL
const API_BASE = "https://speaking-bot-frontend.vercel.app/";

// State
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

// ---- NAVIGATION ----
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function goBack(screenId) {
  showScreen(screenId);
}

// ---- GENDER SELECTION ----
function selectGender(gender) {
  selectedGender = gender;
  const avatar = document.getElementById("callAvatar");
  avatar.textContent = gender === "female" ? "👩" : "👨";
  showScreen("levelScreen");
}

// ---- LEVEL SELECTION ----
async function selectLevel(level) {
  selectedLevel = level;

  // Update UI
  const badge = document.getElementById("callLevelBadge");
  const colors = { beginner: "#6af7c8", intermediate: "#7c6af7", advanced: "#f76a8a" };
  badge.textContent = level.charAt(0).toUpperCase() + level.slice(1);
  badge.style.color = colors[level];
  badge.style.border = `1px solid ${colors[level]}`;
  badge.style.background = colors[level] + "18";

  showScreen("callScreen");
  startTimer();

  try {
    const res = await fetch(`${API_BASE}/session/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, level, gender: selectedGender })
    });
    const data = await res.json();
    sessionId = data.session_id;
    addAIMessage(data.message);
    if (data.audio_hex) playAudioHex(data.audio_hex);
  } catch (err) {
    addAIMessage("Hello! I am your speaking partner. Let us practice English together!");
  }
}

// ---- TIMER ----
function startTimer() {
  secondsElapsed = 0;
  timerInterval = setInterval(() => {
    secondsElapsed++;
    const m = Math.floor(secondsElapsed / 60);
    const s = secondsElapsed % 60;
    document.getElementById("statTimer").textContent = `${m}:${s.toString().padStart(2, "0")}`;
  }, 1000);
}

// ---- RECORDING ----
async function toggleRecording() {
  if (isProcessing) return;
  if (isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
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
    document.getElementById("voiceRing").classList.add("recording");
    document.getElementById("voiceHint").textContent = "Recording... tap to stop";
  } catch (err) {
    alert("Microphone access denied. Please allow microphone and try again.");
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
  document.getElementById("voiceRing").classList.remove("recording");
  document.getElementById("voiceHint").textContent = "Processing...";
}

async function sendVoiceMessage() {
  if (audioChunks.length === 0) return;
  const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
  await sendAudio(audioBlob);
}

async function sendAudio(audioBlob) {
  if (!sessionId || isProcessing) return;
  isProcessing = true;
  setInputsDisabled(true);

  const processingId = addProcessingIndicator();

  const formData = new FormData();
  formData.append("session_id", sessionId);
  formData.append("audio", audioBlob, "audio.webm");

  try {
    const res = await fetch(`${API_BASE}/session/voice`, { method: "POST", body: formData });
    const data = await res.json();

    removeProcessingIndicator(processingId);

    // Show user text
    if (data.user_text) addUserMessage(data.user_text);

    // Parse and show AI response
    if (data.ai_response) {
      const { mainText, feedbackText } = parseResponse(data.ai_response);
      addAIMessage(mainText);
      if (feedbackText) addFeedbackMessage(feedbackText);
    }

    // Play audio
    if (data.audio_hex) playAudioHex(data.audio_hex);

    // Update stats
    if (data.stats) updateStats(data.stats);

  } catch (err) {
    removeProcessingIndicator(processingId);
    addAIMessage("Sorry, I could not process that. Please try again.");
  } finally {
    isProcessing = false;
    setInputsDisabled(false);
    document.getElementById("voiceHint").textContent = "Tap mic to record your message";
  }
}

// ---- TEXT MESSAGE ----
async function sendTextMessage() {
  const input = document.getElementById("textInput");
  const text = input.value.trim();
  if (!text || !sessionId || isProcessing) return;

  input.value = "";
  isProcessing = true;
  setInputsDisabled(true);
  addUserMessage(text);

  const processingId = addProcessingIndicator();

  try {
    const res = await fetch(`${API_BASE}/session/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, message: text })
    });
    const data = await res.json();

    removeProcessingIndicator(processingId);

    const { mainText, feedbackText } = parseResponse(data.ai_response);
    addAIMessage(mainText);
    if (feedbackText) addFeedbackMessage(feedbackText);
    if (data.audio_hex) playAudioHex(data.audio_hex);
    if (data.stats) updateStats(data.stats);

  } catch (err) {
    removeProcessingIndicator(processingId);
    addAIMessage("Sorry, something went wrong. Please try again.");
  } finally {
    isProcessing = false;
    setInputsDisabled(false);
  }
}

// Enter key to send
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("textInput").addEventListener("keydown", e => {
    if (e.key === "Enter") sendTextMessage();
  });
});

// ---- END SESSION ----
async function endSession() {
  clearInterval(timerInterval);

  // Save final stats for summary
  const finalExchanges = document.getElementById("statExchanges").textContent;
  const finalWords = document.getElementById("statWords").textContent;
  const finalScore = document.getElementById("statScore").textContent;
  const finalDuration = document.getElementById("statTimer").textContent;

  document.getElementById("fstatExchanges").textContent = finalExchanges;
  document.getElementById("fstatWords").textContent = finalWords;
  document.getElementById("fstatScore").textContent = finalScore;
  document.getElementById("fstatDuration").textContent = finalDuration;

  showScreen("summaryScreen");

  if (!sessionId) return;

  try {
    const res = await fetch(`${API_BASE}/session/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId })
    });
    const data = await res.json();
    const summaryCard = document.getElementById("summaryContent");
    summaryCard.style.justifyContent = "flex-start";
    summaryCard.style.alignItems = "flex-start";
    summaryCard.textContent = data.summary;
  } catch (err) {
    document.getElementById("summaryContent").textContent = "Could not load summary. Great session though!";
  }

  sessionId = null;
}

// ---- RESTART ----
function restartApp() {
  selectedGender = null;
  selectedLevel = null;
  sessionId = null;
  secondsElapsed = 0;
  document.getElementById("chatContainer").innerHTML = "";
  document.getElementById("summaryContent").innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
  updateStats({ exchanges: 0, total_words: 0, avg_score: null });
  document.getElementById("statTimer").textContent = "0:00";
  showScreen("genderScreen");
}

// ---- UI HELPERS ----
function addAIMessage(text) {
  const container = document.getElementById("chatContainer");
  const row = document.createElement("div");
  row.className = "msg-row ai";
  row.innerHTML = `
    <div class="msg-avatar ai-avatar">🤖</div>
    <div class="msg-bubble">${escapeHtml(text)}</div>
  `;
  container.appendChild(row);
  scrollToBottom();
}

function addUserMessage(text) {
  const container = document.getElementById("chatContainer");
  const row = document.createElement("div");
  row.className = "msg-row user";
  row.innerHTML = `
    <div class="msg-avatar user-avatar">👤</div>
    <div class="msg-bubble">${escapeHtml(text)}</div>
  `;
  container.appendChild(row);
  scrollToBottom();
}

function addFeedbackMessage(text) {
  const container = document.getElementById("chatContainer");
  const div = document.createElement("div");
  div.className = "feedback-bubble";
  div.textContent = text;
  container.appendChild(div);
  scrollToBottom();
}

function addProcessingIndicator() {
  const container = document.getElementById("chatContainer");
  const id = "proc_" + Date.now();
  const row = document.createElement("div");
  row.className = "processing-row";
  row.id = id;
  row.innerHTML = `
    <div class="msg-avatar ai-avatar">🤖</div>
    <div class="processing-bubble">
      <div class="dots">
        <div class="dot"></div><div class="dot"></div><div class="dot"></div>
      </div>
      <span>Thinking...</span>
    </div>
  `;
  container.appendChild(row);
  scrollToBottom();
  return id;
}

function removeProcessingIndicator(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function setInputsDisabled(disabled) {
  document.getElementById("btnMic").disabled = disabled;
  document.getElementById("btnSend").disabled = disabled;
  document.getElementById("textInput").disabled = disabled;
}

function updateStats(stats) {
  if (stats.exchanges !== undefined)
    document.getElementById("statExchanges").textContent = stats.exchanges;
  if (stats.total_words !== undefined)
    document.getElementById("statWords").textContent = stats.total_words;
  if (stats.avg_score !== null && stats.avg_score !== undefined)
    document.getElementById("statScore").textContent = stats.avg_score + "/10";
}

function scrollToBottom() {
  const c = document.getElementById("chatContainer");
  c.scrollTop = c.scrollHeight;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

function parseResponse(text) {
  if (text.includes("FEEDBACK_START")) {
    const parts = text.split("FEEDBACK_START");
    const mainText = parts[0].trim();
    const feedbackRaw = parts[1] || "";
    const feedbackText = feedbackRaw.replace("FEEDBACK_END", "").trim();
    return { mainText, feedbackText };
  }
  return { mainText: text, feedbackText: null };
}

// ---- AUDIO PLAYBACK ----
function playAudioHex(hex) {
  try {
    const bytes = new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
    const blob = new Blob([bytes], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    if (currentAudio) {
      currentAudio.pause();
      URL.revokeObjectURL(currentAudio.src);
    }
    currentAudio = new Audio(url);
    currentAudio.play().catch(() => {});
    document.getElementById("callStatus").textContent = "● Speaking...";
    currentAudio.onended = () => {
      document.getElementById("callStatus").textContent = "● Active";
      URL.revokeObjectURL(url);
    };
  } catch (err) {
    console.error("Audio play error:", err);
  }
}