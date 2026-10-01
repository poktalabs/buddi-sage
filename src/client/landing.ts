// Landing page words, in English and Spanish. Decisions encoded here:
// - Only the landing page is translated. Sage, the Question set and every later screen are in
//   English, so the Spanish copy says plainly that practice is in English.
// - Both calls to action (Get a code, I have a code) sit in the hero, above the fold, and open
//   the same two-tab form in a dialog.
// - The language is the visitor's choice, remembered on this device; the first visit follows
//   the browser's language.
// - Copy uses the glossary words (Round, Question, Answer, Voice clone, Best-self answer, Replay)
//   and makes no claim the product does not back: the rewrite keeps the Guest's facts (guards.ts).
import type { Lang, Platform } from "../shared/api";
import { failureMessage } from "./copy";

export const LANG_KEY = "buddi-sage:lang";

export type Social = Platform;

/**
 * Mel's profiles, where requesters send their DM after the form. Only confirmed profiles are
 * listed; the "DM me" screen shows one icon per entry.
 */
export const MEL_PROFILES: { network: Social; name: string; url: string }[] = [
  { network: "instagram", name: "Instagram", url: "https://instagram.com/thetokendad" },
  { network: "x", name: "X", url: "https://x.com/thetokendad_" },
  { network: "tiktok", name: "TikTok", url: "https://www.tiktok.com/@thetokendad" },
];

// Simple line glyphs in the port-kit style (ink strokes), not the official logos.
export const SOCIAL_ICONS: Record<Social, string> = {
  instagram: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="0.6" fill="currentColor"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true"><path d="M4 4 L20 20" stroke-width="3.2"/><path d="M20 4 L4 20" stroke-width="2"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 3v12.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M13 3c.6 2.6 2.6 4.4 5.5 4.6"/></svg>',
};

export type LandingCopy = {
  toggle: string; // label of the button that switches to the other language
  toggleLabel: string; // accessible name for that button
  headline: [lead: string, mark: string]; // "Enter" + the highlighted "Sage Mode"
  tagline: string[]; // the three actions under the headline, shown with dot separators
  ctaNote: string; // reassurance line under the hero buttons
  close: string; // accessible name of the dialog's close button
  toggleRequest: string;
  toggleHave: string;
  ctaLabel: string;
  haveCode: { title: string; code: string; contact: string; contactHint: string; submit: string };
  request: {
    title: string;
    blurb: string;
    handle: string;
    job: string;
    jobPlaceholder: string;
    pick: string; // shown over the logos once the handle has 3 characters
    handleRule: string; // shown instead of the logos when the handle has characters a handle can't
    sending: string;
    dmTitle: string;
    dmBody: (handle: string, network: string) => string;
    dmNote: string;
    dmLabel: (network: string) => string;
    dmAgain: (network: string) => string;
  };
  howTitle: string;
  steps: { title: string; body: string }[];
  notesTitle: string;
  notes: string[];
  footer: string; // before the BUDDi link
};

export const LANDING: Record<Lang, LandingCopy> = {
  en: {
    toggle: "ES",
    toggleLabel: "Ver en español",
    toggleRequest: "Get a code",
    toggleHave: "I have a code",
    ctaLabel: "Get started",
    headline: ["Enter", "Sage Mode"],
    tagline: ["Paste your job", "Train its Questions", "Boost your confidence"],
    ctaNote: "Free while Sage Mode is invite-only. About 5 minutes, in English.",
    close: "Close",
    haveCode: {
      title: "Have a code?",
      code: "Your code",
      contact: "Email or @handle",
      contactHint: "(first time only; used only to ask for your feedback)",
      submit: "Start practicing",
    },
    request: {
      title: "Request a code",
      blurb: "Codes are free while Sage Mode is invite-only. Type your handle, then tap where you'll DM me.",
      handle: "Your Instagram, X or TikTok handle",
      job: "The job you are preparing for (optional)",
      jobPlaceholder: "A link or a job title",
      pick: "Tap where you'll DM me",
      handleRule: "A handle has only letters, numbers, dots and underscores.",
      sending: "Sending...",
      dmTitle: "Now send me the DM",
      dmBody: (h, n) => `Send me a DM on ${n} from ${h} to get your code.`,
      dmNote: "I reply with your code as soon as I see it.",
      dmLabel: (n) => `DM me on ${n}`,
      dmAgain: (n) => `Open ${n}`,
    },
    howTitle: "How it works",
    steps: [
      { title: "Add your job", body: "Paste a link to the job post, or the post itself. Sage reads it and asks Questions for that role." },
      { title: "Record a Voice sample", body: "Read a short script aloud for about a minute. It makes the Voice clone that speaks your Replay." },
      { title: "Answer Sage", body: "Sage asks one Question for your job, listens, pushes back once, and you answer again. About two minutes." },
      { title: "Hear your best self", body: "Your final Answer comes back tighter, in your own voice. It keeps your facts and adds none." },
    ],
    notesTitle: "Good to know",
    notes: [
      "Each Question you practice uses one Round. A code comes with a few Rounds.",
      "Your voice, your call: delete your Voice clone at any time. Guest Voice clones are deleted on their own after the last Round.",
      "Practice is in English. Use headphones and find a quiet spot.",
    ],
    footer: "Sage Mode is part of",
  },
  es: {
    toggle: "EN",
    toggleLabel: "View in English",
    toggleRequest: "Quiero un código",
    toggleHave: "Tengo un código",
    ctaLabel: "Empieza",
    headline: ["Entra en", "Sage Mode"],
    tagline: ["Pega tu trabajo", "Entrena sus preguntas", "Aumenta tu confianza"],
    ctaNote: "Gratis mientras Sage Mode es por invitación. Unos 5 minutos, en inglés.",
    close: "Cerrar",
    haveCode: {
      title: "¿Tienes un código?",
      code: "Tu código",
      contact: "Email o @usuario",
      contactHint: "(solo la primera vez; solo para pedirte tu opinión)",
      submit: "Empezar a practicar",
    },
    request: {
      title: "Pide un código",
      blurb: "Los códigos son gratis mientras Sage Mode es por invitación. Escribe tu usuario y toca dónde me vas a escribir.",
      handle: "Tu usuario de Instagram, X o TikTok",
      job: "La vacante para la que te preparas (opcional)",
      jobPlaceholder: "Un enlace o el nombre del puesto",
      pick: "Toca dónde me vas a escribir",
      handleRule: "Un usuario solo tiene letras, números, puntos y guiones bajos.",
      sending: "Enviando...",
      dmTitle: "Ahora envíame el DM",
      dmBody: (h, n) => `Envíame un DM por ${n} desde ${h} para recibir tu código.`,
      dmNote: "Te respondo con tu código en cuanto lo vea.",
      dmLabel: (n) => `Escríbeme por ${n}`,
      dmAgain: (n) => `Abrir ${n}`,
    },
    howTitle: "Cómo funciona",
    steps: [
      { title: "Agrega tu trabajo", body: "Pega el enlace de la oferta o el texto completo. Sage la lee y te hace preguntas para ese puesto." },
      { title: "Graba una muestra de voz", body: "Lee en voz alta un texto corto durante un minuto. Con eso se crea el clon de voz que dice tu Replay." },
      { title: "Responde a Sage", body: "Sage hace una pregunta para tu puesto, escucha, te contradice una vez y vuelves a responder. Unos dos minutos." },
      { title: "Escucha tu mejor versión", body: "Tu respuesta final regresa más clara, con tu propia voz. Conserva tus datos y no agrega ninguno." },
    ],
    notesTitle: "Para que sepas",
    notes: [
      "Cada pregunta que practicas usa una Ronda. Un código trae unas cuantas Rondas.",
      "Tu voz, tu decisión: borra tu clon de voz cuando quieras. Los clones de voz de invitados se borran solos después de la última Ronda.",
      "La práctica es en inglés. Usa audífonos y busca un lugar tranquilo.",
    ],
    footer: "Sage Mode es parte de",
  },
};

// The failures the two landing forms can hit, in Spanish. English uses the app's FAILURE_COPY.
const FAILURE_ES: Record<string, string> = {
  invalid_code: "Ese código no funciona. Revísalo e intenta de nuevo.",
  contact_required: "Agrega un email o usuario de X la primera vez que uses este código.",
  bad_request: "Revisa tu usuario: solo letras, números, puntos y guiones bajos.",
  rate_limited: "Demasiadas solicitudes desde aquí. Intenta de nuevo en una hora.",
  unauthorized: "Tu sesión terminó. Escribe tu código otra vez para continuar.",
  upstream_error: "Un servicio del que dependemos no respondió. Intenta de nuevo en un momento.",
  network: "Parece que no tienes conexión. Revísala e intenta de nuevo.",
  bad_response: "Algo salió mal de nuestro lado. Intenta de nuevo.",
};

export function landingFailure(lang: Lang, code: string): string {
  if (lang === "es") return FAILURE_ES[code] ?? FAILURE_ES.bad_response!;
  return failureMessage(code);
}

/** The saved choice, else the browser's language: Spanish for any `es-*`, English otherwise. */
export function initialLang(stored: string | null, browserLanguages: readonly string[]): Lang {
  if (stored === "en" || stored === "es") return stored;
  return browserLanguages[0]?.toLowerCase().startsWith("es") ? "es" : "en";
}
