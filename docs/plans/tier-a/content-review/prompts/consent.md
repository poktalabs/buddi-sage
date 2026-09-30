Review ONE BUDDi Sage Mode content file: content/consent.md.

## Requirement (wins over taste)
- consent.md: shown on screen before any recording, next to a checkbox "This is my own voice and I consent to cloning it". Must state: the Guest records their own voice only; it makes a Voice clone used only to play their Replay back to them; the Voice sample is sent to ElevenLabs to make the Voice clone; "Delete my voice" removes it any time; Guest and Gift Voice clones are deleted automatically shortly after the Allowance of Rounds is used up, or after 7 days, whichever comes first. Nothing the product does not do.

## Glossary (CONTEXT.md; use these exact words in copy)
# BUDDi Sage Mode

Sage Mode is a BUDDi interview-practice experience: a voice coach helps you answer a hard interview question, then you hear your own answer the way your best self would say it, in your own voice.

## Language

### People and voices

**Sage**:
The voice coach the user talks to during a Session. Sage always speaks in its own neutral voice, never in the user's voice.
_Avoid_: agent (in user-facing copy), coach bot, avatar

**Voice clone**:
A copy of the user's own voice, made from a Voice sample given with explicit Consent. Used only for the Replay. Kept until the user deletes it.
_Avoid_: Sage voice, cloned Sage, voice model

**Voice sample**:
The user's recording of a provided reading script, used to make the Voice clone.
_Avoid_: training audio, upload

**Consent**:
The user's explicit opt-in, given before any recording, to clone their own voice and only their own voice.
_Avoid_: terms acceptance

### Practice

**Session**:
One sitting in Sage Mode: Consent (first time only), then one or more Rounds.
_Avoid_: call, conversation (reserve "conversation" for the ElevenAgents runtime object)

**Round**:
One Question practiced end to end: Answer, Pushback, second attempt, save, Replay. The unit an Allowance counts.
_Avoid_: session, attempt, turn

**Question**:
One interview question from the fixed Question set, aimed at AI engineers.
_Avoid_: prompt

**Question set**:
The fixed list of Questions Sage can ask. Not generated from a CV or job description (yet).

**Answer**:
What the user says in response to a Question. The user's final Answer is the one Sage saves after coaching.
_Avoid_: response, reply

**Story bank**:
The user's collection of saved final Answers, one per Question, reusable in future interviews.
_Avoid_: answer log, history

**Replay**:
The moment Sage plays back the user's final Answer, rewritten as a Best-self answer, spoken in the user's Voice clone.
_Avoid_: playback, echo

**Best-self answer**:
The user's final Answer rewritten to keep their content and story but deliver it with confidence and structure. Never adds facts the user didn't say.
_Avoid_: ideal answer, model answer, improved answer

**Pushback**:
The single, specific challenge Sage makes after the user's first Answer to a Question, before the second attempt.
_Avoid_: feedback, critique

**Hesitation signals**:
Measurable signs of an unsure delivery in the user's final Answer: filler words, long pauses and pace. Shown beside the Replay.
_Avoid_: confidence score, fluency score

### Access

**Guest**:
A person using Sage Mode through a code. Identified by the code, not by an account.
_Avoid_: user account, member

**Guest code**:
A code with a small fixed Allowance of Rounds, meant to be shared widely.
_Avoid_: invite, access code

**Gift code**:
A code with an Allowance of Rounds chosen for one specific person.
_Avoid_: voucher, promo code

**Allowance**:
The number of Rounds a code may start. A Round counts when its coaching conversation starts.
_Avoid_: credits, quota, tokens

**Contact**:
The email or X handle a Guest gives before their first Session, used only to ask for feedback.
_Avoid_: lead, signup


## The file under review: content/consent.md
```markdown
Before you record anything, here is what happens with your voice.

You are about to read a short script out loud. That recording is your Voice sample. It is sent to ElevenLabs to make a Voice clone: a copy of your voice.

Record only your own voice. Never record someone else, and never play back someone else's recording.

Your Voice clone is used for one thing: playing your Replay back to you, your own final Answer said the way your best self would say it. Sage, the voice coach you talk to, always speaks in its own voice, never in yours.

You can delete your Voice clone any time with "Delete my voice".

If you came in with a Guest code or a Gift code, your Voice clone is also deleted automatically once your Allowance of Rounds is used up, or 7 days after you made it, whichever comes first.

```

Output in markdown: `# content/consent.md`, then `Verdict:` SHIP, SHIP WITH EDITS or REWRITE, then ranked issues (each naming the canon reference that decides it), then the complete revised file in one fenced block.  No em-dashes.