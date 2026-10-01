// Landing page words, in English and Spanish. Decisions encoded here:
// - Only the landing page is translated. Sage, the Question set and every later screen are in
//   English, so the Spanish copy says plainly that practice is in English.
// - Both calls to action (Have a code, Request a code) sit in the hero, above the fold.
// - The language is the visitor's choice, remembered on this device; the first visit follows
//   the browser's language.
// - Copy uses the glossary words (Round, Question, Answer, Voice clone, Best-self answer, Replay)
//   and makes no claim the product does not back: the rewrite keeps the Guest's facts (guards.ts).
import type { Lang, SocialPlatform } from "../shared/api";
import { failureMessage } from "./copy";

export const LANG_KEY = "buddi-sage:lang";

export const PLATFORM_NAMES: Record<SocialPlatform, string> = { instagram: "Instagram", x: "X", tiktok: "TikTok" };

/**
 * Where requesters send their DM. Only accounts Mel has confirmed are listed; a platform with
 * no entry here is still accepted on the form, the copy just names fewer places to write.
 */
export const DM_ACCOUNTS: Partial<Record<SocialPlatform, string>> = { x: "thetokendad_" };

/** "@thetokendad_ on X" or "@a on X or @b on Instagram". */
export function dmTargets(lang: Lang): string {
  const parts = Object.entries(DM_ACCOUNTS).map(([p, h]) => (lang === "es" ? `@${h} en ${PLATFORM_NAMES[p as SocialPlatform]}` : `@${h} on ${PLATFORM_NAMES[p as SocialPlatform]}`));
  return parts.join(lang === "es" ? " o " : " or ");
}

export type LandingCopy = {
  toggle: string; // label of the button that switches to the other language
  toggleLabel: string; // accessible name for that button
  kicker: string;
  headline: string;
  lede: string;
  haveCode: { title: string; code: string; contact: string; contactHint: string; submit: string };
  request: {
    title: string;
    blurb: (targets: string) => string;
    platform: string;
    handle: string;
    jobUrl: string;
    submit: string;
    sending: string;
    done: (who: string, targets: string) => string;
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
    kicker: "Interview practice, out loud",
    headline: "Hear your best interview answer, in your own voice",
    lede: "Sage asks you a hard interview Question out loud and pushes back once. Then you hear your own Answer, tightened into your Best-self answer and spoken in your Voice clone.",
    haveCode: {
      title: "Have a code?",
      code: "Your code",
      contact: "Email or X handle",
      contactHint: "(first time only; used only to ask for your feedback)",
      submit: "Start practicing",
    },
    request: {
      title: "Request a code",
      blurb: (to) => `Codes are free while Sage Mode is invite-only. Tell us which account you will DM us from, then send a DM to ${to} and we will reply with your code.`,
      platform: "Platform",
      handle: "Your handle",
      jobUrl: "Link to the job you are preparing for (optional)",
      submit: "Request a code",
      sending: "Sending...",
      done: (who, to) => `Got it. Now send a DM from ${who} to ${to} and we will reply with your code.`,
    },
    howTitle: "How it works",
    steps: [
      { title: "Record a Voice sample", body: "Read a short script aloud for about a minute. It makes the Voice clone that speaks your Replay." },
      { title: "Answer Sage", body: "Sage asks one Question, listens, pushes back once, and you answer again. About two minutes." },
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
    kicker: "Práctica de entrevista, en voz alta",
    headline: "Escucha tu mejor respuesta de entrevista, con tu propia voz",
    lede: "Sage te hace en voz alta una pregunta difícil de entrevista y te contradice una vez. Después escuchas tu propia respuesta, pulida como tu mejor versión y dicha con tu clon de voz.",
    haveCode: {
      title: "¿Tienes un código?",
      code: "Tu código",
      contact: "Email o usuario de X",
      contactHint: "(solo la primera vez; solo para pedirte tu opinión)",
      submit: "Empezar a practicar",
    },
    request: {
      title: "Pide un código",
      blurb: (to) => `Los códigos son gratis mientras Sage Mode es por invitación. Dinos desde qué cuenta nos vas a escribir, envía un DM a ${to} y te respondemos con tu código.`,
      platform: "Plataforma",
      handle: "Tu usuario",
      jobUrl: "Enlace a la vacante para la que te preparas (opcional)",
      submit: "Pedir un código",
      sending: "Enviando...",
      done: (who, to) => `Listo. Ahora envía un DM desde ${who} a ${to} y te respondemos con tu código.`,
    },
    howTitle: "Cómo funciona",
    steps: [
      { title: "Graba una muestra de voz", body: "Lee en voz alta un texto corto durante un minuto. Con eso se crea el clon de voz que dice tu Replay." },
      { title: "Responde a Sage", body: "Sage hace una pregunta, escucha, te contradice una vez y vuelves a responder. Unos dos minutos." },
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
  bad_request: "Revisa los datos: el usuario debe existir en esa plataforma y el enlace debe ser una URL.",
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
