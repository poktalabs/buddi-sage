// The Sage Mode page: one screen at a time, in the order a Guest meets them.
// Landing (code + Contact, or request a code), Target job, Consent, Voice sample, Question picker, Round, Replay, Next question.
// An owner code also gets the Dashboard (/dashboard): every code, and a form to issue more.
// Decisions encoded here:
// - Consent comes before any recording, every time a Guest has no Voice clone. Consent
//   is not stored anywhere, so a Guest who deletes their voice sees it again.
// - "Delete my voice" is visible whenever a Voice clone exists, with a confirm step. It
//   is disabled during a live Round and while the Replay builds, because deleting then
//   would leave the Replay with no voice to speak in.
// - The Replay audio is fetched once and played from an object URL (each fetch is a paid
//   text to speech call).
// - The target job comes first, because everything after it is about that job (BUDDi is
//   job-first). It can be skipped; the fixed Question set is the fallback, and the picker
//   keeps offering the job until the Guest adds one.
// - Vanilla TypeScript and the BUDDi tokens (style.css); no framework, no dependency.
import consentMd from "../../content/consent.md?raw";
import readingScriptMd from "../../content/reading-script.md?raw";
import type { DashboardResponse, JobBrief, Lang, Me, ReplayResponse, StartRoundResponse } from "../shared/api";
import { QUESTIONS, type Question } from "../shared/questions";
import { ApiFailure, httpApi, type ClientApi } from "./api";
import { failureMessage } from "./copy";
import { FILTERS, formatTime, inviteLink, isRedeemed, matchesFilter, summarise, type CodeFilter } from "./dashboard";
import { initialLang, LANDING, LANG_KEY, landingFailure, MEL_PROFILES, SOCIAL_ICONS } from "./landing";
import { renderMarkdown } from "./markdown";
import { ensureMicrophone } from "./microphone";
import { mockRequested } from "./mockMode";
import { RecorderUnavailable, sampleFilename, startRecording } from "./recorder";
import { RoundFailure, runRound, type StartSession } from "./round";
import { readStoryBank, saveToStoryBank } from "./storyBank";

const MIN_SAMPLE_SECONDS = 60;
const JOB_SKIP_KEY = "buddi-sage:job-skipped";
const BUDDI_URL = "https://buddi.agentcamp.xyz/";
const MAX_SAMPLE_SECONDS = 180;
const DASHBOARD_PATH = "/dashboard";

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
let landingMode: "request" | "have" = "request";
let codeFilter: CodeFilter = "all";
// Read once at load: mount() rewrites the address for every screen, the loading one included.
let openDashboard = location.pathname === DASHBOARD_PATH;
let lang: Lang = initialLang(localStorage.getItem(LANG_KEY), navigator.languages ?? [navigator.language]);

const header = document.getElementById("header")!;
const main = document.getElementById("main")!;

function mount(...nodes: Node[]) {
  for (const fn of teardown.splice(0)) fn();
  main.replaceChildren(...nodes);
  // The landing page runs wider than the app screens, header included, so the logo lines up with the hero.
  document.body.classList.toggle("is-landing", main.querySelector(".landing") !== null);
  document.body.classList.toggle("is-dashboard", main.querySelector(".dashboard") !== null);
  // Only the Dashboard has its own address; every other screen lives at /.
  const path = main.querySelector(".dashboard") ? DASHBOARD_PATH : "/";
  if (location.pathname !== path) history.replaceState(null, "", path + location.search);
  renderHeader();
  main.querySelector<HTMLElement>("h1, h2")?.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function roundsLeft(): number {
  return me ? Math.max(0, me.allowance - me.used) : 0;
}

function renderHeader() {
  const right: Node[] = [];
  if (me?.kind === "owner") {
    const onDashboard = main.querySelector(".dashboard") !== null;
    right.push(
      h(
        "button",
        { class: "ds-btn ds-btn-ghost", disabled: roundLive, title: roundLive ? "Available after this Round" : undefined, onClick: () => (onDashboard ? route() : void showDashboard()) },
        onDashboard ? "Practice" : "Dashboard",
      ),
    );
  }
  if (me) right.push(h("span", { class: "ds-badge" }, `Rounds left: ${roundsLeft()}`));
  if (me?.hasVoice) right.push(deleteVoiceControl());
  if (me) {
    right.push(
      h(
        "button",
        { class: "ds-btn ds-btn-ghost", disabled: roundLive, title: roundLive ? "Available after this Round" : undefined, onClick: logOut },
        "Log out",
      ),
    );
  }
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
        // Same as BUDDi's header: the logo is the home link and its tile presses in on hover.
        h(
          "a",
          { class: "brand group", href: "/", onClick: goHome },
          h("span", { class: "logo nb-sm nb-press-child" }, "B"),
          h("span", {}, "BUDDi"),
        ),
        h("div", { class: "bar-right" }, ...right),
      ),
    ),
  );
}

// Home is the landing page before a code, the next step after one. Never mid-Round: leaving
// would drop the live call.
function goHome(ev: Event) {
  ev.preventDefault();
  if (roundLive) return;
  if (me) route();
  else showLanding();
}

// Ends the Session and forgets this browser's per-code choice (skipped job), so the next code
// starts clean. The language and the Story bank stay: they belong to the browser, not the code.
async function logOut() {
  if (roundLive) return;
  try {
    await api.logout();
  } catch {
    // The cookie may already be gone; the browser forgets the code either way.
  }
  me = null;
  localStorage.removeItem(JOB_SKIP_KEY);
  showLanding();
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

function jobSkipped(): boolean {
  return localStorage.getItem(JOB_SKIP_KEY) === "1";
}

function jobLabel(job: JobBrief): string {
  return job.company ? `${job.role} at ${job.company}` : job.role;
}

// The practice flow's next step. An owner code opened at /dashboard lands there first, after
// a reload or after entering the code.
function route() {
  const dashboardFirst = openDashboard && me?.kind === "owner";
  if (me) openDashboard = false;
  if (!me) showLanding();
  else if (dashboardFirst) void showDashboard();
  else if (!me.job && !jobSkipped()) showJob();
  else if (!me.hasVoice) showConsent();
  else showPicker();
}

// The landing page doubles as the code screen: both hero buttons open the same two-tab form in
// a dialog, on the tab the visitor picked.
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

  // Get a code: optionally the job, then their handle. Once the handle has 3 characters the
  // platform logos appear; a tap opens Mel's profile there (a real link, so no popup blocker)
  // and sends the request with that platform, then shows the "DM me" step.
  const handle = h("input", { id: "req-handle", name: "handle", required: true, autocomplete: "off", autocapitalize: "none", spellcheck: false, placeholder: "@yourhandle", class: "ds-input" });
  const job = h("input", { id: "req-job", name: "job", maxLength: 300, placeholder: t.request.jobPlaceholder, class: "ds-input" });
  // Honeypot: hidden from people and screen readers, filled only by bots.
  const website = h("input", { name: "website", tabIndex: -1, autocomplete: "off", "aria-hidden": "true", class: "hp" });
  const reqError = h("p", { class: "ds-note ds-note-error", role: "alert" });
  const requestCard = h("div", {});
  let sending = false;
  const platformLinks = MEL_PROFILES.map((p) =>
    socialLink(p, t.request.dmLabel(p.name), async () => {
      if (sending) return;
      sending = true;
      reqError.textContent = t.request.sending;
      reqError.classList.remove("ds-note-error");
      const who = `@${bareHandle(handle.value)}`;
      try {
        await api.requestCode({ handle: handle.value, platform: p.network, job: job.value.trim() || undefined, lang, website: website.value });
        showDmStep(requestCard, who, p);
      } catch (e) {
        reqError.classList.add("ds-note-error");
        reqError.textContent = landingFailure(lang, codeOf(e));
        sending = false;
      }
    }),
  );
  const picker = h("div", { class: "platform-pick", hidden: true }, h("p", { class: "pick-title" }, t.request.pick), h("div", { class: "social-row" }, ...platformLinks));
  const syncPicker = () => {
    const bare = bareHandle(handle.value);
    const valid = HANDLE_SHAPE.test(bare);
    picker.hidden = !(valid && bare.length >= 3);
    if (!sending) {
      reqError.classList.add("ds-note-error");
      reqError.textContent = bare.length >= 3 && !valid ? t.request.handleRule : "";
    }
  };
  handle.addEventListener("input", syncPicker);
  const requestForm = h(
    "form",
    {
      class: "stack",
      // Enter in a field moves on to the logos instead of submitting: the tap is the submit.
      onSubmit: (ev: Event) => {
        ev.preventDefault();
        syncPicker();
        if (!picker.hidden) platformLinks[0]?.focus();
        else handle.focus();
      },
    },
    h("div", { class: "field" }, h("label", { for: "req-job" }, t.request.job), job),
    h("div", { class: "field" }, h("label", { for: "req-handle" }, t.request.handle), handle),
    website,
    picker,
    reqError,
  );
  requestCard.replaceChildren(h("p", { class: "muted" }, t.request.blurb), requestForm);

  // One card, two modes. A link with ?code= or an ended Session opens the dialog on "I have a code".
  const fromLink = new URLSearchParams(location.search).get("code");
  if (fromLink) code.value = fromLink.toUpperCase();
  const openOnLoad = Boolean(fromLink || message);
  if (openOnLoad) landingMode = "have";
  const haveCard = h("div", {}, codeForm);
  const panelBox = h("div", { class: "cta-panel", role: "tabpanel" });
  const tabs = (["request", "have"] as const).map((m) =>
    h("button", { type: "button", role: "tab", class: "seg", onClick: () => setMode(m) }, m === "request" ? t.toggleRequest : t.toggleHave),
  );
  const setMode = (m: "request" | "have", focus = true) => {
    landingMode = m;
    tabs.forEach((b, i) => b.setAttribute("aria-selected", String((i === 0 ? "request" : "have") === m)));
    panelBox.replaceChildren(m === "request" ? requestCard : haveCard);
    if (focus) (m === "request" ? handle : code).focus({ preventScroll: true });
  };
  setMode(landingMode, false);

  const closeBtn = h("button", { type: "button", class: "dialog-close ds-btn ds-btn-ghost", "aria-label": t.close, onClick: () => dialog.close() }, "\u00d7");
  const dialog = h(
    "dialog",
    { class: "cta-dialog ds-card", "aria-label": t.ctaLabel },
    closeBtn,
    h("div", { class: "segmented nb-sm", role: "tablist", "aria-label": t.ctaLabel }, ...tabs),
    panelBox,
  ) as HTMLDialogElement;
  // A click on the backdrop lands on the dialog element itself: close, like Escape does.
  dialog.addEventListener("click", (ev) => {
    if (ev.target === dialog) dialog.close();
  });
  const open = (m: "request" | "have") => {
    setMode(m, false);
    dialog.showModal();
    (m === "request" ? handle : code).focus();
  };

  mount(
    h(
      "div",
      { class: "landing" },
      h(
        "section",
        { class: "hero" },
        h(
          "div",
          { class: "hero-inner" },
          h("h1", { tabIndex: -1 }, `${t.headline[0]} `, h("span", { class: "hero-mark" }, t.headline[1])),
          h("p", { class: "tagline" }, ...t.tagline.flatMap((s, i) => (i === 0 ? [h("span", {}, s)] : [h("span", { class: "tagline-dot", "aria-hidden": "true" }, "\u2022"), h("span", {}, s)]))),
          h(
            "div",
            { class: "hero-ctas" },
            h("button", { type: "button", class: "ds-btn ds-btn-ghost ds-btn-lg", "aria-haspopup": "dialog", onClick: () => open("request") }, t.toggleRequest),
            h("button", { type: "button", class: "ds-btn ds-btn-primary ds-btn-lg", "aria-haspopup": "dialog", onClick: () => open("have") }, t.toggleHave),
          ),
          h("p", { class: "cta-note" }, t.ctaNote),
          h("img", { class: "hero-art", src: "/sage-hero.svg", alt: "", width: 520, height: 460 }),
        ),
      ),
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
      dialog,
    ),
  );
  if (openOnLoad) open("have");
}

// The request form's handle rule, mirrored from the Worker (social.ts): a leading @ or a pasted
// profile link is reduced to the bare handle.
const HANDLE_SHAPE = /^[A-Za-z0-9._]{1,30}$/;
function bareHandle(input: string): string {
  const v = input.trim();
  const fromUrl = /^(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|x\.com|twitter\.com|tiktok\.com)\/@?([^/?#\s]+)/i.exec(v);
  return (fromUrl ? fromUrl[1]! : v).replace(/^@/, "");
}

// One big icon link to Mel's profile on a platform. `onTap` runs alongside the navigation.
function socialLink(p: (typeof MEL_PROFILES)[number], label: string, onTap?: () => void): HTMLAnchorElement {
  const icon = h("span", { class: "social-icon" });
  icon.innerHTML = SOCIAL_ICONS[p.network]; // static markup from landing.ts
  return h("a", { class: "social-link nb-sm nb-press", href: p.url, target: "_blank", rel: "noopener", "aria-label": label, onClick: onTap }, icon, h("span", {}, p.name));
}

// After the tap: the request is in, and the DM is the last step. The same platform's link is
// offered again in case the new tab did not open.
function showDmStep(card: HTMLElement, who: string, p: (typeof MEL_PROFILES)[number]) {
  const t = LANDING[lang].request;
  const title = h("h2", { tabIndex: -1, class: "dm-title" }, t.dmTitle);
  card.replaceChildren(
    title,
    h("p", { role: "status" }, t.dmBody(who, p.name)),
    h("div", { class: "social-row" }, socialLink(p, t.dmAgain(p.name))),
    h("p", { class: "muted small" }, t.dmNote),
  );
  title.focus();
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

// The target job: a link or the pasted post. `again` is a change from the picker, where
// "back" returns to the picker instead of skipping the job.
function showJob(again = false) {
  const source = h("textarea", {
    id: "job-source",
    class: "ds-input job-source",
    rows: 4,
    maxLength: 20000,
    required: true,
    placeholder: "https://jobs.example.com/senior-ai-engineer, or paste the job post",
  });
  source.value = me?.jobSource ?? "";
  const error = h("p", { class: "ds-note ds-note-error", role: "alert" });
  const submit = h("button", { class: "ds-btn ds-btn-primary", type: "submit" }, "Use this job");
  const back = h(
    "button",
    {
      class: "ds-btn ds-btn-ghost",
      type: "button",
      onClick: () => {
        if (again) return showPicker();
        localStorage.setItem(JOB_SKIP_KEY, "1");
        route();
      },
    },
    again ? "Keep my current job" : "Skip: practice general Questions",
  );
  const form = h(
    "form",
    {
      class: "stack",
      onSubmit: async (ev: Event) => {
        ev.preventDefault();
        submit.disabled = back.disabled = true;
        submit.textContent = "Reading the job...";
        error.textContent = "";
        try {
          me = await api.setJob({ source: source.value });
          localStorage.removeItem(JOB_SKIP_KEY);
          route();
        } catch (e) {
          const c = codeOf(e);
          if (c === "unauthorized") return showLanding(failureMessage(c));
          error.textContent = failureMessage(c);
          submit.disabled = back.disabled = false;
          submit.textContent = "Use this job";
          source.focus();
        }
      },
    },
    h("div", { class: "field" }, h("label", { for: "job-source" }, "Job link or job post"), source),
    error,
    h("div", { class: "actions" }, submit, back),
  );

  mount(
    panel(
      ...title(again ? "Your target job" : "Step 1 of 4: Your target job", "What job are you practicing for?"),
      h("p", { class: "muted" }, "Paste a link to the job post, or the post itself. Sage asks you Questions for this exact role, and your Best-self answer keeps what the role needs."),
      me?.jobSource && !me.job ? h("p", { class: "ds-note ds-note-info" }, "We filled in the job you sent with your code request.") : "",
      form,
      h("p", { class: "muted small" }, "Some sites, like LinkedIn, block links. If yours does, paste the text of the post."),
    ),
  );
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
      ...title("Step 2 of 4: Consent", "Your voice, your call"),
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
      ...title("Step 3 of 4: Voice sample", "Read this aloud"),
      h("p", { class: "muted" }, "Your Voice sample makes the Voice clone that speaks your Replay. Sage keeps its own voice."),
      script,
      h("div", { class: "recorder inset nb-sm" }, timer, nudge, preview, controls, error),
    ),
  );
}

function questionList(questions: Question[], left: number): HTMLElement {
  const bank = readStoryBank(localStorage);
  const saved = (q: Question) => bank.some((e) => e.question_id === q.id && (!e.question_text || e.question_text === q.text));
  return h(
    "ul",
    { class: "questions" },
    ...questions.map((q) =>
      h(
        "li",
        {},
        h(
          "button",
          { class: "question nb nb-press", disabled: left <= 0, onClick: () => showRound(q) },
          h("span", { class: "reading" }, q.text),
          saved(q) ? h("span", { class: "ds-badge ds-badge-success" }, "In your Story bank") : "",
        ),
      ),
    ),
  );
}

function showPicker(notice?: string) {
  const left = roundsLeft();
  const job = me?.job ?? null;

  const jobPanel = job
    ? h(
        "div",
        { class: "job-card inset nb-sm" },
        h("p", { class: "kicker" }, "Practicing for"),
        h("p", { class: "job-title" }, jobLabel(job)),
        h("ul", { class: "needs", "aria-label": "What this role needs" }, ...job.needs.map((n) => h("li", { class: "ds-badge" }, n))),
        h("button", { class: "ds-btn ds-btn-ghost", onClick: () => showJob(true) }, "Change job"),
      )
    : h(
        "div",
        { class: "job-card inset nb-sm" },
        h("p", { class: "job-title" }, "Practicing for a specific job?"),
        h("p", { class: "muted" }, "Add it and Sage asks Questions for that exact role."),
        h("button", { class: "ds-btn ds-btn-violet", onClick: () => showJob(true) }, "Add your target job"),
      );

  mount(
    panel(
      notice ? h("p", { class: "ds-note ds-note-success", role: "status" }, notice) : "",
      ...title("Step 4 of 4: Pick a Question", job ? "Which Question should Sage ask?" : "What should Sage ask you?"),
      jobPanel,
      h("p", { class: "muted" }, "Sage asks the Question, listens to your Answer, pushes back once, then you answer again. Each Question you practice uses one Round."),
      left <= 0 ? h("p", { class: "ds-note ds-note-error", role: "alert" }, failureMessage("allowance_used")) : "",
      questionList(job ? job.questions : QUESTIONS, left),
      job ? h("details", { class: "said inset nb-sm general" }, h("summary", {}, "General Questions"), questionList(QUESTIONS, left)) : "",
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
    question_text: question.text,
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
      buddiHandoff(),
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

// After the Replay: the rest of the job-readiness loop lives in BUDDi. BUDDi cannot take a job
// from a link parameter yet, so a linked job is offered as one tap to copy for its link box.
function buddiHandoff(): HTMLElement {
  const job = me?.job ?? null;
  const link = me?.jobSource && /^https?:\/\/\S+$/i.test(me.jobSource.trim()) ? me.jobSource.trim() : null;
  const copied = h("p", { class: "small", role: "status" });
  return h(
    "section",
    { class: "ds-card ds-card-gold buddi-next" },
    h("h2", {}, job ? `Keep preparing for ${jobLabel(job)}` : "Keep preparing in BUDDi"),
    h("p", {}, "BUDDi takes the same job further: a resume tailored to it, a brief on the tech it uses, and a full mock interview with a scored report."),
    h(
      "div",
      { class: "actions" },
      h("a", { class: "ds-btn ds-btn-violet", href: BUDDI_URL, target: "_blank", rel: "noopener" }, "Open BUDDi"),
      link
        ? h(
            "button",
            {
              class: "ds-btn ds-btn-ghost",
              onClick: async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  copied.textContent = "Job link copied. Paste it in BUDDi under \"Paste a URL\".";
                } catch {
                  copied.textContent = link;
                }
              },
            },
            "Copy the job link",
          )
        : "",
    ),
    copied,
  );
}

// ---------- owner dashboard ----------

// Every code, newest first, and a form that issues Guest or Gift codes with the same limits as
// the Telegram bot. The Worker answers 403 for any other code, so the header button is only a
// convenience, not the lock.
async function showDashboard(created?: string[]) {
  showLoading("Loading codes...");
  let data: DashboardResponse;
  try {
    data = await api.dashboard();
  } catch (e) {
    showError(codeOf(e), () => void showDashboard());
    return;
  }

  const sum = summarise(data.codes);
  const roundsBy = new Map(data.rounds.map((r) => [r.status, r.n]));
  const stats = h(
    "div",
    { class: "row stats" },
    h("span", { class: "ds-badge" }, `Codes given: ${sum.codes}`),
    h("span", { class: "ds-badge ds-badge-gold" }, `Not started: ${sum.unused}`),
    h("span", { class: "ds-badge" }, `Rounds used: ${sum.roundsUsed} of ${sum.roundsIssued}`),
    h("span", { class: "ds-badge ds-badge-success" }, `Replays: ${(roundsBy.get("replayed") ?? 0) + (roundsBy.get("fallback") ?? 0)}`),
    roundsBy.get("failed") ? h("span", { class: "ds-badge" }, `Failed Rounds: ${roundsBy.get("failed")}`) : "",
    data.pendingRequests ? h("span", { class: "ds-badge ds-badge-info" }, `Pending requests: ${data.pendingRequests}`) : "",
  );

  const list = h("tbody");
  const count = h("p", { class: "muted small", role: "status" });
  const renderRows = () => {
    const rows = data.codes.filter((c) => matchesFilter(c, codeFilter));
    count.textContent = `${rows.length} of ${data.codes.length} codes`;
    list.replaceChildren(
      ...rows.map((c) =>
        h(
          "tr",
          { class: created?.includes(c.code) ? "is-new" : undefined },
          h("td", {}, h("div", { class: "code-cell" }, h("code", {}, c.code), copyButton(inviteLink(location.origin, c.code), "Copy link"))),
          h("td", {}, h("span", { class: `ds-badge${c.kind === "owner" ? " ds-badge-violet" : c.kind === "gift" ? " ds-badge-gold" : ""}` }, c.kind)),
          h("td", {}, `${c.used} / ${c.allowance}`),
          h("td", {}, c.hasVoice ? "Yes" : isRedeemed(c) ? "Deleted" : "No"),
          h("td", {}, c.contact ?? ""),
          h("td", { class: "note-cell" }, c.note ?? ""),
          h("td", { class: "time-cell" }, formatTime(c.createdAt)),
          h("td", { class: "time-cell" }, formatTime(c.lastUsedAt)),
        ),
      ),
    );
  };
  const filter = h(
    "select",
    {
      id: "code-filter",
      class: "ds-input filter",
      onChange: (ev: Event) => {
        codeFilter = (ev.target as HTMLSelectElement).value as CodeFilter;
        renderRows();
      },
    },
    ...FILTERS.map((f) => h("option", { value: f.value, selected: f.value === codeFilter }, f.label)),
  );
  renderRows();

  mount(
    h(
      "div",
      { class: "dashboard stack" },
      panel(
        ...title("Owner", "Dashboard"),
        stats,
        h("p", { class: "muted small" }, "Not started means no Round and no Voice clone yet. It does not tell you whether you already sent the code to someone: use the note for that."),
      ),
      issueForm(created),
      panel(
        h("div", { class: "row table-head" }, h("h2", {}, "Codes"), h("label", { class: "row", for: "code-filter" }, "Show", filter)),
        count,
        h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            { class: "codes" },
            h("thead", {}, h("tr", {}, ...["Code", "Kind", "Rounds", "Voice", "Contact", "Note", "Created", "Last Round"].map((t) => h("th", { scope: "col" }, t)))),
            list,
          ),
        ),
      ),
    ),
  );
}

function issueForm(created?: string[]): HTMLElement {
  const kind = h(
    "select",
    { id: "issue-kind", class: "ds-input" },
    h("option", { value: "guest" }, "Guest (3 Rounds each)"),
    h("option", { value: "gift" }, "Gift (you pick the Rounds)"),
  );
  const count = h("input", { id: "issue-count", class: "ds-input", type: "number", min: 1, max: 50, value: "1", required: true });
  const rounds = h("input", { id: "issue-rounds", class: "ds-input", type: "number", min: 1, max: 1000, placeholder: "3" });
  const note = h("input", { id: "issue-note", class: "ds-input", maxLength: 500, placeholder: "Who it is for, e.g. recruiter demo" });
  const err = h("p", { class: "ds-note ds-note-error", role: "alert", hidden: true });
  const submit = h("button", { class: "ds-btn ds-btn-primary", type: "submit" }, "Create codes");
  const syncKind = () => {
    rounds.required = kind.value === "gift";
    rounds.placeholder = kind.value === "gift" ? "Required" : "3";
  };
  kind.addEventListener("change", syncKind);

  const form = h(
    "form",
    {
      class: "stack",
      onSubmit: async (ev: Event) => {
        ev.preventDefault();
        submit.disabled = true;
        err.hidden = true;
        try {
          const res = await api.createCodes({
            kind: kind.value as "guest" | "gift",
            count: Number(count.value),
            allowance: rounds.value ? Number(rounds.value) : undefined,
            note: note.value.trim() || undefined,
          });
          await showDashboard(res.codes);
        } catch (e) {
          err.textContent = failureMessage(codeOf(e));
          err.hidden = false;
          submit.disabled = false;
        }
      },
    },
    h(
      "div",
      { class: "issue-grid" },
      h("div", { class: "field" }, h("label", { for: "issue-kind" }, "Kind"), kind),
      h("div", { class: "field" }, h("label", { for: "issue-count" }, "How many"), count),
      h("div", { class: "field" }, h("label", { for: "issue-rounds" }, "Rounds each"), rounds),
      h("div", { class: "field note-field" }, h("label", { for: "issue-note" }, "Note"), note),
    ),
    err,
    submit,
  );

  const fresh = created?.length
    ? h(
        "div",
        { class: "inset nb-sm fresh" },
        h("p", { class: "kicker" }, created.length === 1 ? "New code" : `${created.length} new codes`),
        h("ul", { class: "fresh-list" }, ...created.map((c) => h("li", {}, h("code", {}, c), copyButton(inviteLink(location.origin, c), "Copy link")))),
        created.length > 1 ? copyButton(created.map((c) => inviteLink(location.origin, c)).join("\n"), "Copy all links") : "",
      )
    : "";

  return panel(h("h2", { class: "panel-title" }, "Issue codes"), fresh, form);
}

function copyButton(text: string, label: string): HTMLButtonElement {
  const btn = h("button", { class: "ds-btn ds-btn-ghost copy-btn", type: "button" }, label);
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "Copied";
    } catch {
      btn.textContent = "Copy failed";
    }
    setTimeout(() => (btn.textContent = label), 1500);
  });
  return btn;
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
