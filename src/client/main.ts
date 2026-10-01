// The Sage Mode page: one screen at a time, in the order a Guest meets them.
// Landing (code + Contact, or request a code), Consent, Voice sample, Question picker, Round, Replay, Next question.
// Decisions encoded here:
// - Consent comes before any recording, every time a Guest has no Voice clone. Consent
//   is not stored anywhere, so a Guest who deletes their voice sees it again.
// - "Delete my voice" is visible whenever a Voice clone exists, with a confirm step. It
//   is disabled during a live Round and while the Replay builds, because deleting then
//   would leave the Replay with no voice to speak in.
// - The Replay audio is fetched once and played from an object URL (each fetch is a paid
//   text to speech call).
// - Vanilla TypeScript and the BUDDi tokens (style.css); no framework, no dependency.
import consentMd from "../../content/consent.md?raw";
import readingScriptMd from "../../content/reading-script.md?raw";
import { SOCIAL_PLATFORMS, type Lang, type Me, type ReplayResponse, type SocialPlatform, type StartRoundResponse } from "../shared/api";
import { QUESTIONS, type Question } from "../shared/questions";
import { ApiFailure, httpApi, type ClientApi } from "./api";
import { failureMessage } from "./copy";
import { dmTargets, initialLang, LANDING, LANG_KEY, landingFailure, PLATFORM_NAMES } from "./landing";
import { renderMarkdown } from "./markdown";
import { ensureMicrophone } from "./microphone";
import { mockRequested } from "./mockMode";
import { RecorderUnavailable, sampleFilename, startRecording } from "./recorder";
import { RoundFailure, runRound, type StartSession } from "./round";
import { readStoryBank, saveToStoryBank } from "./storyBank";

const MIN_SAMPLE_SECONDS = 60;
const MAX_SAMPLE_SECONDS = 180;

// ---------- tiny DOM helper ----------

type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown>;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = String(value);
    else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key in el) (el as unknown as Props)[key] = value;
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

function codeOf(e: unknown): string {
  if (e instanceof ApiFailure || e instanceof RoundFailure) return e.code;
  if (e instanceof RecorderUnavailable) return "recorder_unavailable";
  if (e instanceof DOMException && ["NotAllowedError", "SecurityError", "NotFoundError", "NotReadableError", "NotSupportedError", "AbortError"].includes(e.name)) {
    return "mic_blocked";
  }
  return "bad_response";
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// ---------- app state ----------

let api: ClientApi = httpApi();
let startSession: StartSession = async (o) => (await import("./sage")).startSageSession(o);
let checkMicrophone: () => Promise<void> = ensureMicrophone;
let isMock = false;
let me: Me | null = null;
let roundLive = false;
let teardown: (() => void)[] = [];
let activeRound: AbortController | null = null;
let lang: Lang = initialLang(localStorage.getItem(LANG_KEY), navigator.languages ?? [navigator.language]);

const header = document.getElementById("header")!;
const main = document.getElementById("main")!;

function mount(...nodes: Node[]) {
  for (const fn of teardown.splice(0)) fn();
  main.replaceChildren(...nodes);
  renderHeader();
  main.querySelector<HTMLElement>("h1, h2")?.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function roundsLeft(): number {
  return me ? Math.max(0, me.allowance - me.used) : 0;
}

function renderHeader() {
  const right: Node[] = [];
  if (me) right.push(h("span", { class: "ds-badge" }, `Rounds left: ${roundsLeft()}`));
  if (me?.hasVoice) right.push(deleteVoiceControl());
  if (!me) {
    const t = LANDING[lang];
    right.push(
      h("button", { class: "ds-btn ds-btn-ghost lang-toggle", "aria-label": t.toggleLabel, onClick: () => { setLang(lang === "en" ? "es" : "en"); showLanding(); } }, t.toggle),
    );
  }
  header.replaceChildren(
    h(
      "div",
      { class: "column" },
      isMock ? h("p", { class: "ds-note mock-banner" }, "Mock mode: nothing on this page reaches the real service.") : "",
      h(
        "div",
        { class: "bar" },
        h("div", { class: "brand" }, h("span", { class: "logo nb-sm" }, "B"), h("span", {}, "BUDDi Sage Mode")),
        h("div", { class: "bar-right" }, ...right),
      ),
    ),
  );
}

function deleteVoiceControl(): HTMLElement {
  const wrap = h("div", { class: "delete-voice" });
  const ask = () =>
    wrap.replaceChildren(
      h("span", { class: "confirm-text" }, "Delete your Voice clone? This cannot be undone."),
      h("button", { class: "ds-btn ds-btn-primary", onClick: confirm }, "Delete it"),
      h("button", { class: "ds-btn ds-btn-ghost", onClick: idle }, "Keep it"),
    );
  const idle = () =>
    wrap.replaceChildren(
      h(
        "button",
        {
          class: "ds-btn ds-btn-ghost",
          disabled: roundLive,
          title: roundLive ? "Available after this Round" : undefined,
          onClick: ask,
        },
        "Delete my voice",
      ),
    );
  const confirm = async () => {
    wrap.replaceChildren(h("span", { class: "confirm-text" }, "Deleting your Voice clone..."));
    try {
      await api.deleteVoice();
      if (me) me = { ...me, hasVoice: false };
      showConsent("Your Voice clone is deleted.");
    } catch (e) {
      wrap.replaceChildren(h("span", { class: "ds-note ds-note-error" }, failureMessage(codeOf(e))));
      setTimeout(idle, 4000);
    }
  };
  idle();
  return wrap;
}

// ---------- screens ----------

function panel(...children: Child[]) {
  return h("section", { class: "ds-card" }, ...children);
}

function title(kicker: string, text: string) {
  return [h("p", { class: "kicker" }, kicker), h("h1", { tabIndex: -1 }, text)];
}

function showLoading(text = "Loading...") {
  mount(panel(h("p", { class: "muted", role: "status" }, text)));
}

function showError(code: string, retry: () => void) {
  mount(panel(...title("Something went wrong", "We hit a snag"), h("p", { class: "ds-note ds-note-error", role: "alert" }, failureMessage(code)), h("button", { class: "ds-btn ds-btn-primary", onClick: retry }, "Try again")));
}

async function refreshMe(): Promise<Me | null> {
  try {
    me = await api.me();
  } catch (e) {
    if (codeOf(e) === "unauthorized") me = null;
    else throw e;
  }
  return me;
}

async function boot() {
  showLoading();
  try {
    const current = await refreshMe();
    if (!current) showLanding();
    else route();
  } catch (e) {
    showError(codeOf(e), boot);
  }
}

function route() {
  if (!me) showLanding();
  else if (!me.hasVoice) showConsent();
  else showPicker();
}

// The landing page doubles as the code screen: both calls to action sit in the hero.
function showLanding(message?: string) {
  const t = LANDING[lang];

  // Have a code?
  const code = h("input", { id: "code", name: "code", autocomplete: "off", autocapitalize: "characters", required: true, placeholder: "SAGE-XXXX-XXXX", class: "ds-input" });
  const contact = h("input", { id: "contact", name: "contact", autocomplete: "email", placeholder: "you@example.com / @handle", class: "ds-input" });
  const error = h("p", { class: "ds-note ds-note-error", role: "alert" }, message ?? "");
  const submit = h("button", { class: "ds-btn ds-btn-primary", type: "submit" }, t.haveCode.submit);
  const codeForm = h(
    "form",
    {
      class: "stack",
      onSubmit: async (ev: Event) => {
        ev.preventDefault();
        submit.disabled = true;
        error.textContent = "";
        try {
          me = await api.redeem({ code: code.value, contact: contact.value.trim() || undefined });
          route();
        } catch (e) {
          const c = codeOf(e);
          error.textContent = landingFailure(lang, c);
          (c === "contact_required" ? contact : code).focus();
          submit.disabled = false;
        }
      },
    },
    h("div", { class: "field" }, h("label", { for: "code" }, t.haveCode.code), code),
    h("div", { class: "field" }, h("label", { for: "contact" }, `${t.haveCode.contact} `, h("span", { class: "muted hint" }, t.haveCode.contactHint)), contact),
    error,
    submit,
  );

  // Request a code: the account they will DM from, and optionally the job.
  const platform = h(
    "select",
    { id: "req-platform", name: "platform", class: "ds-input" },
    ...SOCIAL_PLATFORMS.map((p) => h("option", { value: p }, PLATFORM_NAMES[p])),
  );
  const handle = h("input", { id: "req-handle", name: "handle", required: true, autocomplete: "off", autocapitalize: "none", spellcheck: false, placeholder: "@yourhandle", class: "ds-input" });
  const jobUrl = h("input", { id: "req-job", name: "job_url", type: "url", inputMode: "url", maxLength: 500, placeholder: "https://", class: "ds-input" });
  // Honeypot: hidden from people and screen readers, filled only by bots.
  const website = h("input", { name: "website", tabIndex: -1, autocomplete: "off", "aria-hidden": "true", class: "hp" });
  const reqError = h("p", { class: "ds-note ds-note-error", role: "alert" });
  const reqSubmit = h("button", { class: "ds-btn ds-btn-violet", type: "submit" }, t.request.submit);
  const requestCard = h("section", { class: "ds-card cta-card" });
  const requestForm = h(
    "form",
    {
      class: "stack",
      noValidate: true,
      onSubmit: async (ev: Event) => {
        ev.preventDefault();
        reqSubmit.disabled = true;
        reqSubmit.textContent = t.request.sending;
        reqError.textContent = "";
        const p = platform.value as SocialPlatform;
        const who = `@${handle.value.trim().replace(/^@/, "")} (${PLATFORM_NAMES[p]})`;
        try {
          await api.requestCode({ platform: p, handle: handle.value, job_url: jobUrl.value.trim() || undefined, lang, website: website.value });
          requestCard.replaceChildren(h("h2", {}, t.request.title), h("p", { class: "ds-note ds-note-success", role: "status" }, t.request.done(who, dmTargets(lang))));
        } catch (e) {
          reqError.textContent = landingFailure(lang, codeOf(e));
          reqSubmit.disabled = false;
          reqSubmit.textContent = t.request.submit;
          handle.focus();
        }
      },
    },
    h(
      "div",
      { class: "handle-row" },
      h("div", { class: "field" }, h("label", { for: "req-platform" }, t.request.platform), platform),
      h("div", { class: "field" }, h("label", { for: "req-handle" }, t.request.handle), handle),
    ),
    h("div", { class: "field" }, h("label", { for: "req-job" }, t.request.jobUrl), jobUrl),
    website,
    reqError,
    reqSubmit,
  );
  requestCard.replaceChildren(h("h2", {}, t.request.title), h("p", { class: "muted" }, t.request.blurb(dmTargets(lang))), requestForm);

  mount(
    h(
      "div",
      { class: "landing" },
      h(
        "section",
        { class: "hero" },
        h("div", { class: "hero-text" }, h("p", { class: "kicker" }, t.kicker), h("h1", { tabIndex: -1 }, t.headline)),
        h("img", { class: "hero-art", src: "/sage-hero.svg", alt: "", width: 360, height: 300 }),
        h("p", { class: "reading lede" }, t.lede),
      ),
      h("div", { class: "cta-grid" }, h("section", { class: "ds-card cta-card" }, h("h2", {}, t.haveCode.title), codeForm), requestCard),
      h(
        "section",
        { class: "how" },
        h("h2", {}, t.howTitle),
        h(
          "ol",
          { class: "steps" },
          ...t.steps.map((s, i) => h("li", { class: "ds-card step" }, h("span", { class: "ds-badge ds-badge-gold step-num" }, String(i + 1)), h("h3", {}, s.title), h("p", {}, s.body))),
        ),
      ),
      h("section", { class: "notes inset nb-sm" }, h("h2", {}, t.notesTitle), h("ul", {}, ...t.notes.map((n) => h("li", {}, n)))),
    ),
  );
}

function setLang(next: Lang) {
  lang = next;
  localStorage.setItem(LANG_KEY, next);
  applyLang();
}

function applyLang() {
  document.documentElement.lang = lang;
  const lead = document.getElementById("footer-lead");
  if (lead) lead.textContent = LANDING[lang].footer;
}

function showConsent(notice?: string) {
  const box = h("input", { type: "checkbox", id: "consent" });
  const next = h("button", { class: "ds-btn ds-btn-primary", disabled: true, onClick: () => showVoice() }, "Continue to your Voice sample");
  box.addEventListener("change", () => (next.disabled = !box.checked));

  const body = h("div", { class: "prose reading" });
  body.innerHTML = renderMarkdown(consentMd);

  mount(
    panel(
      notice ? h("p", { class: "ds-note ds-note-success", role: "status" }, notice) : "",
      ...title("Step 1 of 3: Consent", "Your voice, your call"),
      body,
      h("label", { class: "check inset nb-sm", for: "consent" }, box, h("span", {}, "This is my own voice and I consent to cloning it")),
      next,
    ),
  );
}

function showVoice() {
  const script = h("div", { class: "prose reading script inset nb-sm" });
  script.innerHTML = renderMarkdown(readingScriptMd);

  const timer = h("p", { class: "timer", "aria-live": "off" }, "0:00");
  const nudge = h("p", { class: "muted", role: "status" }, `Read the script aloud at your normal pace. Aim for at least ${MIN_SAMPLE_SECONDS} seconds.`);
  const controls = h("div", { class: "row" });
  const preview = h("div", { class: "stack" });
  const error = h("p", { class: "ds-note ds-note-error", role: "alert" });

  let recording: Awaited<ReturnType<typeof startRecording>> | null = null;
  let tick: ReturnType<typeof setInterval> | undefined;
  let began = 0;
  let objectUrl: string | null = null;
  let sample: { blob: Blob; mimeType: string; seconds: number } | null = null;

  const stopTimer = () => tick !== undefined && clearInterval(tick);
  const clearPreview = () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    preview.replaceChildren();
  };
  teardown.push(() => {
    stopTimer();
    void recording?.stop();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  });

  const setControls = (...buttons: HTMLElement[]) => controls.replaceChildren(...buttons);

  const record = async () => {
    error.textContent = "";
    clearPreview();
    sample = null;
    try {
      recording = await startRecording();
    } catch (e) {
      error.textContent = failureMessage(codeOf(e));
      idle();
      return;
    }
    began = Date.now();
    timer.textContent = "0:00";
    timer.classList.add("live");
    tick = setInterval(() => {
      const s = (Date.now() - began) / 1000;
      timer.textContent = clock(s);
      nudge.textContent =
        s < MIN_SAMPLE_SECONDS ? `Keep reading: ${Math.ceil(MIN_SAMPLE_SECONDS - s)} more seconds to reach ${MIN_SAMPLE_SECONDS}.` : "That is enough for a good Voice clone. Stop whenever you finish a sentence.";
      if (s >= MAX_SAMPLE_SECONDS) void stop();
    }, 250);
    setControls(h("button", { class: "ds-btn ds-btn-primary", onClick: stop }, "Stop"));
  };

  const stop = async () => {
    if (!recording) return;
    const r = recording;
    recording = null;
    stopTimer();
    timer.classList.remove("live");
    const seconds = (Date.now() - began) / 1000;
    const blob = await r.stop();
    setRecorded({ blob, mimeType: r.mimeType, seconds });
  };

  const setRecorded = (s: { blob: Blob; mimeType: string; seconds: number }) => {
    sample = s;
    error.textContent = "";
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(s.blob);
    timer.textContent = clock(s.seconds);
    nudge.textContent =
      s.seconds < MIN_SAMPLE_SECONDS
        ? `That was ${Math.round(s.seconds)} seconds. A sample of at least ${MIN_SAMPLE_SECONDS} seconds makes a closer Voice clone; you can re-record or use this one.`
        : "Listen back, then use it or record again.";
    preview.replaceChildren(
      h("audio", { controls: true, src: objectUrl }),
      isMock ? h("a", { href: objectUrl, download: sampleFilename(s.mimeType), class: "muted" }, "Mock mode: save this sample as a file") : "",
    );
    setControls(
      h("button", { class: "ds-btn ds-btn-primary", onClick: upload }, "Use this Voice sample"),
      h("button", { class: "ds-btn ds-btn-ghost", onClick: record }, "Record again"),
    );
  };

  const upload = async () => {
    if (!sample) return;
    error.textContent = "";
    setControls(h("span", { class: "muted", role: "status" }, "Making your Voice clone..."));
    try {
      await api.addVoice(sample.blob, sampleFilename(sample.mimeType));
      await refreshMe();
      route();
    } catch (e) {
      const c = codeOf(e);
      if (c === "voice_exists") {
        await refreshMe().catch(() => null);
        route();
        return;
      }
      if (sample) setRecorded(sample);
      error.textContent = failureMessage(c);
    }
  };

  const idle = () => {
    const buttons: HTMLElement[] = [h("button", { class: "ds-btn ds-btn-primary", onClick: record }, "Start recording")];
    if (isMock) {
      buttons.push(
        h(
          "button",
          {
            class: "ds-btn ds-btn-ghost",
            onClick: async () => setRecorded({ blob: (await import("./mock")).toneWav(2), mimeType: "audio/wav", seconds: 2 }),
          },
          "Mock mode: use a test tone",
        ),
      );
    }
    setControls(...buttons);
  };
  idle();

  mount(
    panel(
      ...title("Step 2 of 3: Voice sample", "Read this aloud"),
      h("p", { class: "muted" }, "Your Voice sample makes the Voice clone that speaks your Replay. Sage keeps its own voice."),
      script,
      h("div", { class: "recorder inset nb-sm" }, timer, nudge, preview, controls, error),
    ),
  );
}

function showPicker(notice?: string) {
  const left = roundsLeft();
  const saved = new Set(readStoryBank(localStorage).map((e) => e.question_id));
  const pick = (q: Question) => showRound(q);

  mount(
    panel(
      notice ? h("p", { class: "ds-note ds-note-success", role: "status" }, notice) : "",
      ...title("Step 3 of 3: Pick a Question", "What should Sage ask you?"),
      h("p", { class: "muted" }, "Sage asks the Question, listens to your Answer, pushes back once, then you answer again. Each Question you practice uses one Round."),
      left <= 0 ? h("p", { class: "ds-note ds-note-error", role: "alert" }, failureMessage("allowance_used")) : "",
      h(
        "ul",
        { class: "questions" },
        ...QUESTIONS.map((q) =>
          h(
            "li",
            {},
            h(
              "button",
              { class: "question nb nb-press", disabled: left <= 0, onClick: () => pick(q) },
              h("span", { class: "reading" }, q.text),
              saved.has(q.id) ? h("span", { class: "ds-badge ds-badge-success" }, "In your Story bank") : "",
            ),
          ),
        ),
      ),
      h("p", { class: "muted small" }, "Sage talks with you out loud: use headphones if you can, and find a quiet spot."),
    ),
  );
}

function showRound(q: Question) {
  const status = h("p", { class: "status", role: "status" }, "Checking your microphone...");
  const pulse = h("div", { class: "pulse", "aria-hidden": "true" });
  const endButton = h("button", { class: "ds-btn ds-btn-ghost" }, "End Round");
  const controller = new AbortController();
  endButton.addEventListener("click", () => controller.abort());

  mount(panel(h("p", { class: "kicker" }, "Round"), h("h1", { tabIndex: -1, class: "question-text" }, q.text), h("div", { class: "live inset nb-sm" }, pulse, status), endButton));

  activeRound = controller;
  roundLive = true;
  renderHeader();
  teardown.push(() => controller.abort());

  const setStatus = (text: string, state: string) => {
    status.textContent = text;
    pulse.dataset.state = state;
  };

  let start: StartRoundResponse | null = null;
  runRound({
    questionId: q.id,
    api,
    startSession,
    ensureMicrophone: checkMicrophone,
    signal: controller.signal,
    hooks: {
      onStarted: (s) => {
        start = s;
        if (me) me = { ...me, used: me.allowance - s.allowance_left };
        renderHeader();
        setStatus("Connecting you to Sage...", "connecting");
      },
      onConnected: () => setStatus("Sage is about to ask the Question.", "listening"),
      onMode: (mode) => {
        if (status.dataset.saved) return;
        setStatus(mode === "speaking" ? "Sage is speaking." : "Your turn: Sage is listening.", mode);
      },
      onSaved: () => {
        status.dataset.saved = "1";
        endButton.remove();
        setStatus("Answer saved. Sage is wrapping up.", "speaking");
      },
      onBuilding: () => {
        setStatus("Building your Replay. This can take up to 30 seconds.", "building");
      },
      onRetrying: () => setStatus("Still building your Replay. One more try...", "building"),
    },
  })
    .then(({ start: s, replay }) => {
      finishRound(controller);
      showReplay(s.question, replay);
    })
    .catch((e: unknown) => {
      finishRound(controller);
      if (controller.signal.aborted && !main.contains(status)) return; // left the screen
      showRoundProblem(codeOf(e), start !== null);
    });
}

function finishRound(controller: AbortController) {
  if (activeRound === controller) activeRound = null;
  roundLive = false;
}

async function showRoundProblem(code: string, spent: boolean) {
  await refreshMe().catch(() => null);
  if (code === "unauthorized") return showLanding(failureMessage(code));
  if (code === "voice_required") return route();
  mount(
    panel(
      ...title("Round", code === "aborted" ? "Round ended" : "That Round did not finish"),
      h("p", { class: "ds-note ds-note-error", role: "alert" }, failureMessage(code)),
      spent ? h("p", { class: "muted" }, "This Round still counts toward your Rounds.") : "",
      h("button", { class: "ds-btn ds-btn-primary", onClick: () => route() }, "Back to the Questions"),
    ),
  );
}

function showReplay(question: { id: string; text: string }, replay: ReplayResponse) {
  saveToStoryBank(localStorage, {
    question_id: question.id,
    final_answer: replay.final_answer,
    best_self_text: replay.best_self_text,
    saved_at: new Date().toISOString(),
  });

  const player = h("div", { class: "player" }, h("p", { class: "muted", role: "status" }, "Loading your Replay..."));
  let objectUrl: string | null = null;
  teardown.push(() => objectUrl && URL.revokeObjectURL(objectUrl));

  const load = async () => {
    player.replaceChildren(h("p", { class: "muted", role: "status" }, "Loading your Replay..."));
    try {
      const blob = await api.fetchAudio(replay.audio_url);
      objectUrl = URL.createObjectURL(blob);
      const audio = h("audio", { controls: true, src: objectUrl });
      player.replaceChildren(audio);
      audio.play().catch(() => undefined); // autoplay may be blocked; the controls stay
    } catch (e) {
      player.replaceChildren(
        h("p", { class: "ds-note ds-note-error", role: "alert" }, failureMessage(codeOf(e))),
        h("button", { class: "ds-btn ds-btn-ghost", onClick: load }, "Load the Replay again"),
      );
    }
  };

  mount(
    panel(
      ...title("Replay", "Now listen to your best self"),
      h("p", { class: "muted" }, question.text),
      player,
      replay.status === "fallback" ? h("p", { class: "ds-note ds-note-info" }, "We kept your own words this time.") : "",
      h("h2", {}, "Your Best-self answer"),
      h("p", { class: "ds-card ds-card-violet best-self" }, replay.best_self_text),
      h("details", { class: "said inset nb-sm" }, h("summary", {}, "What you said"), h("p", { class: "reading" }, replay.final_answer)),
      h("p", { class: "muted small" }, "Saved to your Story bank on this device."),
      h(
        "button",
        {
          class: "ds-btn ds-btn-primary",
          onClick: async () => {
            showLoading();
            try {
              await refreshMe();
              route();
            } catch (e) {
              showError(codeOf(e), boot);
            }
          },
        },
        "Next question",
      ),
    ),
  );
  void load();
}

// ---------- start ----------

window.addEventListener("pagehide", () => activeRound?.abort());

async function init() {
  applyLang();
  if (mockRequested(location.search, location.hostname)) {
    const mock = await import("./mock");
    api = mock.mockApi();
    startSession = mock.mockStartSession;
    checkMicrophone = async () => undefined; // the mock Sage does not listen
    isMock = true;
  }
  await boot();
}

void init();
